import type { Pair, Side } from "../config";
import { midOf } from "../feeds/fuse";
import type { PolicyInventory, PolicyMarketState, PolicyRequest } from "../policy";
import { units } from "../tokens";
import { baseShareFor, pairTokens } from "./market";
import type { EngineState } from "./state";
import type { Market } from "./types";

/** Explicit allowlists keep labels, addresses, keys and mutable engine objects out. */
export function policyInputs(
  context: EngineState,
  pair: Pair,
  side: Side,
  amountIn: string,
  notionalUsd: number,
  tier: PolicyRequest["tier"],
  score: number,
  market: Market,
  now: number,
): { market: PolicyMarketState; inventory: PolicyInventory; request: PolicyRequest } {
  const { base, quote } = pairTokens(context, pair);
  const balances = context.inventory;
  const mid = market.fused.mid;
  const book = market.fused.book;
  if (!balances || mid === null || !book) throw new Error("Policy requires a tradable market");
  const baseQuantity = side === "sell" ? units(BigInt(amountIn), base.decimals) : notionalUsd / mid;
  return {
    market: {
      now,
      pair,
      fused: {
        mid,
        health: market.fused.health,
        sourceCount: market.fused.sources.filter((source) => source.status === "ok").length,
        sigma1: market.vol.sigma1,
      },
      venues: market.fused.sources.map((source) => {
        const venue = market.venues.get(source.venue);
        const depth = (levels: typeof book.bids) =>
          levels
            .slice(0, context.deps.params.feeds.bookLevels)
            .reduce((total, [price, size]) => total + price * size, 0);
        return {
          venue: source.venue,
          mid: venue?.book ? midOf(venue.book) : null,
          bidDepthUsd: venue?.book ? depth(venue.book.bids) : 0,
          askDepthUsd: venue?.book ? depth(venue.book.asks) : 0,
          receivedAt: venue?.at ?? 0,
          status: source.status,
        };
      }),
      history: Object.fromEntries(
        Object.entries(market.venueHistory).map(([venue, samples]) => [
          venue,
          samples
            .filter((sample) => sample.t >= now - 60_000 && sample.t <= now)
            .map((sample) => ({ ...sample })),
        ]),
      ),
      book: structuredClone(book),
      tuner: context.state.tuner[pair] ?? 1,
    },
    inventory: {
      base: {
        raw: balances[base.symbol].toString(),
        usd: units(balances[base.symbol], base.decimals) * mid,
      },
      quote: {
        raw: balances[quote.symbol].toString(),
        usd: units(balances[quote.symbol], quote.decimals) / context.deps.params.pairs.length,
      },
      baseShare: baseShareFor(context, pair, mid, balances),
      targetShare: context.deps.params.inventory.targetShare,
    },
    request: { pair, side, amountIn, baseQuantity, notionalUsd, tier, score },
  };
}
