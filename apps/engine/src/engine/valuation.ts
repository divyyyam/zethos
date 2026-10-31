import type { Pair, Params, Side } from "../config";
import { priceSwap, ttlSeconds } from "../pricing";
import {
  type Inventory,
  PAIR_TOKENS,
  TOKEN_SYMBOLS,
  type Token,
  type Tokens,
  units,
} from "../tokens";
import type { Market } from "./types";

export function baseShare(
  mid: number,
  inventory: Inventory,
  tokens: { base: Token; quote: Token },
  pairCount: number,
): number {
  const { base, quote } = tokens;
  const baseValue = units(inventory[base.symbol], base.decimals) * mid;
  // USDT is shared across pairs; each pair is treated as owning an equal slice of it.
  const quoteValue = units(inventory[quote.symbol], quote.decimals) / pairCount;
  const total = baseValue + quoteValue;
  return total > 0 ? baseValue / total : 0.5;
}

export function halfSpread(
  pair: Pair,
  side: Side,
  mid: number,
  inventory: Inventory,
  params: Params,
  market: Market,
  tokens: { base: Token; quote: Token },
  tuner: number,
): number {
  const tier = params.toxicity.tiers.normal;
  return priceSwap(
    {
      side,
      ref: mid,
      sigma1: market.vol.sigma1,
      ttlSec: ttlSeconds(market.vol.sigma1, tier.ttlSec, params.quote),
      baseShare: baseShare(mid, inventory, tokens, params.pairs.length),
      degraded: market.fused.health === "degraded",
      tier,
      tuner: tuner,
      baseSpread: params.spread.base[pair],
    },
    params.spread,
    params.inventory.targetShare,
  ).half;
}

export function equityUsd(
  inventory: Inventory,
  tokens: Tokens,
  pairs: Pair[],
  market: (pair: Pair) => Market,
): number | null {
  let total = 0;
  for (const symbol of TOKEN_SYMBOLS) {
    const token = tokens[symbol];
    const amount = units(inventory[symbol], token.decimals);
    if (symbol === "USDT") {
      total += amount;
      continue;
    }
    const pair = pairs.find((item) => PAIR_TOKENS[item].base === symbol);
    if (!pair) continue;
    const mid = market(pair).fused.mid;
    if (mid === null) return null;
    total += amount * mid;
  }
  return total;
}
