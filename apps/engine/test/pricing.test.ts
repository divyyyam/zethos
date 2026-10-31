import { describe, expect, test } from "bun:test";
import { defaultParams } from "../src/config";
import { amountOut, priceSwap, ttlSeconds } from "../src/pricing";

const { spread, quote, toxicity } = defaultParams;
const base = {
  ref: 0.1,
  sigma1: 0.0002,
  ttlSec: 30,
  baseShare: 0.5,
  degraded: false,
  tier: toxicity.tiers.normal,
  tuner: 1,
  baseSpread: 0.002,
};

describe("priceSwap", () => {
  test("buyer pays above ref, seller receives below", () => {
    const buy = priceSwap({ ...base, side: "buy" }, spread, 0.5);
    const sell = priceSwap({ ...base, side: "sell" }, spread, 0.5);
    expect(buy.price).toBeGreaterThan(0.1);
    expect(sell.price).toBeLessThan(0.1);
    expect(buy.half).toBeCloseTo(sell.half, 12);
  });

  test("inventory skew widens the side that pushes further from target", () => {
    const long = { ...base, baseShare: 0.7 };
    const sell = priceSwap({ ...long, side: "sell" }, spread, 0.5);
    const buy = priceSwap({ ...long, side: "buy" }, spread, 0.5);
    expect(sell.half).toBeGreaterThan(buy.half);
  });

  test("toxic tier adds volatility-scaled spread", () => {
    const normal = priceSwap({ ...base, side: "buy" }, spread, 0.5);
    const toxic = priceSwap({ ...base, side: "buy", tier: toxicity.tiers.toxic }, spread, 0.5);
    expect(toxic.terms.toxicity).toBeCloseTo(3 * normal.sigmaT, 12);
    expect(toxic.half).toBeGreaterThan(normal.half);
  });

  test("half spread stays within min and max", () => {
    const wild = priceSwap({ ...base, side: "buy", sigma1: 1 }, spread, 0.5);
    expect(wild.half).toBe(spread.max);
    const calm = priceSwap(
      { ...base, side: "sell", baseSpread: 0, sigma1: 0, baseShare: 0 },
      spread,
      0.5,
    );
    expect(calm.half).toBe(spread.min);
  });
});

describe("ttlSeconds", () => {
  test("shortens with volatility and respects bounds", () => {
    expect(ttlSeconds(0.0001, 30, quote)).toBe(30);
    expect(ttlSeconds(0.0005, 30, quote)).toBe(9);
    expect(ttlSeconds(0.01, 30, quote)).toBe(quote.minTtlSec);
    expect(ttlSeconds(0.0001, 3, quote)).toBe(3);
  });
});

describe("amountOut", () => {
  test("buy: 100 USDT at 0.1 gives 1000 WHSK", () => {
    expect(amountOut("buy", 100_000_000n, 0.1, 18, 6)).toBe(1000n * 10n ** 18n);
  });

  test("sell: 1000 WHSK at 0.1 gives 100 USDT", () => {
    expect(amountOut("sell", 1000n * 10n ** 18n, 0.1, 18, 6)).toBe(100_000_000n);
  });

  test("rounds down in the vault's favour", () => {
    expect(amountOut("sell", 1n, 0.1, 18, 6)).toBe(0n);
  });
});
