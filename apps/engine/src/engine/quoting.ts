import { getAddress } from "viem";
import type { QuoteRecord } from "../db";
import { amountOut } from "../pricing";
import { quoteRequestSchema, randomNonce, type SignedQuote, signQuote } from "../quotes";
import { units } from "../tokens";
import { EngineError } from "./errors";
import { nonceKey } from "./helpers";
import { baseShareFor, refresh, requireInventory, route, tradable } from "./market";
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

export async function issueQuote(
  context: EngineState,
  input: unknown,
  client: string | undefined,
  now: number,
  ip?: string,
): Promise<{ response: PaperQuote; saved: Promise<void> }> {
  const request = parse(quoteRequestSchema, input);
  const { pair, side, base, quote } = route(context, request.tokenIn, request.tokenOut);
  refresh(context, pair, now);
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

  const inputs = policyInputs(
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
  const priced = context.policy.decide(inputs.market, inputs.inventory, inputs.request);
  if (priced.kind === "reject") {
    throw new EngineError(priced.reason === "halted" ? "pair_halted" : priced.reason, 422);
  }

  const share = baseShareFor(context, pair, mid, inventory);
  if (side === "sell" ? share > params.inventory.maxShare : share < params.inventory.minShare) {
    throw new EngineError("vault_capacity", 422, "The vault is not taking this side right now");
  }

  const { ttlSec, ref } = priced;

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
  const signature = await signQuote(context.deps.signer, context.deps.chainId, signed);
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
    ts: now,
    epoch: context.arena?.epoch ?? 0,
    pair,
    side,
    client: client ?? "unknown",
    quote: signed,
    signature,
    breakdown: response.breakdown,
    status: "issued",
  };
  // Do not hand out a firm signature until its issuance is durable.
  await context.deps.store.saveQuote(record);
  context.issued.set(nonceKey(signed), {
    id,
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
