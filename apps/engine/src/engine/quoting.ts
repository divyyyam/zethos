<<<<<<< HEAD
import { getAddress, keccak256, toBytes } from "viem";
||||||| 94d6717
import { getAddress } from "viem";
=======
import { getAddress } from "viem";
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3
import type { Pair, Side, TierName } from "../config";
import type { QuoteRecord } from "../db";
<<<<<<< HEAD
import type { PolicyQuote } from "../policy";
import { enforceExecution, MandateBreach } from "../policy/execution";
import { POLICY_REJECTIONS } from "../policy/types";
import { amountOut } from "../pricing";
import { quoteRequestSchema, randomNonce, type SignedQuote, signQuote } from "../quotes";
import { units } from "../tokens";
||||||| 94d6717
import { vwap, vwapForQuote } from "../feeds/fuse";
import { amountOut, priceSwap, ttlSeconds } from "../pricing";
import { quoteRequestSchema, randomNonce, type SignedQuote, signQuote } from "../quotes";
import { units } from "../tokens";
=======
import { vwap, vwapForQuote } from "../feeds/fuse";
import { routeKey, signVaultQuote } from "../live";
import { amountOut, priceSwap, ttlSeconds } from "../pricing";
import {
  type QuoteRequest,
  quoteRequestSchema,
  randomNonce,
  type SignedQuote,
  signQuote,
} from "../quotes";
import { type Inventory, type Token, units } from "../tokens";
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3
import { EngineError } from "./errors";
import { nonceKey } from "./helpers";
<<<<<<< HEAD
import { decision } from "./journal";
import { recordMandateBreach, requireOperatingCapacity } from "./mandate";
import { baseShareFor, getMarket, refresh, requireInventory, route, tradable } from "./market";
import { policyInputs } from "./policy";
||||||| 94d6717
import { baseShareFor, refresh, requireInventory, route, tradable } from "./market";
=======
import { availableInventory, freshSnapshot, LIVE_SETTLEMENT, reserveOpenQuote } from "./live";
import { baseShareFor, refresh, requireInventory, route, tradable } from "./market";
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3
import type { EngineState } from "./state";
import { getTaker, observeQuote } from "./toxicity";
import type { LiveQuote, PaperQuote, PriceBreakdown } from "./types";
import { parse } from "./validation";

// A person has to confirm an approval and a fill in their wallet, and each must mine before expiry.
// The spread is priced over this longer window, so the vault is paid for holding the price open.
const LIVE_MIN_TTL_SEC = 60;

interface PricedRequest {
  pair: Pair;
  side: Side;
  tokenOut: Token;
  signed: SignedQuote;
  spotOut: string;
  vsMidBps: number;
  breakdown: PriceBreakdown;
  mid: number;
}

// Firm quote issuance; public requests enter the shared write queue. A checked vault makes every
// public quote a live one. Tape replay calls `issueQuote` directly, so it always stays on paper.
export function quote(
  context: EngineState,
  input: unknown,
  client: string | undefined,
  now: number,
  ip?: string,
): Promise<{ response: PaperQuote | LiveQuote; saved: Promise<void> }> {
  return context.exclusive<{ response: PaperQuote | LiveQuote; saved: Promise<void> }>(() =>
    context.deps.live
      ? issueLiveQuote(context, input, client, now, ip)
      : issueQuote(context, input, client, now, ip),
  );
}

<<<<<<< HEAD
interface QuotePreconditions {
  request: ReturnType<typeof parse<typeof quoteRequestSchema>>;
  pair: Pair;
  side: Side;
  base: ReturnType<typeof route>["base"];
  quote: ReturnType<typeof route>["quote"];
  market: ReturnType<typeof tradable>["market"];
  mid: number;
  inventory: ReturnType<typeof requireInventory>;
  taker: ReturnType<typeof getTaker>;
  tierName: Exclude<TierName, "blocked">;
  tier: EngineState["deps"]["params"]["toxicity"]["tiers"][Exclude<TierName, "blocked">];
  amountIn: bigint;
  notional: number;
}

async function validateQuotePreconditions(
||||||| 94d6717
export async function issueQuote(
=======
/** The price and the unsigned quote. Shared by both routes, so both price identically. */
function priceRequest(
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3
  context: EngineState,
<<<<<<< HEAD
  input: unknown,
||||||| 94d6717
  input: unknown,
  client: string | undefined,
=======
  request: QuoteRequest,
  inventoryOf: () => Inventory,
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3
  now: number,
  ip?: string,
<<<<<<< HEAD
): Promise<QuotePreconditions> {
  const request = parse(quoteRequestSchema, input);
  const { pair, side, base, quote: quoteToken } = route(context, request.tokenIn, request.tokenOut);
  for (const enabled of context.deps.params.pairs) refresh(context, enabled, now);
  await requireOperatingCapacity(context, now, pair);
  const { market, mid } = tradable(context, pair);
  const inventory = requireInventory(context);
||||||| 94d6717
): Promise<{ response: PaperQuote; saved: Promise<void> }> {
  const request = parse(quoteRequestSchema, input);
  const { pair, side, base, quote } = route(context, request.tokenIn, request.tokenOut);
  refresh(context, pair, now);
  const { market, mid, book } = tradable(context, pair);
  const inventory = requireInventory(context);
=======
  limits: { minNotionalUsd?: number; minTtlSec?: number; maxTtlSec?: number } = {},
): PricedRequest {
  const { pair, side, base, quote } = route(context, request.tokenIn, request.tokenOut);
  refresh(context, pair, now);
  const { market, mid, book } = tradable(context, pair);
  const inventory = inventoryOf();
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3
  rateLimit(context, request.taker, now);
  if (ip) rateLimit(context, `ip:${ip}`, now);

  const { params } = context.deps;
  const taker = getTaker(context, getAddress(request.taker), now);
  if (taker.detectedAfter) taker.postDetectionAttempts += 1;
  const tierName: TierName = taker.override ?? taker.tier;
  if (tierName === "blocked") throw new EngineError("taker_restricted", 403);
  const tier = params.toxicity.tiers[tierName];
  const amountIn = BigInt(request.amountIn);
  const notional =
<<<<<<< HEAD
    side === "buy" ? units(amountIn, quoteToken.decimals) : units(amountIn, base.decimals) * mid;
  if (notional < params.quote.minNotionalUsd) {
    throw new EngineError(
      "invalid_request",
      400,
      `Minimum swap is $${params.quote.minNotionalUsd}`,
    );
||||||| 94d6717
    side === "buy" ? units(amountIn, quote.decimals) : units(amountIn, base.decimals) * mid;
  if (notional < params.quote.minNotionalUsd) {
    throw new EngineError(
      "invalid_request",
      400,
      `Minimum swap is $${params.quote.minNotionalUsd}`,
    );
=======
    side === "buy" ? units(amountIn, quote.decimals) : units(amountIn, base.decimals) * mid;
  const minNotionalUsd = limits.minNotionalUsd ?? params.quote.minNotionalUsd;
  if (notional < minNotionalUsd) {
    throw new EngineError("invalid_request", 400, `Minimum swap is $${minNotionalUsd}`);
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3
  }
  if (notional > params.quote.maxNotionalUsd[pair] * tier.sizeCap) {
    throw new EngineError("vault_capacity", 422, "Amount is above the per-swap limit");
  }

  return {
    request,
    pair,
    side,
    base,
    quote: quoteToken,
    market,
    mid,
    inventory,
    taker,
    tierName,
    tier,
    amountIn,
    notional,
  };
}

function routePolicyProposal(
  context: EngineState,
  pair: Pair,
  side: Side,
  amountIn: string,
  notional: number,
  tierName: Exclude<TierName, "blocked">,
  score: number,
  market: ReturnType<typeof tradable>["market"],
  now: number,
) {
  const inputs = policyInputs(
    context,
    pair,
    side,
    amountIn,
    notional,
    tierName,
    score,
    market,
    now,
  );
  const incumbentDecision = context.policy.decide(inputs.market, inputs.inventory, inputs.request);
  const canary = context.canary;
  const canaryDecision = canary?.policy.decide(inputs.market, inputs.inventory, inputs.request);
  const nonce = randomNonce();
  const bucket = BigInt(keccak256(toBytes(nonce.toString()))) % 100n;
  const useCanary = canary !== null && Number(bucket) < canary.record.allocationPct;
  const proposed = useCanary ? canaryDecision : incumbentDecision;
  const policyId = useCanary && canary ? canary.record.id : context.policyId;
  if (canary && canaryDecision) {
    const summarize = (value: typeof incumbentDecision) =>
      value.kind === "quote" ? value.price : value.reason;
    decision(context, "policy_decision", now, `Routed nonce bucket ${bucket} to ${policyId}`, {
      policyId,
      canaryId: canary.record.id,
      canaryAssigned: useCanary ? 1 : 0,
      bucket: Number(bucket),
      incumbentDecision: summarize(incumbentDecision),
      canaryDecision: summarize(canaryDecision),
    });
  }
  if (!proposed || typeof proposed !== "object") throw new EngineError("policy_invalid", 422);
  if (proposed.kind === "reject") {
    if (!POLICY_REJECTIONS.includes(proposed.reason)) throw new EngineError("policy_invalid", 422);
    throw new EngineError(proposed.reason === "halted" ? "pair_halted" : proposed.reason, 422);
  }

  return {
    proposed,
    policyId,
    nonce,
    canary,
    useCanary,
    incumbentDecision,
    canaryDecision,
  };
}

export async function issueQuote(
  context: EngineState,
  input: unknown,
  client: string | undefined,
  now: number,
  ip?: string,
): Promise<{ response: PaperQuote; saved: Promise<void> }> {
  const pre = await validateQuotePreconditions(context, input, now, ip);
  const {
    pair,
    side,
    base,
    quote,
    market,
    mid,
    inventory,
    taker,
    tierName,
    amountIn,
    notional,
    request,
  } = pre;
  const { params } = context.deps;

  const routing = routePolicyProposal(
    context,
    pair,
    side,
    request.amountIn,
    notional,
    tierName,
    taker.score,
    market,
    now,
  );
  const { proposed, policyId, nonce, canary, useCanary, incumbentDecision, canaryDecision } =
    routing;

  const share = baseShareFor(context, pair, mid, inventory);
  if (side === "sell" ? share > params.inventory.maxShare : share < params.inventory.minShare) {
    throw new EngineError("vault_capacity", 422, "The vault is not taking this side right now");
  }

<<<<<<< HEAD
  // Policies choose prices; execution retains every tier, risk and owner limit.
  tradable(context, pair);
  let priced: PolicyQuote;
  let out: bigint;
  try {
    const execution = enforceExecution(
      {
        pair,
        side,
        amountIn: request.amountIn,
        tier: tierName,
        params,
        mandate: context.mandate,
        tokens: context.deps.tokens,
        inventory,
        mids: Object.fromEntries(
          params.pairs.map((enabled) => [enabled, getMarket(context, enabled).fused.mid]),
        ),
        book: market.fused.book ?? { bids: [], asks: [] },
        sourceMids: market.fused.sources
          .filter((source) => source.status === "ok")
          .map((source) => source.mid),
        outstanding: [...context.issued.values()]
          .filter(
            (issued) =>
              issued.record.status !== "filled" &&
              BigInt(issued.quote.expiry) >= BigInt(Math.floor(now / 1000)),
          )
          .map((issued) => ({
            pair: issued.pair,
            side: issued.side,
            amountIn: issued.quote.amountIn,
            amountOut: issued.quote.amountOut,
          })),
      },
      proposed,
    );
    priced = execution.quote;
    out = BigInt(execution.amountOut);
  } catch (error) {
    if (error instanceof MandateBreach) await recordMandateBreach(context, error, now);
    throw error;
  }
  const { ttlSec, ref } = priced;
||||||| 94d6717
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
      tuner: context.state.tuner[pair] ?? 1,
      baseSpread: params.spread.base[pair],
    },
    params.spread,
    params.inventory.targetShare,
  );

  const out = amountOut(side, amountIn, priced.price, base.decimals, quote.decimals);
  const tokenOut = side === "buy" ? base : quote;
  if (out <= 0n) throw new EngineError("invalid_request", 400, "Amount is too small");
  if (out > inventory[tokenOut.symbol]) throw new EngineError("vault_capacity", 422);
=======
  const sigma1 = market.vol.sigma1;
  const ttlSec = Math.min(
    Math.max(ttlSeconds(sigma1, tier.ttlSec, params.quote), limits.minTtlSec ?? 0),
    limits.maxTtlSec ?? Number.POSITIVE_INFINITY,
  );
  const priced = priceSwap(
    {
      side,
      ref,
      sigma1,
      ttlSec,
      baseShare: share,
      degraded: market.fused.health === "degraded",
      tier,
      tuner: context.state.tuner[pair] ?? 1,
      baseSpread: params.spread.base[pair],
    },
    params.spread,
    params.inventory.targetShare,
  );

  const out = amountOut(side, amountIn, priced.price, base.decimals, quote.decimals);
  const tokenOut = side === "buy" ? base : quote;
  if (out <= 0n) throw new EngineError("invalid_request", 400, "Amount is too small");
  if (out > inventory[tokenOut.symbol]) throw new EngineError("vault_capacity", 422);
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3

  const issuedAt = BigInt(Math.floor(now / 1000));
<<<<<<< HEAD
  const signed: SignedQuote = {
    taker: getAddress(request.taker),
    tokenIn: getAddress(request.tokenIn),
    tokenOut: getAddress(request.tokenOut),
    amountIn: request.amountIn,
    amountOut: out.toString(),
    nonce: nonce.toString(),
    issuedAt: issuedAt.toString(),
    expiry: (issuedAt + BigInt(ttlSec)).toString(),
  };
  const signature = await signQuote(context.deps.signer, context.deps.chainId, signed);
  const id = `q_${crypto.randomUUID()}`;
||||||| 94d6717
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
  const signature = await signQuote(context.deps.signer, context.deps.chainId, signed);
  const id = `q_${crypto.randomUUID()}`;
=======
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3
  const vsMid = side === "buy" ? priced.price / mid - 1 : 1 - priced.price / mid;
<<<<<<< HEAD

  const response: PaperQuote = {
    route: "paper",
    id,
    policyId,
    quote: signed,
    signature,
    paperOut: signed.amountOut,
    poolOut: null,
    poolVenue: null,
||||||| 94d6717

  const response: PaperQuote = {
    route: "paper",
    id,
    quote: signed,
    signature,
    paperOut: signed.amountOut,
    poolOut: null,
    poolVenue: null,
=======
  return {
    pair,
    side,
    tokenOut,
    mid,
    signed: {
      taker: getAddress(request.taker),
      tokenIn: getAddress(request.tokenIn),
      tokenOut: getAddress(request.tokenOut),
      amountIn: request.amountIn,
      amountOut: out.toString(),
      nonce: randomNonce().toString(),
      issuedAt: issuedAt.toString(),
      expiry: (issuedAt + BigInt(ttlSec)).toString(),
    },
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3
    spotOut: amountOut(side, amountIn, mid, base.decimals, quote.decimals).toString(),
    vsMidBps: Math.round(vsMid * 1e6) / 100,
    breakdown: {
      mid,
      ref,
      sources: market.fused.sources,
      base: priced.terms.base ?? 0,
      vol: priced.terms.vol ?? 0,
      inventory: priced.terms.inventory ?? 0,
      toxicity: priced.terms.toxicity ?? 0,
      degraded: priced.terms.degraded ?? 0,
      tuner: priced.terms.tuner ?? 1,
      half: priced.halfSpread,
      sigmaT: priced.sigmaT,
      ttlSec,
      tier: tierName,
    },
  };
}

export async function issueQuote(
  context: EngineState,
  input: unknown,
  client: string | undefined,
  now: number,
  ip?: string,
): Promise<{ response: PaperQuote; saved: Promise<void> }> {
  const request = parse(quoteRequestSchema, input);
  const { pair, side, mid, signed, spotOut, vsMidBps, breakdown } = priceRequest(
    context,
    request,
    () => requireInventory(context),
    now,
    ip,
  );
  const signature = await signQuote(context.deps.signer, context.deps.chainId, signed);
  const id = `q_${crypto.randomUUID()}`;

  const response: PaperQuote = {
    route: "paper",
    id,
    quote: signed,
    signature,
    paperOut: signed.amountOut,
    poolOut: null,
    poolVenue: null,
    spotOut,
    savingVsPoolPct: null,
    vsMidBps,
    expiresAt: Number(signed.expiry),
    breakdown,
  };

  const record: QuoteRecord = {
    id,
    policyId,
    ts: now,
    epoch: context.arena?.epoch ?? 0,
    pair,
    side,
    client: client ?? "unknown",
    quote: signed,
    signature,
    breakdown: {
      ...response.breakdown,
      ...(canary
        ? {
            policyComparison: {
              canaryId: canary.record.id,
              incumbentId: context.policyId,
              canaryPrice: canaryDecision?.kind === "quote" ? canaryDecision.price : null,
              incumbentPrice: incumbentDecision.kind === "quote" ? incumbentDecision.price : null,
              assignedCanary: useCanary,
            },
          }
        : {}),
    },
    status: "issued",
  };
  // Do not hand out a firm signature until its issuance is durable.
  await context.deps.store.saveQuote(record);
  context.issued.set(nonceKey(signed), {
    id,
    policyId,
    pair,
    side,
    quote: signed,
    mid,
    expiresAtMs: Number(signed.expiry) * 1000,
    record,
  });
  observeQuote(context, record);
  return { response, saved: Promise.resolve() };
}

/**
 * Signs for the deployed vault, within what the vault itself will accept right now. The vault still
 * enforces everything at settlement, so a stale read here costs a reverted fill, never funds.
 * Stays out of `issued`, so a live quote can't reach the paper vault or its analytics.
 */
export async function issueLiveQuote(
  context: EngineState,
  input: unknown,
  client: string | undefined,
  now: number,
  ip?: string,
): Promise<{ response: LiveQuote; saved: Promise<void> }> {
  const live = context.deps.live;
  if (!live) throw new EngineError("warming_up", 503, "The vault is not connected");
  const request = parse(quoteRequestSchema, input);
  route(context, request.tokenIn, request.tokenOut);
  const snapshot = await freshSnapshot(context, now);
  if (snapshot.paused) throw new EngineError("paused", 503);
  const vaultRoute = snapshot.routes[routeKey(request.tokenIn, request.tokenOut)];
  if (!vaultRoute?.enabled)
    throw new EngineError("pair_halted", 503, "The vault has this route switched off");
  if (BigInt(request.amountIn) > vaultRoute.maxAmountIn)
    throw new EngineError("vault_capacity", 422, "Amount is above this route's limit");

  const { pair, side, tokenOut, signed, spotOut, vsMidBps, breakdown } = priceRequest(
    context,
    request,
    () => availableInventory(context, snapshot, now),
    now,
    ip,
    {
      minNotionalUsd: context.deps.params.quote.liveMinNotionalUsd,
      minTtlSec: LIVE_MIN_TTL_SEC,
      maxTtlSec: snapshot.maxTtl,
    },
  );
  const signature = await signVaultQuote(live.signer, context.deps.chainId, live.vault, signed);
  const id = `q_${crypto.randomUUID()}`;
  const record: QuoteRecord = {
    id,
    ts: now,
    epoch: context.arena?.epoch ?? 0,
    pair,
    side,
    client: client ?? "unknown",
    quote: signed,
    signature,
    breakdown: { ...breakdown, settlement: LIVE_SETTLEMENT },
    status: "issued",
  };
  // Do not hand out a firm signature until its issuance is durable.
  await context.deps.store.saveQuote(record);
  reserveOpenQuote(context, record, tokenOut.symbol);
  return {
    response: {
      route: "conduit",
      id,
      quote: signed,
      signature,
      conduitOut: signed.amountOut,
      hskswapOut: null,
      spotOut,
      savingPct: null,
      vsMidBps,
      expiresAt: Number(signed.expiry),
      breakdown,
    },
    saved: Promise.resolve(),
  };
}

export function rateLimit(context: EngineState, taker: string, now: number): void {
  const key = taker.toLowerCase();
  const recent = (context.requests.get(key) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= context.deps.params.quote.rateLimitPerMin) {
    throw new EngineError("rate_limited", 429);
  }
  recent.push(now);
  context.requests.set(key, recent);
}
