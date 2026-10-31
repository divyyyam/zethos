import {
  type Address,
  getAddress,
  type Hex,
  keccak256,
  type LocalAccount,
  toBytes,
  zeroAddress,
} from "viem";
import type { z } from "zod";
import { type AgentState, type Decision, emptyFlow, HORIZONS, initialState } from "./agent/types";
import { type Pair, type Params, paramsSchema, type Side, type TierName } from "./config";
import type { Fill, Flow, QuoteRecord, Store } from "./db";
import type { BookResult } from "./feeds";
import { type Fused, fuse, type VenueState, vwap, vwapForQuote } from "./feeds/fuse";
import type { Health, Source, Trade } from "./feeds/types";
import { Volatility } from "./feeds/vol";
import { baseQuantity, markoutBps, spreadCapture } from "./markouts";
import { amountOut, priceSwap, ttlSeconds } from "./pricing";
import {
  fillRequestSchema,
  quoteRequestSchema,
  randomNonce,
  type SignedQuote,
  sameQuote,
  signQuote,
  verifyQuote,
} from "./quotes";
import {
  type Inventory,
  PAIR_TOKENS,
  TOKEN_SYMBOLS,
  type Token,
  type Tokens,
  toUnits,
  units,
} from "./tokens";
import { newTaker, nextTier, observeFill, observeMarkout, scoreTaker } from "./toxicity";

export class EngineError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface PriceBreakdown {
  mid: number;
  ref: number;
  sources: Source[];
  base: number;
  vol: number;
  inventory: number;
  toxicity: number;
  degraded: number;
  tuner: number;
  half: number;
  sigmaT: number;
  ttlSec: number;
  tier: TierName;
}

export interface PaperQuote {
  route: "paper";
  id: string;
  quote: SignedQuote;
  signature: Hex;
  paperOut: string;
  poolOut: string | null;
  poolVenue: string | null;
  spotOut: string;
  savingVsPoolPct: number | null;
  vsMidBps: number;
  expiresAt: number;
  breakdown: PriceBreakdown;
}

export type Frame =
  | { type: "price"; pair: Pair; mid: number | null; health: Health; ts: number }
  | { type: "fill"; fill: Fill }
  | { type: "decision"; decision: Decision }
  | { type: "risk"; paused: boolean; riskState: "paused" | "degraded" | "normal"; halted: Pair[] }
  | { type: "takerTier"; address: Address; tier: TierName; score: number }
  | { type: "params"; ts: number; changed: string[] }
  | { type: "arena"; arena: Omit<ReturnType<Engine["arenaView"]>, "series"> };

export interface EngineDeps {
  chainId: 177 | 133;
  params: Params;
  tokens: Tokens;
  store: Store;
  signer: LocalAccount;
  emit?: (frame: Frame) => void;
  random?: () => number;
  onDecision?: (decision: Decision) => void;
  operator?: Address | null;
  dataSource?: "live" | "replay";
}

interface Market {
  venues: Map<string, VenueState>;
  fused: Fused;
  vol: Volatility;
  updatedAt: number | null;
  history: { t: number; mid: number; sources?: Record<string, number> }[];
}

interface Issued {
  id: string;
  pair: Pair;
  side: Side;
  quote: SignedQuote;
  mid: number;
  expiresAtMs: number;
  record: QuoteRecord;
}

const HISTORY_POINTS = 1800;
const MAX_TTL_SEC = 120n;

export function flowOf(client: string | undefined): Flow {
  if (client === "web") return "user";
  if (client?.startsWith("sniper")) return "attacker";
  return "agent";
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new EngineError("invalid_request", 400, result.error.issues[0]?.message);
  return result.data;
}

export class Engine {
  private readonly markets = new Map<Pair, Market>();
  private readonly issued = new Map<string, Issued>();
  private readonly usedNonces = new Set<string>();
  private readonly requests = new Map<string, number[]>();
  private arena: { epoch: number; startedAt: number } | null = null;
  private inventory: Inventory | null = null;
  private paused = false;
  private state: AgentState = initialState(0, 0);
  private ledger: Fill[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private lastTick = 0;
  private readonly pendingTape: { due: number; quote: SignedQuote; signature: Hex }[] = [];
  private readonly seenTrades = new Map<string, number>();
  private readonly cooldowns = new Map<string, number>();
  private modeledGasUsd = 0;

  // Durable Object requests can interleave at every await. Serializing correctness writes
  // prevents nonce reuse, inventory races and rollback clobbering across requests.
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const work = this.queue.then(action);
    this.queue = work.catch(() => {});
    return work;
  }

  constructor(private readonly deps: EngineDeps) {
    for (const pair of deps.params.pairs) {
      this.markets.set(pair, {
        venues: new Map(),
        fused: { mid: null, health: "down", sources: [], book: null },
        vol: new Volatility(),
        updatedAt: null,
        history: [],
      });
    }
  }

  get signerAddress(): Address {
    return this.deps.signer.address;
  }

  async init(): Promise<void> {
    const arena = await this.deps.store.loadArena();
    if (!arena) return;
    this.setArena(arena.epoch, arena.startedAt, arena.inventory);
    const state = await this.deps.store.loadState(arena.epoch);
    this.state =
      state?.epoch === arena.epoch
        ? state
        : initialState(
            arena.epoch,
            this.deps.params.arena.initialUsdPerSide * this.deps.params.pairs.length * 2,
          );
    this.paused = this.state.paused;
    for (const pair of this.deps.params.pairs)
      this.market(pair).history = this.state.prices[pair] ?? [];
    this.ledger = (await this.deps.store.fills({ epoch: arena.epoch, limit: 1_000_000 })).reverse();
    const records = await this.deps.store.loadQuotes(arena.epoch);
    for (const record of records) {
      this.restoreQuote(record);
      this.observeQuote(record);
    }
    for (const fill of this.ledger) this.accountFill(fill);
    if (
      this.state.strategy &&
      JSON.stringify(this.state.strategy) !== JSON.stringify(this.deps.params)
    ) {
      this.decision("param_reload", Date.now(), "Strategy bundle changed since previous boot", {
        changed: "deployment params.json",
      });
    }
    this.state.strategy = this.deps.params;
  }

  // Feed one poll's books for a pair into the fused price and volatility.
  ingest(pair: Pair, results: BookResult[], now: number): void {
    const market = this.market(pair);
    for (const result of results) {
      const previous = market.venues.get(result.venue);
      market.venues.set(
        result.venue,
        result.book
          ? { venue: result.venue, book: result.book, at: now }
          : (previous ?? { venue: result.venue, book: null, at: 0 }),
      );
    }
    market.fused = fuse([...market.venues.values()], now, this.deps.params.feeds);
    const { mid, health } = market.fused;
    if (mid !== null) {
      market.vol.update(mid, now);
      market.updatedAt = now;
      market.history.push({
        t: now,
        mid,
        sources: Object.fromEntries(
          market.fused.sources.filter((s) => s.status === "ok").map((s) => [s.venue, s.mid]),
        ),
      });
      if (market.history.length > HISTORY_POINTS) market.history.shift();
    }
    this.deps.emit?.({ type: "price", pair, mid, health, ts: now });
  }

  // Seed paper inventory once every pair has a price: equal USD value on each side of each pair.
  ensureArena(now: number): Promise<void> {
    if (this.inventory) return Promise.resolve();
    return this.exclusive(() => this.seedArena(now));
  }

  private async seedArena(now: number, force = false): Promise<void> {
    if (this.inventory && !force) return;
    const mids = this.deps.params.pairs.map((pair) => this.market(pair).fused.mid);
    if (mids.some((mid) => mid === null)) return;
    const usd = this.deps.params.arena.initialUsdPerSide;
    const inventory = Object.fromEntries(TOKEN_SYMBOLS.map((symbol) => [symbol, 0n])) as Inventory;
    this.deps.params.pairs.forEach((pair, index) => {
      const { base, quote } = this.pairTokens(pair);
      inventory[quote.symbol] += toUnits(usd, quote.decimals);
      inventory[base.symbol] += toUnits(usd / (mids[index] as number), base.decimals);
    });
    const arena = await this.deps.store.startArena(now, inventory);
    this.setArena(arena.epoch, arena.startedAt, arena.inventory);
    this.state = initialState(arena.epoch, this.equityUsd(inventory) ?? 0);
    this.state.points.push({ t: now, equity: this.state.initialEquity, byFlow: emptyFlow() });
    this.state.strategy = this.deps.params;
    if (!force) await this.checkpoint();
  }

  quote(
    input: unknown,
    client: string | undefined,
    now: number,
    ip?: string,
  ): Promise<{ response: PaperQuote; saved: Promise<void> }> {
    return this.exclusive(() => this.issueQuote(input, client, now, ip));
  }

  private async issueQuote(
    input: unknown,
    client: string | undefined,
    now: number,
    ip?: string,
  ): Promise<{ response: PaperQuote; saved: Promise<void> }> {
    const request = parse(quoteRequestSchema, input);
    const { pair, side, base, quote } = this.route(request.tokenIn, request.tokenOut);
    this.refresh(pair, now);
    const { market, mid, book } = this.tradable(pair);
    const inventory = this.requireInventory();
    this.rateLimit(request.taker, now);
    if (ip) this.rateLimit(`ip:${ip}`, now);

    const { params } = this.deps;
    const taker = this.taker(getAddress(request.taker), now);
    if (taker.detectedAfter) taker.postDetectionAttempts += 1;
    const tierName = taker.override ?? taker.tier;
    if (tierName === "blocked") throw new EngineError("taker_restricted", 403);
    const tier = params.toxicity.tiers[tierName];
    const amountIn = BigInt(request.amountIn);
    const notional =
      side === "buy" ? units(amountIn, quote.decimals) : units(amountIn, base.decimals) * mid;
    if (notional < params.quote.minNotionalUsd) {
      throw new EngineError(
        "invalid_request",
        400,
        `Minimum swap is $${params.quote.minNotionalUsd}`,
      );
    }
    if (notional > params.quote.maxNotionalUsd[pair] * tier.sizeCap) {
      throw new EngineError("vault_capacity", 422, "Amount is above the per-swap limit");
    }

    const ref =
      side === "buy"
        ? vwapForQuote(book.asks, notional)
        : vwap(book.bids, units(amountIn, base.decimals));
    if (ref === null) throw new EngineError("insufficient_reference_depth", 422);

    const share = this.baseShare(pair, mid, inventory);
    if (side === "sell" ? share > params.inventory.maxShare : share < params.inventory.minShare) {
      throw new EngineError("vault_capacity", 422, "The vault is not taking this side right now");
    }

    const sigma1 = market.vol.sigma1;
    const ttlSec = ttlSeconds(sigma1, tier.ttlSec, params.quote);
    const priced = priceSwap(
      {
        side,
        ref,
        sigma1,
        ttlSec,
        baseShare: share,
        degraded: market.fused.health === "degraded",
        tier,
        tuner: this.state.tuner[pair] ?? 1,
        baseSpread: params.spread.base[pair],
      },
      params.spread,
      params.inventory.targetShare,
    );

    const out = amountOut(side, amountIn, priced.price, base.decimals, quote.decimals);
    const tokenOut = side === "buy" ? base : quote;
    if (out <= 0n) throw new EngineError("invalid_request", 400, "Amount is too small");
    if (out > inventory[tokenOut.symbol]) throw new EngineError("vault_capacity", 422);

    const issuedAt = BigInt(Math.floor(now / 1000));
    const signed: SignedQuote = {
      taker: getAddress(request.taker),
      tokenIn: getAddress(request.tokenIn),
      tokenOut: getAddress(request.tokenOut),
      amountIn: request.amountIn,
      amountOut: out.toString(),
      nonce: randomNonce().toString(),
      issuedAt: issuedAt.toString(),
      expiry: (issuedAt + BigInt(ttlSec)).toString(),
    };
    const signature = await signQuote(this.deps.signer, this.deps.chainId, signed);
    const id = `q_${crypto.randomUUID()}`;
    const vsMid = side === "buy" ? priced.price / mid - 1 : 1 - priced.price / mid;

    const response: PaperQuote = {
      route: "paper",
      id,
      quote: signed,
      signature,
      paperOut: signed.amountOut,
      poolOut: null,
      poolVenue: null,
      spotOut: amountOut(side, amountIn, mid, base.decimals, quote.decimals).toString(),
      savingVsPoolPct: null,
      vsMidBps: Math.round(vsMid * 1e6) / 100,
      expiresAt: Number(signed.expiry),
      breakdown: {
        mid,
        ref,
        sources: market.fused.sources,
        ...priced.terms,
        half: priced.half,
        sigmaT: priced.sigmaT,
        ttlSec,
        tier: tierName,
      },
    };

    const record: QuoteRecord = {
      id,
      ts: now,
      epoch: this.arena?.epoch ?? 0,
      pair,
      side,
      client: client ?? "unknown",
      quote: signed,
      signature,
      breakdown: response.breakdown,
      status: "issued",
    };
    // Do not hand out a firm signature until its issuance is durable.
    await this.deps.store.saveQuote(record);
    this.issued.set(nonceKey(signed), {
      id,
      pair,
      side,
      quote: signed,
      mid,
      expiresAtMs: Number(signed.expiry) * 1000,
      record,
    });
    this.observeQuote(record);
    return { response, saved: Promise.resolve() };
  }

  // The paper vault: the same checks, in the same order, that ZethosVault.fill will enforce.
  paperFill(input: unknown, client: string | undefined, now: number): Promise<Fill> {
    return this.exclusive(() => this.fillQuote(input, client, now));
  }

  private async fillQuote(
    input: unknown,
    client: string | undefined,
    now: number,
    internalFlow?: Flow,
  ): Promise<Fill> {
    const { quote, signature } = parse(fillRequestSchema, input);
    const valid = await verifyQuote(this.signerAddress, this.deps.chainId, quote, signature as Hex);
    if (!valid) throw new EngineError("quote_invalid", 400, "Signature does not match the quote");

    const nowSec = BigInt(Math.floor(now / 1000));
    if (nowSec > BigInt(quote.expiry)) throw new EngineError("quote_expired", 409);
    if (
      BigInt(quote.expiry) < BigInt(quote.issuedAt) ||
      BigInt(quote.issuedAt) > nowSec ||
      BigInt(quote.expiry) - BigInt(quote.issuedAt) > MAX_TTL_SEC
    ) {
      throw new EngineError("quote_invalid", 400, "Quote lifetime is too long");
    }
    const key = nonceKey(quote);
    if (this.usedNonces.has(key) || (await this.deps.store.nonceUsed(quote.taker, quote.nonce)))
      throw new EngineError("nonce_used", 409);
    const issued = this.issued.get(key);
    if (!issued || !sameQuote(issued.quote, quote)) {
      throw new EngineError("quote_invalid", 400, "Quote was not issued by this engine");
    }
    if (this.paused) throw new EngineError("paused", 503);
    // Feed freshness, inventory skew and new taker restrictions cannot revoke a firm
    // quote. Only the same explicit pause/halt gates as the vault apply at settlement.
    if (this.state.halts[issued.pair]) throw new EngineError("pair_halted", 503);

    const inventory = this.requireInventory();
    const { base, quote: quoteToken } = this.pairTokens(issued.pair);
    const [tokenIn, tokenOut] = issued.side === "buy" ? [quoteToken, base] : [base, quoteToken];
    const amountIn = BigInt(quote.amountIn);
    const amountOutValue = BigInt(quote.amountOut);
    if (amountOutValue > inventory[tokenOut.symbol]) throw new EngineError("vault_capacity", 422);

    // Reserve synchronously before any await, so concurrent fills cannot double-spend.
    const nextInventory = { ...inventory };
    nextInventory[tokenOut.symbol] -= amountOutValue;
    nextInventory[tokenIn.symbol] += amountIn;

    const [baseAmount, quoteAmount] =
      issued.side === "buy" ? [amountOutValue, amountIn] : [amountIn, amountOutValue];
    this.refresh(issued.pair, now);
    const fill: Fill = {
      id: `f_${crypto.randomUUID()}`,
      quoteId: issued.id,
      ts: now,
      taker: getAddress(quote.taker),
      pair: issued.pair,
      side: issued.side,
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      price: units(quoteAmount, quoteToken.decimals) / units(baseAmount, base.decimals),
      midAtFill: this.market(issued.pair).fused.mid,
      flow: internalFlow ?? flowOf(client),
      paper: true,
      txHash: null,
      gasUsd: this.modeledGasUsd,
      epoch: this.arena?.epoch ?? 0,
    };

    await this.deps.store.saveFill(fill, quote.nonce, this.arena?.epoch ?? 0, nextInventory);
    this.inventory = nextInventory;
    this.usedNonces.add(key);
    issued.record.status = "filled";
    this.ledger.push(fill);
    this.accountFill(fill);
    this.observeOutcome(issued, true, fill.midAtFill);
    this.deps.emit?.({ type: "fill", fill });
    return fill;
  }

  status() {
    for (const pair of this.deps.params.pairs) this.refresh(pair, Date.now());
    const { params } = this.deps;
    const inventory = this.inventory;
    const pairs = params.pairs.map((pair) => {
      const market = this.market(pair);
      const { base, quote } = this.pairTokens(pair);
      const { mid, health, sources } = market.fused;
      return {
        pair,
        base: tokenView(base),
        quote: tokenView(quote),
        mid,
        health,
        halted: Boolean(this.state.halts[pair]) || health === "down",
        sources,
        halfSpread:
          mid !== null && inventory
            ? {
                buy: this.halfSpread(pair, "buy", mid, inventory),
                sell: this.halfSpread(pair, "sell", mid, inventory),
              }
            : null,
        updatedAt: market.updatedAt,
      };
    });
    const degraded = pairs.some((pair) => pair.health !== "ok" || pair.halted);
    return {
      mode: "shadow" as const,
      dataSource: this.deps.dataSource ?? "live",
      chainId: this.deps.chainId,
      signer: this.signerAddress,
      operator: this.deps.operator ?? null,
      verifyingContract: zeroAddress,
      paused: this.paused,
      riskState: this.paused ? "paused" : degraded ? "degraded" : "normal",
      pairs,
      inventory: inventory
        ? Object.fromEntries(TOKEN_SYMBOLS.map((symbol) => [symbol, inventory[symbol].toString()]))
        : {},
      equityUsd: inventory ? this.equityUsd(inventory) : null,
    };
  }

  async fills(taker: string | undefined, limit: number, epoch?: number): Promise<Fill[]> {
    if (epoch !== undefined && (!Number.isSafeInteger(epoch) || epoch < 1))
      throw new EngineError("invalid_request", 400, "Invalid epoch");
    if (taker !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(taker)) {
      throw new EngineError("invalid_request", 400, "taker must be an address");
    }
    const fills = await this.deps.store.fills({
      ...(epoch === undefined ? {} : { epoch }),
      ...(taker ? { taker: taker as Address } : {}),
      limit,
    });
    return fills.map((fill) => this.withMarkouts(fill));
  }

  stats(pair: string, from: number, to: number) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to)
      throw new EngineError("invalid_request", 400, "Invalid time range");
    if (!this.markets.has(pair as Pair))
      throw new EngineError("invalid_request", 400, "Unknown pair");
    const series = this.market(pair as Pair).history.filter(
      (point) => point.t >= from && point.t <= to,
    );
    const fills = this.ledger.filter((f) => f.pair === pair && f.ts >= from && f.ts <= to);
    return {
      series,
      venues: [] as { venue: string; depthUsd: number }[],
      summary: {
        fills: fills.length,
        volumeUsd: fills.reduce(
          (sum, f) => sum + f.price * baseQuantity(f, this.pairTokens(f.pair).base.decimals),
          0,
        ),
        spreadCaptureUsd: fills.reduce(
          (sum, f) =>
            sum + spreadCapture(f, baseQuantity(f, this.pairTokens(f.pair).base.decimals)),
          0,
        ),
      },
    };
  }

  prune(now: number): void {
    for (const [key, issued] of this.issued) {
      if (issued.expiresAtMs + 60_000 < now) this.issued.delete(key);
    }
    for (const [taker, times] of this.requests) {
      const recent = times.filter((time) => now - time < 60_000);
      if (recent.length === 0) this.requests.delete(taker);
      else this.requests.set(taker, recent);
    }
  }

  private refresh(pair: Pair, now: number): void {
    const market = this.market(pair);
    market.fused = fuse([...market.venues.values()], now, this.deps.params.feeds);
  }

  private taker(address: Address, now: number) {
    const key = address.toLowerCase();
    this.state.takers[key] ??= newTaker(address, now, this.deps.params.toxicity.priorScore);
    return this.state.takers[key];
  }

  private restoreQuote(record: QuoteRecord): void {
    const breakdown = record.breakdown as PriceBreakdown;
    this.issued.set(nonceKey(record.quote), {
      id: record.id,
      pair: record.pair,
      side: record.side,
      quote: record.quote,
      mid: breakdown.mid,
      expiresAtMs: Number(record.quote.expiry) * 1000,
      record,
    });
  }

  private observeQuote(record: QuoteRecord): void {
    if (this.state.observedQuotes.includes(record.id)) return;
    this.taker(getAddress(record.quote.taker), record.ts).quotes += 1;
    this.state.observedQuotes.push(record.id);
  }

  private accountFill(fill: Fill): void {
    if (this.state.processedFills.includes(fill.id)) return;
    const taker = this.taker(fill.taker, fill.ts);
    const issued = [...this.issued.values()].find((q) => q.id === fill.quoteId);
    if (!issued) return;
    const breakdown = issued.record.breakdown as PriceBreakdown;
    const moved =
      fill.midAtFill === null
        ? null
        : ((fill.side === "buy" ? 1 : -1) * (fill.midAtFill - issued.mid)) / issued.mid;
    observeFill(
      taker,
      {
        adverse: moved === null ? null : moved > breakdown.half,
        lateness:
          (fill.ts / 1000 - Number(issued.quote.issuedAt)) /
          (Number(issued.quote.expiry) - Number(issued.quote.issuedAt)),
        ts: fill.ts,
      },
      this.deps.params.toxicity,
    );
    this.observeOutcome(issued, true, fill.midAtFill);
    this.state.processedFills.push(fill.id);
    this.state.gasUsd += fill.gasUsd ?? 0;
    if (taker.detectedAfter) taker.postDetectionFills += 1;
  }

  private observeOutcome(issued: Issued, filled: boolean, mid: number | null): void {
    if (mid === null) return;
    if (this.state.outcomes.includes(issued.id)) return;
    const favorable = (issued.side === "buy" ? 1 : -1) * (mid - issued.mid) > 0;
    const taker = this.taker(getAddress(issued.quote.taker), issued.record.ts);
    const bucket = favorable ? taker.favorable : taker.unfavorable;
    const decay = 0.5 ** (1 / this.deps.params.toxicity.halfLifeFills);
    for (const value of [taker.favorable, taker.unfavorable]) {
      value.quotes *= decay;
      value.fills *= decay;
    }
    bucket.quotes += 1;
    if (filled) bucket.fills += 1;
    this.state.outcomes.push(issued.id);
  }

  private decision(
    type: string,
    now: number,
    reason: string,
    inputs: Decision["inputs"],
    pair: Pair | null = null,
    taker: Address | null = null,
    before: Decision["before"] = null,
    after: Decision["after"] = null,
  ): Decision | null {
    const key = `${type}:${pair}:${taker}:${reason}`;
    const last = this.cooldowns.get(key);
    if (last !== undefined && now - last < this.deps.params.agent.cooldownMs) return null;
    const decision: Decision = {
      id: `d_${crypto.randomUUID()}`,
      ts: now,
      type,
      pair,
      taker,
      reason,
      inputs,
      before,
      after,
      narration: null,
    };
    this.state.decisions.push(decision);
    this.cooldowns.set(key, now);
    this.deps.emit?.({ type: "decision", decision });
    this.deps.onDecision?.(decision);
    return decision;
  }

  decisions(limit = 20, type?: string): Decision[] {
    return this.state.decisions
      .filter((d) => !type || d.type === type)
      .slice(-limit)
      .reverse();
  }

  takers(limit = 100) {
    return Object.values(this.state.takers)
      .sort((a, b) => b.fills - a.fills)
      .slice(0, limit)
      .map(
        ({
          address,
          label,
          tier,
          score,
          signals,
          fills,
          pnlUsd,
          detectedAfter,
          preDetectionLossUsd,
          postDetectionLossUsd,
          postDetectionAttempts,
          postDetectionFills,
        }) => ({
          address,
          label,
          tier,
          score,
          signals,
          fills,
          pnlUsd,
          detectedAfter,
          preDetectionLossPerFillUsd: detectedAfter
            ? preDetectionLossUsd / detectedAfter.fills
            : null,
          postDetectionLossPerFillUsd: postDetectionFills
            ? postDetectionLossUsd / postDetectionFills
            : null,
          estimatedLossAvoidedUsd: detectedAfter
            ? (preDetectionLossUsd / detectedAfter.fills) * postDetectionAttempts
            : 0,
          postDetectionAttempts,
        }),
      );
  }

  arenaView() {
    if (!this.arena || !this.inventory) throw new EngineError("warming_up", 503);
    const equity = this.equityUsd(this.inventory);
    // Value inventory at the most recent healthy mid during an outage; never substitute
    // sample prices. If no recorded price exists, report warming_up.
    const equityUsd = equity ?? this.state.points.at(-1)?.equity;
    if (equityUsd === undefined)
      throw new EngineError("warming_up", 503, "No healthy valuation yet");
    const byFlow = emptyFlow();
    let spread = 0;
    let volumeUsd = 0;
    for (const fill of this.ledger) {
      const qty = baseQuantity(fill, this.pairTokens(fill.pair).base.decimals);
      const notional = fill.price * qty;
      spread += spreadCapture(fill, qty);
      volumeUsd += notional;
      const mark = this.state.markouts.find((m) => m.fillId === fill.id && m.horizon === 300);
      if (mark) byFlow[fill.flow] += (mark.bps * notional) / 10000;
    }
    const totalBeforeGas = equityUsd - this.state.initialEquity;
    return {
      epoch: this.arena.epoch,
      startedAt: this.arena.startedAt,
      paper: true,
      equityUsd,
      pnl: {
        total: totalBeforeGas - this.state.gasUsd,
        spread,
        inventory: totalBeforeGas - spread,
        arb: 0,
        gas: this.state.gasUsd,
      },
      valuationStale: equity === null,
      unpricedFills: this.ledger.filter((fill) => fill.midAtFill === null).length,
      byFlow,
      series: this.state.points.slice(-1800),
      fills: this.ledger.length,
      volumeUsd,
      takers: new Set(this.ledger.map((f) => f.taker.toLowerCase())).size,
      tapeCaptureRate: this.state.tape.attempts
        ? this.state.tape.wins / this.state.tape.attempts
        : null,
      tape: { ...this.state.tape },
      methodology: {
        settlement: "paper",
        byFlowHorizonSec: 300,
        spreadCapture: "signed edge at fill mid",
        gas: "modelled from latest RPC gas price; zero until available",
        tapeCaptureRate: this.deps.params.arena.tapeCaptureRate,
        tapeSizeScale: this.deps.params.arena.tapeSizeScale,
      },
    };
  }

  pnl(period: "today" | "7d" | "all", now: number) {
    const arena = this.arenaView();
    if (period === "all")
      return {
        total: arena.pnl.total,
        spreadCapture: arena.pnl.spread,
        inventory: arena.pnl.inventory,
        arbitrage: 0,
        gas: arena.pnl.gas,
        paper: true,
      };
    const from =
      period === "7d"
        ? now - 7 * 86400000
        : new Date(new Date(now).toISOString().slice(0, 10)).getTime();
    const opening =
      this.state.points.findLast((p) => p.t <= from)?.equity ?? this.state.initialEquity;
    const fills = this.ledger.filter((f) => f.ts >= from);
    const spread = fills.reduce(
      (sum, f) => sum + spreadCapture(f, baseQuantity(f, this.pairTokens(f.pair).base.decimals)),
      0,
    );
    const gas = fills.reduce((sum, f) => sum + (f.gasUsd ?? 0), 0);
    const total = arena.equityUsd - opening - gas;
    return {
      total,
      spreadCapture: spread,
      inventory: total - spread + gas,
      arbitrage: 0,
      gas,
      paper: true,
    };
  }

  tick(now: number, gasPrice?: bigint): Promise<void> {
    return this.exclusive(async () => {
      for (const pair of this.deps.params.pairs) this.refresh(pair, now);
      if (!this.inventory) return;
      if (gasPrice !== undefined) {
        const hsk = this.markets.get("HSK/USDT")?.fused.mid;
        if (hsk)
          this.modeledGasUsd = ((Number(gasPrice) * this.deps.params.arena.gasUnits) / 1e18) * hsk;
      }
      for (const issued of this.issued.values()) {
        if (issued.record.status !== "filled" && now > issued.expiresAtMs) {
          const market = this.market(issued.pair);
          const point = market.history.find((p) => p.t >= issued.expiresAtMs);
          if (point && point.t - issued.expiresAtMs <= this.deps.params.feeds.staleMs)
            this.observeOutcome(issued, false, point.mid);
          issued.record.status = "expired";
        }
      }
      for (const fill of this.ledger) {
        for (const horizon of HORIZONS) {
          if (
            now < fill.ts + horizon * 1000 ||
            this.state.markouts.some((m) => m.fillId === fill.id && m.horizon === horizon)
          )
            continue;
          const due = fill.ts + horizon * 1000;
          const point = this.market(fill.pair).history.find((p) => p.t >= due);
          if (!point || point.t - due > this.deps.params.feeds.staleMs) continue;
          const bps = markoutBps(fill, point.mid);
          this.state.markouts.push({ fillId: fill.id, horizon, mid: point.mid, bps, ts: point.t });
          const taker = this.taker(fill.taker, fill.ts);
          if (horizon === 5) {
            observeMarkout(taker, bps, this.deps.params.toxicity);
            const loss = Math.max(
              0,
              (-bps / 10000) *
                fill.price *
                baseQuantity(fill, this.pairTokens(fill.pair).base.decimals),
            );
            const detectedAt =
              taker.detectedAfter && taker.firstFillAt !== null
                ? taker.firstFillAt + taker.detectedAfter.seconds * 1000
                : null;
            if (detectedAt !== null && fill.ts >= detectedAt) taker.postDetectionLossUsd += loss;
            else taker.preDetectionLossUsd += loss;
          }
          if (horizon === 300)
            taker.pnlUsd -=
              (bps / 10000) *
              fill.price *
              baseQuantity(fill, this.pairTokens(fill.pair).base.decimals);
          this.deps.emit?.({ type: "fill", fill: this.withMarkouts(fill) });
        }
      }
      if (now - this.lastTick >= this.deps.params.agent.tickMs) {
        this.checkRisk(now);
        this.rescore(now);
        this.tune(now);
        this.lastTick = now;
      }
      for (let i = this.pendingTape.length - 1; i >= 0; i--) {
        const item = this.pendingTape[i];
        if (!item || item.due > now) continue;
        this.pendingTape.splice(i, 1);
        try {
          await this.fillQuote(
            { quote: item.quote, signature: item.signature },
            "tape",
            now,
            "tape",
          );
          this.state.tape.wins += 1;
        } catch (error) {
          if (!(error instanceof EngineError)) throw error;
          this.state.tape.lost += 1;
        }
      }
      if (now - (this.state.points.at(-1)?.t ?? 0) >= this.deps.params.arena.pnlTickMs) {
        const { series: _series, ...arena } = this.arenaView();
        if (this.equityUsd(this.inventory) !== null)
          this.state.points.push({ t: now, equity: arena.equityUsd, byFlow: { ...arena.byFlow } });
        this.state.points = this.state.points.slice(-43200);
        this.deps.emit?.({ type: "arena", arena });
      }
      await this.deps.store.expireQuotes(Math.floor(now / 1000));
      await this.checkpoint();
      this.prune(now);
    });
  }

  private checkRisk(now: number): void {
    const { params } = this.deps;
    const equity = this.inventory ? this.equityUsd(this.inventory) : null;
    if (equity !== null) {
      this.state.peakEquity = Math.max(this.state.peakEquity, equity);
      const drawdown =
        this.state.peakEquity > 0 ? (this.state.peakEquity - equity) / this.state.peakEquity : 0;
      if (!this.paused && drawdown > params.risk.maxDrawdownPct) {
        this.paused = this.state.paused = true;
        this.decision(
          "pause",
          now,
          `Equity drawdown ${(drawdown * 100).toFixed(2)}% exceeds ${(params.risk.maxDrawdownPct * 100).toFixed(2)}%; operator resume required`,
          { equity, peak: this.state.peakEquity, drawdown },
        );
      }
    }
    for (const pair of params.pairs) {
      const market = this.market(pair);
      const health = market.fused.health;
      const previous = this.state.health[pair];
      if (health === "down") {
        this.state.downSince[pair] ??= now;
        delete this.state.healthySince[pair];
        if (
          !this.state.halts[pair] &&
          now - (this.state.downSince[pair] ?? now) >= params.risk.feedOutagePauseSec * 1000
        ) {
          this.state.halts[pair] = true;
          this.decision(
            "pair_halt",
            now,
            `${pair} has no healthy feeds for ${params.risk.feedOutagePauseSec}s`,
            { health, outageSeconds: (now - (this.state.downSince[pair] ?? now)) / 1000 },
            pair,
          );
        }
      } else {
        delete this.state.downSince[pair];
        if (health === "ok") this.state.healthySince[pair] ??= now;
        else delete this.state.healthySince[pair];
        if (this.state.halts[pair] && now - (this.state.healthySince[pair] ?? now) >= 30000) {
          delete this.state.halts[pair];
          this.decision(
            "pair_resume",
            now,
            `${pair} feeds healthy for 30s`,
            { healthySeconds: 30 },
            pair,
          );
        }
      }
      if (previous !== health) {
        if (health !== "ok")
          this.decision(
            "feed_degraded",
            now,
            `${pair} feed health is ${health}`,
            { health, sources: market.fused.sources.filter((s) => s.status === "ok").length },
            pair,
          );
        else if (previous)
          this.decision("feed_recovered", now, `${pair} feeds recovered`, { health }, pair);
        this.state.health[pair] = health;
      }
      const recent = this.state.markouts.filter(
        (m) =>
          m.horizon === 30 &&
          now - m.ts <= 300000 &&
          this.ledger.some((f) => f.id === m.fillId && f.pair === pair),
      );
      const mean = recent.reduce((sum, m) => sum + m.bps, 0) / recent.length;
      if (
        recent.length &&
        mean < params.risk.markoutAlarm * 10000 &&
        now - (this.state.alarmAt[pair] ?? 0) >= params.agent.cooldownMs
      ) {
        const before = this.state.tuner[pair] ?? 1;
        const after = Math.min(3, before * 1.5);
        this.state.tuner[pair] = after;
        this.state.alarmAt[pair] = now;
        this.decision(
          "spread_widen",
          now,
          `${pair} 5-minute mean markout ${mean.toFixed(1)} bps breached alarm; multiplier ${before.toFixed(2)} → ${after.toFixed(2)}`,
          { meanBps: mean, alarmBps: params.risk.markoutAlarm * 10000 },
          pair,
          null,
          { multiplier: before },
          { multiplier: after },
        );
      }
      if (market.fused.mid && this.inventory) {
        const share = this.baseShare(pair, market.fused.mid, this.inventory);
        const limit =
          share < params.inventory.minShare
            ? "buy"
            : share > params.inventory.maxShare
              ? "sell"
              : "";
        if (limit && this.state.inventoryLimited[pair] !== limit)
          this.decision(
            "inventory_limit",
            now,
            `${pair} base share ${(share * 100).toFixed(1)}%; refusing taker ${limit}`,
            { share, refusedSide: limit },
            pair,
          );
        this.state.inventoryLimited[pair] = limit;
      }
    }
    const status = this.status();
    this.deps.emit?.({
      type: "risk",
      paused: this.paused,
      riskState: status.riskState as "paused" | "normal" | "degraded",
      halted: params.pairs.filter((p) => this.state.halts[p]),
    });
  }

  private rescore(now: number): void {
    const { params } = this.deps;
    for (const taker of Object.values(this.state.takers)) {
      scoreTaker(taker, params.toxicity);
      const tier = nextTier(taker, params.toxicity, now, params.agent.cooldownMs);
      if (tier === taker.tier) continue;
      const before = taker.tier;
      taker.tier = tier;
      taker.tierChangedAt = now;
      if ((tier === "toxic" || tier === "blocked") && !taker.detectedAfter)
        taker.detectedAfter = {
          fills: taker.fills,
          seconds: (now - (taker.firstFillAt ?? now)) / 1000,
        };
      const ttl = (name: TierName) => (name === "blocked" ? 0 : params.toxicity.tiers[name].ttlSec);
      this.decision(
        "taker_tier_change",
        now,
        `${taker.address} ${before} → ${tier}; score ${taker.score.toFixed(3)}, ${taker.fills} fills, adverse ${(taker.signals.adverse * 100).toFixed(0)}%, 5s markout signal ${taker.signals.markout.toFixed(2)}, TTL ${ttl(before)}s → ${ttl(tier)}s`,
        {
          score: taker.score,
          fills: taker.fills,
          adverse: taker.signals.adverse,
          markout: taker.signals.markout,
          lateness: taker.signals.lateness,
          selectivity: taker.signals.selectivity,
        },
        null,
        taker.address,
        { tier: before, ttlSec: ttl(before) },
        { tier, ttlSec: ttl(tier) },
      );
      this.deps.emit?.({ type: "takerTier", address: taker.address, tier, score: taker.score });
    }
  }

  private tune(now: number): void {
    const { params } = this.deps;
    for (const pair of params.pairs) {
      const fills = this.ledger.filter(
        (f) => f.pair === pair && !["toxic", "blocked"].includes(this.taker(f.taker, f.ts).tier),
      );
      const samples = fills
        .map((f) => ({
          fill: f,
          mark: this.state.markouts.find((m) => m.fillId === f.id && m.horizon === 30),
        }))
        .filter((s) => s.mark)
        .slice(-params.tuner.windowFills);
      if (samples.length < params.tuner.windowFills) continue;
      const through = samples.at(-1)?.fill.id;
      if (!through || this.state.tunedThrough[pair] === through) continue;
      const last = this.state.decisions.findLast(
        (d) => d.pair === pair && (d.type === "spread_widen" || d.type === "spread_narrow"),
      );
      if (last && now - last.ts < params.agent.cooldownMs) continue;
      const mean = samples.reduce((s, x) => s + (x.mark?.bps ?? 0) / 10000, 0) / samples.length;
      const before = this.state.tuner[pair] ?? 1;
      const delta = mean < params.tuner.widenBelow ? 1 : mean > params.tuner.narrowAbove ? -1 : 0;
      const after = Math.max(
        0.5,
        Math.min(3, before + (delta * params.tuner.step) / params.spread.base[pair]),
      );
      this.state.tunedThrough[pair] = through;
      if (before === after) continue;
      this.state.tuner[pair] = after;
      this.decision(
        delta > 0 ? "spread_widen" : "spread_narrow",
        now,
        `${pair} mean 30s markout ${(mean * 10000).toFixed(1)} bps over ${samples.length} fills; multiplier ${before.toFixed(2)} → ${after.toFixed(2)}`,
        { meanBps: mean * 10000, fills: samples.length },
        pair,
        null,
        { multiplier: before },
        { multiplier: after },
      );
    }
  }

  ingestTrades(pair: Pair, venue: string, trades: Trade[], now: number): Promise<void> {
    return this.exclusive(async () => {
      const { params } = this.deps;
      if (venue !== params.feeds.tapeSource[pair]) return;
      for (const trade of [...trades].sort((a, b) => a.ts - b.ts)) {
        const key = `${pair}:${venue}:${trade.id}`;
        if (this.seenTrades.has(key)) continue;
        this.seenTrades.set(key, now);
        if (
          Math.abs(now - trade.ts) > params.feeds.staleMs ||
          (this.deps.random ?? Math.random)() >= params.arena.tapeCaptureRate
        )
          continue;
        this.state.tape.attempts += 1;
        const taker = getAddress(
          `0x${keccak256(toBytes(`tape:${venue}:${this.state.tape.attempts % 50}`)).slice(-40)}`,
        );
        const { base, quote } = this.pairTokens(pair);
        const notional = Math.min(
          trade.price * trade.size * params.arena.tapeSizeScale,
          params.arena.tapeMaxNotionalUsd,
        );
        try {
          const result = await this.issueQuote(
            {
              taker,
              tokenIn: trade.side === "buy" ? quote.address : base.address,
              tokenOut: trade.side === "buy" ? base.address : quote.address,
              amountIn: toUnits(
                trade.side === "buy" ? notional : notional / trade.price,
                trade.side === "buy" ? quote.decimals : base.decimals,
              ).toString(),
            },
            "tape",
            now,
          );
          const signed = result.response.quote;
          const price =
            trade.side === "buy"
              ? units(BigInt(signed.amountIn), quote.decimals) /
                units(BigInt(signed.amountOut), base.decimals)
              : units(BigInt(signed.amountOut), quote.decimals) /
                units(BigInt(signed.amountIn), base.decimals);
          if (trade.side === "buy" ? price > trade.price : price < trade.price) {
            this.state.tape.lost += 1;
            continue;
          }
          const [min, max] = params.arena.tapeLatencyMs;
          const due = now + min + (this.deps.random ?? Math.random)() * (max - min);
          this.pendingTape.push({ due, quote: signed, signature: result.response.signature });
        } catch (error) {
          if (!(error instanceof EngineError)) throw error;
          this.state.tape.lost += 1;
        }
      }
      for (const [key, at] of this.seenTrades) if (now - at > 300000) this.seenTrades.delete(key);
    });
  }

  pause(operator: Address, paused: boolean, now: number): Promise<void> {
    return this.exclusive(async () => {
      this.paused = this.state.paused = paused;
      // Resume acknowledges the old drawdown; a fresh drawdown trips the gate again.
      if (!paused)
        this.state.peakEquity = this.inventory
          ? (this.equityUsd(this.inventory) ?? this.state.peakEquity)
          : this.state.peakEquity;
      this.decision(
        paused ? "pause" : "resume",
        now,
        `Operator ${operator} ${paused ? "paused" : "resumed"} paper market making`,
        { operator },
      );
      await this.checkpoint();
    });
  }

  setTaker(
    operator: Address,
    address: Address,
    input: { tier?: TierName | null; label?: string },
    now: number,
  ): Promise<void> {
    return this.exclusive(async () => {
      const taker = this.taker(address, now);
      if (input.label !== undefined) taker.label = input.label;
      if (input.tier !== undefined) {
        const before = taker.tier;
        taker.override = input.tier;
        taker.tier =
          input.tier ?? nextTier({ ...taker, override: null }, this.deps.params.toxicity, now, 0);
        taker.tierChangedAt = now;
        this.decision(
          "taker_tier_change",
          now,
          `Operator ${operator} changed ${address} tier override to ${input.tier ?? "automatic"}`,
          { operator },
          null,
          address,
          { tier: before },
          { tier: taker.tier },
        );
        this.deps.emit?.({ type: "takerTier", address, tier: taker.tier, score: taker.score });
      }
      await this.checkpoint();
    });
  }

  resetArena(operator: Address, now: number): Promise<void> {
    return this.exclusive(async () => {
      for (const pair of this.deps.params.pairs) {
        this.refresh(pair, now);
        if (this.market(pair).fused.mid === null)
          throw new EngineError(
            "warming_up",
            503,
            "Fresh prices are required to fund a paper epoch",
          );
      }
      await this.checkpoint();
      await this.seedArena(now, true);
      this.issued.clear();
      this.pendingTape.length = 0;
      this.ledger = [];
      this.paused = false;
      this.decision(
        "arena_reset",
        now,
        `Operator ${operator} started paper epoch ${this.arena?.epoch}`,
        { operator, epoch: this.arena?.epoch ?? 0 },
      );
      await this.checkpoint();
    });
  }

  reloadParams(input: unknown, now: number): Promise<void> {
    return this.exclusive(async () => {
      const next = parse(paramsSchema, input);
      if (JSON.stringify(next.pairs) !== JSON.stringify(this.deps.params.pairs))
        throw new EngineError(
          "invalid_request",
          400,
          "Changing enabled pairs requires an engine restart",
        );
      const changed = Object.keys(next).filter(
        (key) => JSON.stringify(next[key]) !== JSON.stringify(this.deps.params[key]),
      );
      if (!changed.length) return;
      this.deps.params = next;
      this.decision("param_reload", now, `Strategy updated: ${changed.join(", ")}`, {
        changed: changed.join(", "),
      });
      this.deps.emit?.({ type: "params", ts: now, changed });
      await this.checkpoint();
    });
  }

  narrate(id: string, narration: string): Promise<void> {
    return this.exclusive(async () => {
      const decision = this.state.decisions.find((d) => d.id === id);
      if (!decision) return;
      decision.narration = narration.trim().split(/\s+/).slice(0, 25).join(" ");
      await this.checkpoint();
      this.deps.emit?.({ type: "decision", decision });
    });
  }

  private checkpoint(): Promise<void> {
    for (const pair of this.deps.params.pairs) this.state.prices[pair] = this.market(pair).history;
    this.state.strategy = this.deps.params;
    return this.deps.store.saveState(structuredClone(this.state));
  }

  private withMarkouts(fill: Fill): Fill {
    return {
      ...fill,
      markouts: Object.fromEntries(
        this.state.markouts
          .filter((m) => m.fillId === fill.id)
          .map((m) => [String(m.horizon), m.bps]),
      ),
    };
  }

  private setArena(epoch: number, startedAt: number, inventory: Inventory): void {
    this.arena = { epoch, startedAt };
    this.inventory = { ...inventory };
  }

  private market(pair: Pair): Market {
    const market = this.markets.get(pair);
    if (!market) throw new EngineError("invalid_request", 400, `Pair ${pair} is not enabled`);
    return market;
  }

  private pairTokens(pair: Pair): { base: Token; quote: Token } {
    const symbols = PAIR_TOKENS[pair];
    return { base: this.deps.tokens[symbols.base], quote: this.deps.tokens[symbols.quote] };
  }

  private route(tokenIn: string, tokenOut: string) {
    for (const pair of this.markets.keys()) {
      const { base, quote } = this.pairTokens(pair);
      const is = (token: Token, value: string) =>
        token.address.toLowerCase() === value.toLowerCase();
      if (is(quote, tokenIn) && is(base, tokenOut))
        return { pair, side: "buy" as const, base, quote };
      if (is(base, tokenIn) && is(quote, tokenOut))
        return { pair, side: "sell" as const, base, quote };
    }
    throw new EngineError("invalid_request", 400, "Unsupported token pair");
  }

  private tradable(pair: Pair) {
    if (this.paused) throw new EngineError("paused", 503);
    if (this.deps.params.pairs.some((p) => this.market(p).updatedAt === null))
      throw new EngineError(
        "warming_up",
        503,
        "Waiting for every enabled pair's first healthy mid",
      );
    const market = this.market(pair);
    if (this.state.halts[pair]) throw new EngineError("pair_halted", 503);
    const { mid, book, health } = market.fused;
    if (market.updatedAt === null) throw new EngineError("warming_up", 503);
    if (health === "down" || mid === null || book === null)
      throw new EngineError("pair_halted", 503);
    return { market, mid, book };
  }

  private requireInventory(): Inventory {
    if (!this.inventory) throw new EngineError("warming_up", 503, "Paper vault is not funded yet");
    return this.inventory;
  }

  private rateLimit(taker: string, now: number): void {
    const key = taker.toLowerCase();
    const recent = (this.requests.get(key) ?? []).filter((time) => now - time < 60_000);
    if (recent.length >= this.deps.params.quote.rateLimitPerMin) {
      throw new EngineError("rate_limited", 429);
    }
    recent.push(now);
    this.requests.set(key, recent);
  }

  private baseShare(pair: Pair, mid: number, inventory: Inventory): number {
    const { base, quote } = this.pairTokens(pair);
    const baseValue = units(inventory[base.symbol], base.decimals) * mid;
    // USDT is shared across pairs; each pair is treated as owning an equal slice of it.
    const quoteValue =
      units(inventory[quote.symbol], quote.decimals) / this.deps.params.pairs.length;
    const total = baseValue + quoteValue;
    return total > 0 ? baseValue / total : 0.5;
  }

  private halfSpread(pair: Pair, side: Side, mid: number, inventory: Inventory): number {
    const { params } = this.deps;
    const market = this.market(pair);
    const tier = params.toxicity.tiers.normal;
    return priceSwap(
      {
        side,
        ref: mid,
        sigma1: market.vol.sigma1,
        ttlSec: ttlSeconds(market.vol.sigma1, tier.ttlSec, params.quote),
        baseShare: this.baseShare(pair, mid, inventory),
        degraded: market.fused.health === "degraded",
        tier,
        tuner: this.state.tuner[pair] ?? 1,
        baseSpread: params.spread.base[pair],
      },
      params.spread,
      params.inventory.targetShare,
    ).half;
  }

  private equityUsd(inventory: Inventory): number | null {
    let total = 0;
    for (const symbol of TOKEN_SYMBOLS) {
      const token = this.deps.tokens[symbol];
      const amount = units(inventory[symbol], token.decimals);
      if (symbol === "USDT") {
        total += amount;
        continue;
      }
      const pair = this.deps.params.pairs.find((item) => PAIR_TOKENS[item].base === symbol);
      if (!pair) continue;
      const mid = this.market(pair).fused.mid;
      if (mid === null) return null;
      total += amount * mid;
    }
    return total;
  }
}

function nonceKey(quote: SignedQuote): string {
  return `${quote.taker.toLowerCase()}:${quote.nonce}`;
}

function tokenView(token: Token) {
  return { symbol: token.symbol, address: token.address, decimals: token.decimals };
}
