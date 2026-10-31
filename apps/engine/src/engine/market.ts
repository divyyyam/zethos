import { zeroAddress } from "viem";
import type { Pair, Side } from "../config";
import type { BookResult } from "../feeds";
import { fuse } from "../feeds/fuse";
import { type Inventory, PAIR_TOKENS, TOKEN_SYMBOLS, type Token } from "../tokens";
import { HISTORY_POINTS } from "./constants";
import { EngineError } from "./errors";
import { tokenView } from "./helpers";
import type { EngineState } from "./state";
import type { Market } from "./types";
import { baseShare, equityUsd, halfSpread } from "./valuation";

// Market observations and read-only access to prices, tokens and inventory.
export function ingest(context: EngineState, pair: Pair, results: BookResult[], now: number): void {
  const market = getMarket(context, pair);
  for (const result of results) {
    const previous = market.venues.get(result.venue);
    market.venues.set(
      result.venue,
      result.book
        ? { venue: result.venue, book: result.book, at: now }
        : (previous ?? { venue: result.venue, book: null, at: 0 }),
    );
  }
  market.fused = fuse([...market.venues.values()], now, context.deps.params.feeds);
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
  context.deps.emit?.({ type: "price", pair, mid, health, ts: now });
}

export function refresh(context: EngineState, pair: Pair, now: number): void {
  const market = getMarket(context, pair);
  market.fused = fuse([...market.venues.values()], now, context.deps.params.feeds);
}

export function getMarket(context: EngineState, pair: Pair): Market {
  const market = context.markets.get(pair);
  if (!market) throw new EngineError("invalid_request", 400, `Pair ${pair} is not enabled`);
  return market;
}

export function pairTokens(context: EngineState, pair: Pair): { base: Token; quote: Token } {
  const symbols = PAIR_TOKENS[pair];
  return { base: context.deps.tokens[symbols.base], quote: context.deps.tokens[symbols.quote] };
}

export function route(context: EngineState, tokenIn: string, tokenOut: string) {
  for (const pair of context.markets.keys()) {
    const { base, quote } = pairTokens(context, pair);
    const is = (token: Token, value: string) => token.address.toLowerCase() === value.toLowerCase();
    if (is(quote, tokenIn) && is(base, tokenOut))
      return { pair, side: "buy" as const, base, quote };
    if (is(base, tokenIn) && is(quote, tokenOut))
      return { pair, side: "sell" as const, base, quote };
  }
  throw new EngineError("invalid_request", 400, "Unsupported token pair");
}

export function tradable(context: EngineState, pair: Pair) {
  if (context.paused) throw new EngineError("paused", 503);
  if (context.deps.params.pairs.some((p) => getMarket(context, p).updatedAt === null))
    throw new EngineError("warming_up", 503, "Waiting for every enabled pair's first healthy mid");
  const market = getMarket(context, pair);
  if (context.state.halts[pair]) throw new EngineError("pair_halted", 503);
  const { mid, book, health } = market.fused;
  if (market.updatedAt === null) throw new EngineError("warming_up", 503);
  if (health === "down" || mid === null || book === null) throw new EngineError("pair_halted", 503);
  return { market, mid, book };
}

export function requireInventory(context: EngineState): Inventory {
  if (!context.inventory) throw new EngineError("warming_up", 503, "Paper vault is not funded yet");
  return context.inventory;
}

export function baseShareFor(
  context: EngineState,
  pair: Pair,
  mid: number,
  inventory: Inventory,
): number {
  return baseShare(mid, inventory, pairTokens(context, pair), context.deps.params.pairs.length);
}

export function halfSpreadFor(
  context: EngineState,
  pair: Pair,
  side: Side,
  mid: number,
  inventory: Inventory,
): number {
  return halfSpread(
    pair,
    side,
    mid,
    inventory,
    context.deps.params,
    getMarket(context, pair),
    pairTokens(context, pair),
    context.state.tuner[pair] ?? 1,
  );
}

export function equityUsdFor(context: EngineState, inventory: Inventory): number | null {
  return equityUsd(inventory, context.deps.tokens, context.deps.params.pairs, (pair) =>
    getMarket(context, pair),
  );
}

export function getStatus(context: EngineState) {
  for (const pair of context.deps.params.pairs) refresh(context, pair, Date.now());
  const { params } = context.deps;
  const inventory = context.inventory;
  const pairs = params.pairs.map((pair) => {
    const market = getMarket(context, pair);
    const { base, quote } = pairTokens(context, pair);
    const { mid, health, sources } = market.fused;
    return {
      pair,
      base: tokenView(base),
      quote: tokenView(quote),
      mid,
      health,
      halted: Boolean(context.state.halts[pair]) || health === "down",
      sources,
      halfSpread:
        mid !== null && inventory
          ? {
              buy: halfSpreadFor(context, pair, "buy", mid, inventory),
              sell: halfSpreadFor(context, pair, "sell", mid, inventory),
            }
          : null,
      updatedAt: market.updatedAt,
    };
  });
  const degraded = pairs.some((pair) => pair.health !== "ok" || pair.halted);
  return {
    mode: "shadow" as const,
    dataSource: context.deps.dataSource ?? "live",
    chainId: context.deps.chainId,
    signer: context.signerAddress,
    operator: context.deps.operator ?? null,
    verifyingContract: zeroAddress,
    paused: context.paused,
    riskState: context.paused ? "paused" : degraded ? "degraded" : "normal",
    pairs,
    inventory: inventory
      ? Object.fromEntries(TOKEN_SYMBOLS.map((symbol) => [symbol, inventory[symbol].toString()]))
      : {},
    equityUsd: inventory ? equityUsdFor(context, inventory) : null,
  };
}

export function prune(context: EngineState, now: number): void {
  for (const [key, issued] of context.issued) {
    if (issued.expiresAtMs + 60_000 < now) context.issued.delete(key);
  }
  for (const [taker, times] of context.requests) {
    const recent = times.filter((time) => now - time < 60_000);
    if (recent.length === 0) context.requests.delete(taker);
    else context.requests.set(taker, recent);
  }
}
