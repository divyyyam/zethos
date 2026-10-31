import { getAddress, keccak256, toBytes } from "viem";
import type { Pair, Side, TierName } from "../config";
import type { QuoteRecord } from "../db";
import type { PolicyQuote } from "../policy";
import { enforceExecution, MandateBreach } from "../policy/execution";
import { POLICY_REJECTIONS } from "../policy/types";
import { amountOut } from "../pricing";
import { quoteRequestSchema, randomNonce, type SignedQuote, signQuote } from "../quotes";
import { units } from "../tokens";
import { EngineError } from "./errors";
import { nonceKey } from "./helpers";
import { decision } from "./journal";
import { recordMandateBreach, requireOperatingCapacity } from "./mandate";
import { baseShareFor, getMarket, refresh, requireInventory, route, tradable } from "./market";
import { policyInputs } from "./policy";
import type { EngineState } from "./state";
import { getTaker, observeQuote } from "./toxicity";
import type { PaperQuote } from "./types";
import { parse } from "./validation";

// Firm quote issuance; public requests enter the shared write queue.
export function quote(
  context: EngineState,
  input: unknown,
  client: string | undefined,
  now: number,
  ip?: string,
): Promise<{ response: PaperQuote; saved: Promise<void> }> {
  return context.exclusive(() => issueQuote(context, input, client, now, ip));
}

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
  context: EngineState,
  input: unknown,
  now: number,
  ip?: string,
): Promise<QuotePreconditions> {
  const request = parse(quoteRequestSchema, input);
  const { pair, side, base, quote: quoteToken } = route(context, request.tokenIn, request.tokenOut);
  for (const enabled of context.deps.params.pairs) refresh(context, enabled, now);
  await requireOperatingCapacity(context, now, pair);
  const { market, mid } = tradable(context, pair);
  const inventory = requireInventory(context);
  rateLimit(context, request.taker, now);
  if (ip) rateLimit(context, `ip:${ip}`, now);

  const { params } = context.deps;
  const taker = getTaker(context, getAddress(request.taker), now);
  if (taker.detectedAfter) taker.postDetectionAttempts += 1;
  const tierName = taker.override ?? taker.tier;
  if (tierName === "blocked") throw new EngineError("taker_restricted", 403);
  const tier = params.toxicity.tiers[tierName];
  const amountIn = BigInt(request.amountIn);
  const notional =
    side === "buy" ? units(amountIn, quoteToken.decimals) : units(amountIn, base.decimals) * mid;
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

  const issuedAt = BigInt(Math.floor(now / 1000));
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
  const vsMid = side === "buy" ? priced.price / mid - 1 : 1 - priced.price / mid;

  const response: PaperQuote = {
    route: "paper",
    id,
    policyId,
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

export function rateLimit(context: EngineState, taker: string, now: number): void {
  const key = taker.toLowerCase();
  const recent = (context.requests.get(key) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= context.deps.params.quote.rateLimitPerMin) {
    throw new EngineError("rate_limited", 429);
  }
  recent.push(now);
  context.requests.set(key, recent);
}
