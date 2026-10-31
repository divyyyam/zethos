import type {
  Market,
  PaperQuote,
  QuoteIntent,
  QuoteResponse,
  Pair as SdkPair,
  Verification,
} from "@zethos/sdk";
import { ZethosError } from "@zethos/sdk";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { z } from "zod";
import { VENUES } from "../../engine/src/feeds/venues.js";
import { resolveAmountIn } from "./options.js";
import type { ScenarioRecorder } from "./recorder.js";
import type { Pair, ScenarioBookRecord, VenueId } from "./types.js";

/**
 * Held-out evaluation attacker. Paper-only, public endpoints only.
 *
 * Keep this file out of anything the research proposer reads. Its recordings are always
 * written with `heldOut: true` and a generic manifest description.
 */

export const LEAD_VENUE: Record<Pair, VenueId> = {
  "HSK/USDT": "hashkey-global",
  "ETH/USDT": "binance",
};

export const HELD_OUT_SOURCE = "held-out";
export const HELD_OUT_DESCRIPTION = "held-out attacker";

export interface LeadLagConfig {
  /** Minimum lead-vs-engine divergence that counts as an opportunity. */
  thresholdBps: number;
  /** Minimum edge of the signed price against the current lead mid before filling. */
  minEdgeBps: number;
  /** Lead observations older than this are ignored. */
  staleMs: number;
  /** Engine mids older than this are ignored. */
  engineStaleMs: number;
  /** Hard cap on quote requests per rolling minute. */
  maxQuotesPerMinute: number;
  /** Minimum gap between two quote requests. */
  minQuoteGapMs: number;
}

export const DEFAULT_LEAD_LAG_CONFIG: LeadLagConfig = {
  thresholdBps: 8,
  minEdgeBps: 2,
  staleMs: 1500,
  engineStaleMs: 5000,
  maxQuotesPerMinute: 20,
  minQuoteGapMs: 1500,
};

export interface MidObservation {
  mid: number;
  at: number;
}

export type Side = "buy" | "sell";

export type Opportunity =
  | { kind: "none"; reason: "no_lead" | "stale_lead" | "no_engine" | "stale_engine" | "aligned" }
  | { kind: "opportunity"; side: Side; divergenceBps: number };

/** Lead above the engine means the engine's price is stale-low: buy base. Below: sell base. */
export function detectOpportunity(
  lead: MidObservation | null,
  engine: MidObservation | null,
  now: number,
  config: LeadLagConfig,
): Opportunity {
  if (!lead) return { kind: "none", reason: "no_lead" };
  if (now - lead.at > config.staleMs) return { kind: "none", reason: "stale_lead" };
  if (!engine) return { kind: "none", reason: "no_engine" };
  if (now - engine.at > config.engineStaleMs) return { kind: "none", reason: "stale_engine" };
  const divergenceBps = (lead.mid / engine.mid - 1) * 10_000;
  if (Math.abs(divergenceBps) < config.thresholdBps) return { kind: "none", reason: "aligned" };
  return { kind: "opportunity", side: divergenceBps > 0 ? "buy" : "sell", divergenceBps };
}

/** Quote-per-base price of a signed paper quote, using runtime token decimals. */
export function quotePrice(quote: PaperQuote, side: Side, market: Market): number {
  const inDecimals = side === "buy" ? market.quote.decimals : market.base.decimals;
  const outDecimals = side === "buy" ? market.base.decimals : market.quote.decimals;
  const amountIn = Number(formatUnits(BigInt(quote.quote.amountIn), inDecimals));
  const amountOut = Number(formatUnits(BigInt(quote.quote.amountOut), outDecimals));
  if (!(amountIn > 0) || !(amountOut > 0)) return Number.NaN;
  return side === "buy" ? amountIn / amountOut : amountOut / amountIn;
}

/** Edge in bps of a fill at `price` when the true price is `leadMid`. Positive = profitable. */
export function edgeBps(side: Side, price: number, leadMid: number): number {
  if (!(price > 0) || !(leadMid > 0)) return Number.NEGATIVE_INFINITY;
  return side === "buy" ? (leadMid / price - 1) * 10_000 : (price / leadMid - 1) * 10_000;
}

/** Human amount in the sold token: USDT as given for buys, base worth the same USD for sells. */
export function soldAmount(side: Side, usdAmount: string, leadMid: number, market: Market): string {
  if (side === "buy") return usdAmount;
  const base = Number(usdAmount) / leadMid;
  if (!Number.isFinite(base) || base <= 0) throw new Error("Cannot size sell amount");
  const digits = Math.min(market.base.decimals, 8);
  return base.toFixed(digits).replace(/\.?0+$/, "");
}

export class RateLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly perMinute: number,
    private readonly minGapMs: number,
  ) {}

  canRequest(now: number): boolean {
    while (this.stamps.length > 0 && now - (this.stamps[0] ?? 0) >= 60_000) this.stamps.shift();
    const last = this.stamps[this.stamps.length - 1];
    if (last !== undefined && now - last < this.minGapMs) return false;
    return this.stamps.length < this.perMinute;
  }

  record(now: number): void {
    this.stamps.push(now);
  }
}

// ---------------------------------------------------------------------------
// Lead venue feed
// ---------------------------------------------------------------------------

export interface LeadFeed {
  latest(): MidObservation | null;
  start(): void;
  stop(): void;
}

/**
 * Polls the lead venue's public order book through the repository's verified REST adapter.
 * HashKey Global has no verified WebSocket adapter in this repo, so it is polled faster than
 * the engine's own feed cadence instead.
 */
export class RestLeadFeed implements LeadFeed {
  private last: MidObservation | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly options: {
      pair: Pair;
      venue: VenueId;
      intervalMs: number;
      fetchFn?: typeof fetch;
      now?: () => number;
      recorder?: ScenarioRecorder | null;
    },
  ) {}

  latest(): MidObservation | null {
    return this.last;
  }

  start(): void {
    void this.pollOnce();
    this.timer = setInterval(() => {
      if (!this.inFlight) void this.pollOnce();
    }, this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.abort.abort();
  }

  async pollOnce(): Promise<void> {
    const venue = VENUES[this.options.venue];
    const fetchFn = this.options.fetchFn ?? globalThis.fetch;
    const now = this.options.now ?? Date.now;
    this.inFlight = true;
    try {
      const res = await fetchFn(venue.bookUrl(this.options.pair, 20), {
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(1500)]),
      });
      if (!res.ok) return;
      const book = venue.parseBook(await res.json());
      const bid = book.bids[0]?.[0];
      const ask = book.asks[0]?.[0];
      if (!bid || !ask || ask < bid) return;
      const at = now();
      this.last = { mid: (bid + ask) / 2, at };
      const record: ScenarioBookRecord = {
        type: "book",
        ts: at,
        pair: this.options.pair,
        venue: this.options.venue,
        book: {
          bids: book.bids.slice(0, 20) as [number, number][],
          asks: book.asks.slice(0, 20) as [number, number][],
        },
      };
      this.options.recorder?.recordBook(record);
    } catch {
      // A failed poll leaves the previous observation to age out through `staleMs`.
    } finally {
      this.inFlight = false;
    }
  }
}

/** Binance public bookTicker stream (the same endpoint the existing attacker modes use). */
export class BinanceWsLeadFeed implements LeadFeed {
  private last: MidObservation | null = null;
  private socket: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;

  constructor(private readonly options: { pair: Pair; recorder?: ScenarioRecorder | null }) {}

  latest(): MidObservation | null {
    return this.last;
  }

  start(): void {
    const symbol = this.options.pair.replace("/", "").toLowerCase();
    const socket = new WebSocket(`wss://data-stream.binance.vision/ws/${symbol}@bookTicker`);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
    };
    socket.onmessage = (event) => {
      const parsed = z
        .object({
          b: z.coerce.number().positive(),
          B: z.coerce.number().positive(),
          a: z.coerce.number().positive(),
          A: z.coerce.number().positive(),
        })
        .safeParse(JSON.parse(String(event.data)));
      if (!parsed.success || parsed.data.a < parsed.data.b) return;
      const at = Date.now();
      this.last = { mid: (parsed.data.a + parsed.data.b) / 2, at };
      this.options.recorder?.recordBook({
        type: "book",
        ts: at,
        pair: this.options.pair,
        venue: "binance",
        book: { bids: [[parsed.data.b, parsed.data.B]], asks: [[parsed.data.a, parsed.data.A]] },
      });
    };
    socket.onclose = () => {
      this.last = null;
      if (!this.stopped)
        setTimeout(() => this.start(), Math.min(30_000, 500 * 2 ** this.attempt++));
    };
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface LeadLagSdk {
  market(pair?: SdkPair): Promise<Market[]>;
  quote(input: QuoteIntent): Promise<QuoteResponse>;
  verifyQuote(
    quote: QuoteResponse,
    request?: undefined,
    options?: { minRemainingSec?: number },
  ): Promise<Verification>;
  paperFill(quote: QuoteResponse): Promise<{ id: string; price: number }>;
}

export interface LeadLagStats {
  ticks: number;
  opportunities: number;
  rateLimited: number;
  quotes: number;
  declined: number;
  rejected: number;
  noEdge: number;
  verifyFailed: number;
  expired: number;
  fills: number;
  /** Paper P&L marked at the lead venue mid at fill time. An estimate, not settlement. */
  estimatedPnlUsd: number;
}

export interface LeadLagRunOptions {
  pair: Pair;
  usdAmount: string;
  taker: () => Address;
  config: LeadLagConfig;
  sdk: LeadLagSdk;
  lead: LeadFeed;
  recorder: ScenarioRecorder | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  shouldStop: () => boolean;
  maxFills?: number | undefined;
  engineRefreshMs?: number;
  log?: (line: string) => void;
}

async function requestOpportunityQuote(
  options: LeadLagRunOptions,
  current: Market,
  side: Side,
  leadMid: number,
  limiter: RateLimiter,
  stats: LeadLagStats,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  log: (line: string) => void,
): Promise<QuoteResponse | null> {
  const taker = options.taker();
  const amount = soldAmount(side, options.usdAmount, leadMid, current);
  const sold = side === "buy" ? current.quote : current.base;
  const amountIn = resolveAmountIn(amount, sold.decimals, sold.symbol);
  const requestTs = now();
  limiter.record(requestTs);
  stats.quotes++;

  let response: QuoteResponse | null = null;
  try {
    response = await options.sdk.quote({ taker, pair: options.pair as SdkPair, side, amount });
  } catch (error) {
    stats.rejected++;
    log(error instanceof ZethosError ? `quote rejected: ${error.code}` : "quote failed");
    if (error instanceof ZethosError && error.code === "rate_limited") await sleep(60_000);
  }

  options.recorder?.recordTakerRequest({
    type: "taker_request",
    ts: requestTs,
    pair: options.pair,
    side,
    amountIn,
    taker,
    ...(response?.route === "paper" ? { id: response.id, tier: response.breakdown.tier } : {}),
  });

  return response;
}

async function tryFillProfitableQuote(
  quote: PaperQuote,
  side: Side,
  current: Market,
  options: LeadLagRunOptions,
  stats: LeadLagStats,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  log: (line: string) => void,
): Promise<void> {
  const price = quotePrice(quote, side, current);
  const expiryMs = Number(quote.quote.expiry) * 1000;

  while (!options.shouldStop()) {
    if (now() >= expiryMs) {
      stats.expired++;
      return;
    }
    const latest = options.lead.latest();
    if (!latest || now() - latest.at > options.config.staleMs) {
      await sleep(100);
      continue;
    }
    const edge = edgeBps(side, price, latest.mid);
    if (edge < options.config.minEdgeBps) {
      // The engine caught up or priced the move in. Don't wait for it to drift back.
      stats.noEdge++;
      return;
    }
    const verified = await options.sdk.verifyQuote(quote, undefined, { minRemainingSec: 0 });
    if (!verified.ok) {
      stats.verifyFailed++;
      return;
    }
    try {
      const fill = await options.sdk.paperFill(quote);
      const size =
        side === "buy"
          ? Number(formatUnits(BigInt(quote.quote.amountOut), current.base.decimals))
          : Number(formatUnits(BigInt(quote.quote.amountIn), current.base.decimals));
      const pnl =
        side === "buy" ? (latest.mid - fill.price) * size : (fill.price - latest.mid) * size;
      stats.fills++;
      stats.estimatedPnlUsd += pnl;
      log(
        JSON.stringify({
          paper: true,
          side,
          fillId: fill.id,
          edgeBps: Number(edge.toFixed(2)),
          estimatedPnlUsd: Number(pnl.toFixed(4)),
        }),
      );
    } catch (error) {
      // Never retry a fill.
      stats.rejected++;
      log(error instanceof ZethosError ? `fill rejected: ${error.code}` : "fill failed");
    }
    return;
  }
}

async function fetchEngineMarket(
  sdk: LeadLagSdk,
  pair: Pair,
  now: () => number,
): Promise<{ market: Market | null; engine: MidObservation | null }> {
  try {
    const current = (await sdk.market(pair as SdkPair))[0] ?? null;
    const mid = current?.mid ?? null;
    const engine = mid && mid > 0 ? { mid, at: now() } : null;
    return { market: current, engine };
  } catch {
    return { market: null, engine: null };
  }
}

export async function runLeadLag(options: LeadLagRunOptions): Promise<LeadLagStats> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = options.log ?? (() => {});
  const limiter = new RateLimiter(options.config.maxQuotesPerMinute, options.config.minQuoteGapMs);
  const refreshMs = options.engineRefreshMs ?? 500;
  const stats: LeadLagStats = {
    ticks: 0,
    opportunities: 0,
    rateLimited: 0,
    quotes: 0,
    declined: 0,
    rejected: 0,
    noEdge: 0,
    verifyFailed: 0,
    expired: 0,
    fills: 0,
    estimatedPnlUsd: 0,
  };

  let market: Market | null = null;
  let engine: MidObservation | null = null;
  let engineFetchedAt = Number.NEGATIVE_INFINITY;

  while (!options.shouldStop()) {
    if (options.maxFills && stats.fills >= options.maxFills) break;
    stats.ticks++;
    if (now() - engineFetchedAt >= refreshMs) {
      engineFetchedAt = now();
      const updated = await fetchEngineMarket(options.sdk, options.pair, now);
      market = updated.market;
      engine = updated.engine;
    }
    const lead = options.lead.latest();
    const found = detectOpportunity(lead, engine, now(), options.config);
    if (found.kind === "none" || !market || !lead) {
      await sleep(100);
      continue;
    }
    stats.opportunities++;
    if (!limiter.canRequest(now())) {
      stats.rateLimited++;
      await sleep(100);
      continue;
    }

    const current: Market = market;
    const side = found.side;
    const response = await requestOpportunityQuote(
      options,
      current,
      side,
      lead.mid,
      limiter,
      stats,
      now,
      sleep,
      log,
    );

    if (!response) {
      await sleep(500);
      continue;
    }
    if (response.route !== "paper") {
      stats.declined++;
      await sleep(500);
      continue;
    }

    await tryFillProfitableQuote(response, side, current, options, stats, now, sleep, log);
    await sleep(250);
  }

  return stats;
}

export function summarize(stats: LeadLagStats): string {
  if (stats.quotes === 0) {
    return `No opportunities were acted on (${stats.opportunities} seen, ${stats.rateLimited} rate-limited). Nothing filled.`;
  }
  return [
    `quotes ${stats.quotes}`,
    `fills ${stats.fills}`,
    `declined ${stats.declined}`,
    `rejected ${stats.rejected}`,
    `no edge at quote ${stats.noEdge}`,
    `expired ${stats.expired}`,
    `verify failed ${stats.verifyFailed}`,
    `estimated paper P&L at lead mid ${stats.estimatedPnlUsd.toFixed(4)} USD`,
  ].join(" · ");
}
