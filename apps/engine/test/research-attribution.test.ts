import { describe, expect, it } from "bun:test";
import type { Fill } from "../src/db";
import {
  type AttributionLeadPrice,
  type AttributionQuote,
  attributeLosses,
  type LossAttributionInput,
} from "../src/research";

function createFill(
  overrides: Omit<Partial<Fill>, "markouts"> & {
    markouts?: Record<string, number> | undefined;
  } = {},
): Fill {
  const base: Fill = {
    id: "fill-001",
    quoteId: "quote-001",
    ts: 1700000005000,
    taker: "0x1111111111111111111111111111111111111111",
    pair: "HSK/USDT",
    side: "buy",
    tokenIn: "0x2222222222222222222222222222222222222222",
    tokenOut: "0x3333333333333333333333333333333333333333",
    amountIn: "1000000000", // 1,000 USDT (6 decimals)
    amountOut: "500000000000000000000", // 500 HSK (18 decimals)
    price: 2.0,
    midAtFill: 2.0,
    flow: "user",
    paper: true,
    txHash: null,
    markouts: {
      "5": -20, // -20 bps markout (loss)
      "300": -20,
    },
  };

  const { markouts, ...rest } = overrides;
  const result: Fill = { ...base, ...rest };
  if ("markouts" in overrides) {
    if (markouts === undefined) {
      delete result.markouts;
    } else {
      result.markouts = markouts;
    }
  }
  return result;
}

describe("S6 Loss Attribution (pure deterministic diagnosis)", () => {
  const baseWindow = { fromTs: 1700000000000, toTs: 1700000060000 };

  it("diagnoses stale_reference when lead venue diverges adversely at fill time", () => {
    // Taker buys HSK at fused mid 2.0. Lead venue mid is 2.0020 (+10 bps divergence)
    const fill = createFill({
      id: "fill-stale-buy",
      side: "buy",
      amountIn: "1000000000", // 1,000 USDT
      price: 2.0,
      midAtFill: 2.0,
      markouts: { "5": -10, "300": -10 },
    });

    const leadPrice: AttributionLeadPrice = {
      venue: "hashkey-global",
      pair: "HSK/USDT",
      ts: fill.ts - 100, // 100ms before fill
      mid: 2.002, // +10 bps higher than fused mid 2.0
    };

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      leadPrices: [leadPrice],
      thresholds: { staleReferenceBps: 5.0, adverseSizeUsd: 50000 },
    });

    expect(res.analyzedLossUsd).toBeCloseTo(1.0, 4); // 10 bps on 1000 USDT = $1.00
    expect(res.causes.stale_reference.usd).toBeCloseTo(1.0, 4);
    expect(res.causes.stale_reference.share).toBeCloseTo(1.0, 4);
    expect(res.causes.stale_reference.fillCount).toBe(1);
    expect(res.causes.stale_reference.exampleFillIds).toEqual(["fill-stale-buy"]);
    expect(res.causes.inventory_imbalance.usd).toBe(0);
    expect(res.causes.selective_execution.usd).toBe(0);
    expect(res.causes.adverse_size.usd).toBe(0);
    expect(res.unclassifiedLossUsd).toBe(0);
  });

  it("does not classify stale_reference when lead move is non-adverse to maker", () => {
    // Taker buys HSK at fused mid 2.0. Lead venue is lower (1.998, -10 bps), which is favorable to maker
    const fill = createFill({
      id: "fill-non-adverse",
      side: "buy",
      amountIn: "1000000000", // 1,000 USDT
      price: 2.0,
      midAtFill: 2.0,
      markouts: { "5": -10, "300": -10 },
    });

    const leadPrice: AttributionLeadPrice = {
      venue: "hashkey-global",
      pair: "HSK/USDT",
      ts: fill.ts,
      mid: 1.998, // -10 bps (not adverse for buy)
    };

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      leadPrices: [leadPrice],
      thresholds: { staleReferenceBps: 5.0, adverseSizeUsd: 50000 },
    });

    expect(res.causes.stale_reference.usd).toBe(0);
    expect(res.unclassifiedLossUsd).toBeCloseTo(1.0, 4);
    expect(res.unclassified.exampleFillIds).toEqual(["fill-non-adverse"]);
  });

  it("diagnoses inventory_imbalance when loss comes from residual inventory, not 5s markout", () => {
    // 5s markout is benign (+2 bps profit), 300s markout is -40 bps loss
    const fill = createFill({
      id: "fill-inventory-loss",
      amountIn: "10000000000", // 10,000 USDT
      markouts: {
        "5": 2.0, // maker made 2 bps at 5s
        "300": -40.0, // maker lost 40 bps at 300s
      },
    });

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      inventorySnapshots: {
        "fill-inventory-loss": { baseShare: 0.35, targetShare: 0.5 }, // vault was short base, and taker bought more
      },
      thresholds: {
        inventoryMax5sLossBps: 3.0,
        inventoryMin300sLossBps: 10.0,
        adverseSizeUsd: 50000,
      },
    });

    // 40 bps on 10,000 USDT = $40.00
    expect(res.analyzedLossUsd).toBeCloseTo(40.0, 4);
    expect(res.causes.inventory_imbalance.usd).toBeCloseTo(40.0, 4);
    expect(res.causes.inventory_imbalance.share).toBeCloseTo(1.0, 4);
    expect(res.causes.inventory_imbalance.fillCount).toBe(1);
    expect(res.causes.inventory_imbalance.exampleFillIds).toEqual(["fill-inventory-loss"]);
    expect(res.causes.stale_reference.usd).toBe(0);
  });

  it("does not classify inventory_imbalance when loss occurred immediately at 5s (fast adverse selection)", () => {
    // 5s markout lost -40 bps, 300s markout lost -40 bps -> loss is fast adverse selection, not residual inventory drift
    const fill = createFill({
      id: "fill-fast-loss",
      amountIn: "5000000000", // 5,000 USDT
      markouts: {
        "5": -40.0,
        "300": -40.0,
      },
    });

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      thresholds: {
        inventoryMax5sLossBps: 3.0,
        adverseSizeUsd: 50000,
      },
    });

    // 5s loss is -40 bps (> 3.0 bps threshold), so not inventory_imbalance
    expect(res.causes.inventory_imbalance.usd).toBe(0);
    expect(res.unclassifiedLossUsd).toBeCloseTo(20.0, 4);
  });

  it("diagnoses selective_execution when fill arrived late in quote TTL right after a favorable move", () => {
    const issuedAt = 1700000000; // seconds
    const expiry = 1700000030; // 30s TTL
    // Fill occurs at 25 seconds into 30s TTL => lateness = 25/30 = 0.833 (> 0.60 threshold)
    const fillTs = 1700000025000;

    const fill = createFill({
      id: "fill-selective",
      quoteId: "quote-sel-1",
      ts: fillTs,
      side: "buy",
      price: 2.0,
      midAtFill: 2.001, // fused mid moved up +5 bps from quote ref 2.0
      amountIn: "5000000000", // 5,000 USDT
      markouts: { "5": -15, "300": -15 },
    });

    const quote: AttributionQuote = {
      id: "quote-sel-1",
      issuedAt: String(issuedAt),
      expiry: String(expiry),
      ref: 2.0,
      midAtQuote: 2.0,
    };

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      quotes: [quote],
      thresholds: {
        selectiveLatenessRatio: 0.6,
        selectiveFavorableMoveBps: 2.0,
        adverseSizeUsd: 50000,
      },
    });

    // 15 bps on 5000 USDT = $7.50
    expect(res.analyzedLossUsd).toBeCloseTo(7.5, 4);
    expect(res.causes.selective_execution.usd).toBeCloseTo(7.5, 4);
    expect(res.causes.selective_execution.share).toBeCloseTo(1.0, 4);
    expect(res.causes.selective_execution.exampleFillIds).toEqual(["fill-selective"]);
  });

  it("rejects selective_execution when fill arrived early in quote TTL", () => {
    const issuedAt = 1700000000;
    const expiry = 1700000030;
    // Fill occurs at 5 seconds into 30s TTL => lateness = 5/30 = 0.167 (< 0.60 threshold)
    const fillTs = 1700000005000;

    const fill = createFill({
      id: "fill-early",
      quoteId: "quote-sel-2",
      ts: fillTs,
      side: "buy",
      price: 2.0,
      midAtFill: 2.001,
      amountIn: "5000000000",
      markouts: { "5": -15, "300": -15 },
    });

    const quote: AttributionQuote = {
      id: "quote-sel-2",
      issuedAt: String(issuedAt),
      expiry: String(expiry),
      ref: 2.0,
    };

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      quotes: [quote],
      thresholds: {
        selectiveLatenessRatio: 0.6,
        adverseSizeUsd: 50000,
      },
    });

    expect(res.causes.selective_execution.usd).toBe(0);
    expect(res.unclassifiedLossUsd).toBeCloseTo(7.5, 4);
  });

  it("diagnoses adverse_size when notional exceeds threshold", () => {
    // 25,000 USDT (> 10,000 USD threshold)
    const fill = createFill({
      id: "fill-whale",
      amountIn: "25000000000", // 25,000 USDT
      markouts: { "5": -20, "300": -20 },
    });

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      thresholds: { adverseSizeUsd: 10000 },
    });

    // 20 bps on 25,000 USDT = $50.00
    expect(res.analyzedLossUsd).toBeCloseTo(50.0, 4);
    expect(res.causes.adverse_size.usd).toBeCloseTo(50.0, 4);
    expect(res.causes.adverse_size.share).toBeCloseTo(1.0, 4);
    expect(res.causes.adverse_size.exampleFillIds).toEqual(["fill-whale"]);
  });

  it("handles overlapping causes without double-counting (proportional and priority)", () => {
    // Fill has BOTH stale_reference (lead moved +10 bps) AND adverse_size ($20,000 notional)
    const fill = createFill({
      id: "fill-overlap",
      side: "buy",
      amountIn: "20000000000", // 20,000 USDT
      price: 2.0,
      midAtFill: 2.0,
      markouts: { "5": -25, "300": -25 },
    });

    const leadPrice: AttributionLeadPrice = {
      venue: "hashkey-global",
      pair: "HSK/USDT",
      ts: fill.ts,
      mid: 2.002, // +10 bps
    };

    // Total loss = 25 bps on $20,000 = $50.00
    const lossInput: LossAttributionInput = {
      window: baseWindow,
      fills: [fill],
      leadPrices: [leadPrice],
      thresholds: {
        staleReferenceBps: 5.0,
        adverseSizeUsd: 10000,
      },
    };

    // 1. Proportional split (default)
    const propRes = attributeLosses({
      ...lossInput,
      thresholds: { ...lossInput.thresholds, overlapStrategy: "proportional" },
    });

    expect(propRes.analyzedLossUsd).toBeCloseTo(50.0, 4);
    expect(propRes.causes.stale_reference.usd).toBeCloseTo(25.0, 4); // 50%
    expect(propRes.causes.adverse_size.usd).toBeCloseTo(25.0, 4); // 50%
    expect(propRes.causes.stale_reference.share).toBeCloseTo(0.5, 4);
    expect(propRes.causes.adverse_size.share).toBeCloseTo(0.5, 4);
    // Both causes list the fill ID
    expect(propRes.causes.stale_reference.exampleFillIds).toEqual(["fill-overlap"]);
    expect(propRes.causes.adverse_size.exampleFillIds).toEqual(["fill-overlap"]);
    // Total sum exactly matches analyzed loss (NO DOUBLE COUNTING)
    const totalCauseUsd =
      propRes.causes.stale_reference.usd +
      propRes.causes.inventory_imbalance.usd +
      propRes.causes.selective_execution.usd +
      propRes.causes.adverse_size.usd +
      propRes.unclassifiedLossUsd;
    expect(totalCauseUsd).toBeCloseTo(propRes.analyzedLossUsd, 4);

    // 2. Priority split (stale_reference takes 100%)
    const prioRes = attributeLosses({
      ...lossInput,
      thresholds: {
        ...lossInput.thresholds,
        overlapStrategy: "priority",
        causePriority: ["stale_reference", "adverse_size"],
      },
    });

    expect(prioRes.analyzedLossUsd).toBeCloseTo(50.0, 4);
    expect(prioRes.causes.stale_reference.usd).toBeCloseTo(50.0, 4);
    expect(prioRes.causes.adverse_size.usd).toBe(0);
    expect(prioRes.causes.stale_reference.share).toBeCloseTo(1.0, 4);
    expect(prioRes.causes.adverse_size.share).toBe(0);
  });

  it("keeps missing evidence explicitly unclassified or excluded without fabrication", () => {
    // Fill 1 has missing markouts entirely
    const fillMissingMarkouts = createFill({
      id: "fill-no-markouts",
      markouts: undefined,
    });

    // Fill 2 has loss but no lead prices, no quote, small size, and fast 5s markout loss -> unclassified
    const fillUnclassified = createFill({
      id: "fill-unclassified",
      amountIn: "1000000000", // $1,000 (small)
      markouts: { "5": -15, "300": -15 },
    });

    const res = attributeLosses({
      window: baseWindow,
      fills: [fillMissingMarkouts, fillUnclassified],
      thresholds: { adverseSizeUsd: 10000 },
    });

    // fill-no-markouts must be in excludedFills
    expect(res.excludedFills.length).toBe(1);
    expect(res.excludedFills[0]?.fillId).toBe("fill-no-markouts");
    expect(res.excludedFills[0]?.reason).toContain("Missing markout observations");

    // fill-unclassified must be in unclassified
    expect(res.unclassifiedLossUsd).toBeCloseTo(1.5, 4);
    expect(res.unclassified.share).toBeCloseTo(1.0, 4);
    expect(res.unclassified.exampleFillIds).toEqual(["fill-unclassified"]);
  });

  it("respects window boundaries strictly", () => {
    const beforeFill = createFill({ id: "fill-before", ts: baseWindow.fromTs - 1 });
    const atStartFill = createFill({ id: "fill-start", ts: baseWindow.fromTs });
    const insideFill = createFill({ id: "fill-inside", ts: baseWindow.fromTs + 10000 });
    const atEndFill = createFill({ id: "fill-end", ts: baseWindow.toTs });
    const afterFill = createFill({ id: "fill-after", ts: baseWindow.toTs + 1 });

    const res = attributeLosses({
      window: baseWindow,
      fills: [beforeFill, atStartFill, insideFill, atEndFill, afterFill],
    });

    const analyzedIds = res.breakdown.map((b) => b.fillId);
    expect(analyzedIds).toContain("fill-start");
    expect(analyzedIds).toContain("fill-inside");
    expect(analyzedIds).toContain("fill-end");
    expect(analyzedIds).not.toContain("fill-before");
    expect(analyzedIds).not.toContain("fill-after");
  });

  it("respects markout direction: profitable fills have zero loss and are not analyzed", () => {
    // Positive markout (+25 bps) means maker profit
    const profitableFill = createFill({
      id: "fill-profit",
      markouts: { "5": 25, "300": 30 },
    });

    const res = attributeLosses({
      window: baseWindow,
      fills: [profitableFill],
    });

    expect(res.analyzedLossUsd).toBe(0);
    expect(res.totalLossUsd).toBe(0);
    expect(res.breakdown.length).toBe(0);
    for (const cause of [
      "stale_reference",
      "inventory_imbalance",
      "selective_execution",
      "adverse_size",
    ] as const) {
      expect(res.causes[cause].usd).toBe(0);
      expect(res.causes[cause].share).toBe(0);
    }
  });

  it("is strictly deterministic across repeated runs", () => {
    const fills = [
      createFill({ id: "f1", ts: 1700000005000, amountIn: "20000000000" }),
      createFill({ id: "f2", ts: 1700000010000, amountIn: "5000000000" }),
      createFill({ id: "f3", ts: 1700000015000, amountIn: "1000000000" }),
    ];

    const input: LossAttributionInput = {
      window: baseWindow,
      fills,
      thresholds: { adverseSizeUsd: 10000 },
    };

    const res1 = attributeLosses(input);
    const res2 = attributeLosses(input);

    expect(res1).toEqual(res2);
    expect(JSON.stringify(res1)).toBe(JSON.stringify(res2));
    expect(res1.breakdown[0]?.rawAmountIn).toBe("20000000000");
  });
});
