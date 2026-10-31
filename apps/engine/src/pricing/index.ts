import type { Params, Side, Tier } from "../config";

export interface SpreadInput {
  side: Side;
  ref: number; // size-adjusted exchange price, quote per base
  sigma1: number;
  ttlSec: number;
  baseShare: number; // vault's base value / (base + quote value) for this pair
  degraded: boolean;
  tier: Tier;
  tuner: number;
  baseSpread: number;
}

export interface Terms {
  base: number;
  vol: number;
  inventory: number;
  toxicity: number;
  degraded: number;
  tuner: number;
}

export interface Priced {
  price: number;
  half: number;
  sigmaT: number;
  terms: Terms;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

// Faster markets get shorter quotes: keep σ·√TTL under ttlVolK.
export function ttlSeconds(sigma1: number, tierTtl: number, quote: Params["quote"]): number {
  const volTtl = Math.floor((quote.ttlVolK / sigma1) ** 2);
  return clamp(Math.min(quote.ttlSec, tierTtl, volTtl), quote.minTtlSec, quote.maxTtlSec);
}

export function priceSwap(
  input: SpreadInput,
  spread: Params["spread"],
  targetShare: number,
): Priced {
  const sigmaT = input.sigma1 * Math.sqrt(input.ttlSec);
  const skew = input.baseShare - targetShare;
  // Taker sells base → vault buys base: widen when the vault is already long, tighten when short.
  const terms: Terms = {
    base: input.baseSpread,
    vol: spread.kSigma * sigmaT,
    inventory: spread.kInventory * (input.side === "sell" ? skew : -skew),
    toxicity: input.tier.sigmaAdd * sigmaT,
    degraded: input.degraded ? spread.degradedAdd : 0,
    tuner: input.tuner,
  };
  const raw = terms.base + terms.vol + terms.inventory + terms.toxicity + terms.degraded;
  const half = clamp(clamp(raw, spread.min, spread.max) * input.tuner, spread.min, spread.max);
  const price = input.side === "buy" ? input.ref * (1 + half) : input.ref * (1 - half);
  return { price, half, sigmaT, terms };
}

// Convert the decimal representation of an analytical price to an exact rational.
// No raw token amount passes through Number, including at very high token decimals.
function rational(price: number): [bigint, bigint] {
  if (!Number.isFinite(price) || price <= 0) throw new Error("price must be positive");
  const [coefficient, exp = "0"] = price.toString().split("e");
  const [whole, fraction = ""] = (coefficient ?? "").split(".");
  const numerator = BigInt(`${whole}${fraction}`);
  const power = Number(exp) - fraction.length;
  return power >= 0 ? [numerator * 10n ** BigInt(power), 1n] : [numerator, 10n ** BigInt(-power)];
}

// Output amount in base units of the token received. Integer division rounds in the vault's favour.
export function amountOut(
  side: Side,
  amountIn: bigint,
  price: number,
  baseDecimals: number,
  quoteDecimals: number,
): bigint {
  const [scaled, scale] = rational(price);
  const base = 10n ** BigInt(baseDecimals);
  const quote = 10n ** BigInt(quoteDecimals);
  return side === "buy"
    ? (amountIn * base * scale) / (scaled * quote)
    : (amountIn * scaled * quote) / (scale * base);
}
