import { describe, expect, it } from "bun:test";
import type { Fill } from "../src/db";
import {
  type AttributionLeadPrice,
  type AttributionQuote,
  attributeLosses,
  type LossAttributionInput,
} from "../src/research";
import type { Tokens } from "../src/tokens";

const defaultTokens: Tokens = {
  USDT: { symbol: "USDT", address: "0x2222222222222222222222222222222222222222", decimals: 6 },
  WHSK: { symbol: "WHSK", address: "0x3333333333333333333333333333333333333333", decimals: 18 },
  WETH: { symbol: "WETH", address: "0x4444444444444444444444444444444444444444", decimals: 18 },
};

function createFill(
  overrides: Omit<Partial<Fill>, "markouts"> & {
    markouts?: Record<string, number> | undefined;
  } = {},
): Fill {
  const base: Fill = {
    id: "fill-001",
    quoteId: "quote-001",
    policyId: "v0",
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
    const fill = createFill({
      id: "fill-stale-buy",
      side: "buy",
      amountIn: "1000000000",
      price: 2.0,
      midAtFill: 2.0,
      markouts: { "5": -10, "300": -10 },
    });

    const leadPrice: AttributionLeadPrice = {
      venue: "hashkey-global",
      pair: "HSK/USDT",
      ts: fill.ts - 100,
      mid: 2.002,
    };

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      tokens: defaultTokens,
      leadPrices: [leadPrice],
      thresholds: { staleReferenceBps: 5.0, adverseSizeUsd: 50000 },
    });

    expect(res.analyzedLossUsd).toBeCloseTo(1.0, 4);
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
    const fill = createFill({
      id: "fill-non-adverse",
      side: "buy",
      amountIn: "1000000000",
      price: 2.0,
      midAtFill: 2.0,
      markouts: { "5": -10, "300": -10 },
    });

    const leadPrice: AttributionLeadPrice = {
      venue: "hashkey-global",
      pair: "HSK/USDT",
      ts: fill.ts,
      mid: 1.998,
    };

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      tokens: defaultTokens,
      leadPrices: [leadPrice],
      thresholds: { staleReferenceBps: 5.0, adverseSizeUsd: 50000 },
    });

    expect(res.causes.stale_reference.usd).toBe(0);
    expect(res.unclassifiedLossUsd).toBeCloseTo(1.0, 4);
    expect(res.unclassified.exampleFillIds).toEqual(["fill-non-adverse"]);
  });

  it("diagnoses inventory_imbalance when loss comes from residual inventory, not 5s markout", () => {
    const fill = createFill({
      id: "fill-inventory-loss",
      amountIn: "10000000000",
      markouts: {
        "5": 2.0,
        "300": -40.0,
      },
    });

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      tokens: defaultTokens,
      inventorySnapshots: {
        "fill-inventory-loss": { baseShare: 0.35, targetShare: 0.5 },
      },
      thresholds: {
        inventoryMax5sLossBps: 3.0,
        inventoryMin300sLossBps: 10.0,
        adverseSizeUsd: 50000,
      },
    });

    expect(res.analyzedLossUsd).toBeCloseTo(40.0, 4);
    expect(res.causes.inventory_imbalance.usd).toBeCloseTo(40.0, 4);
    expect(res.causes.inventory_imbalance.share).toBeCloseTo(1.0, 4);
    expect(res.causes.inventory_imbalance.fillCount).toBe(1);
    expect(res.causes.inventory_imbalance.exampleFillIds).toEqual(["fill-inventory-loss"]);
    expect(res.causes.stale_reference.usd).toBe(0);
  });

  it("does not classify inventory_imbalance when loss occurred immediately at 5s (fast adverse selection)", () => {
    const fill = createFill({
      id: "fill-fast-loss",
      amountIn: "5000000000",
      markouts: {
        "5": -40.0,
        "300": -40.0,
      },
    });

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      tokens: defaultTokens,
      inventorySnapshots: {
        "fill-fast-loss": { baseShare: 0.35, targetShare: 0.5 },
      },
      thresholds: {
        inventoryMax5sLossBps: 3.0,
        adverseSizeUsd: 50000,
      },
    });

    expect(res.causes.inventory_imbalance.usd).toBe(0);
    expect(res.unclassifiedLossUsd).toBeCloseTo(20.0, 4);
  });

  it("diagnoses selective_execution when fill arrived late in quote TTL right after a favorable move", () => {
    const issuedAt = 1700000000;
    const expiry = 1700000030;
    const fillTs = 1700000025000;

    const fill = createFill({
      id: "fill-selective",
      quoteId: "quote-sel-1",
      ts: fillTs,
      side: "buy",
      price: 2.0,
      midAtFill: 2.001,
      amountIn: "5000000000",
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
      tokens: defaultTokens,
      quotes: [quote],
      thresholds: {
        selectiveLatenessRatio: 0.6,
        selectiveFavorableMoveBps: 2.0,
        adverseSizeUsd: 50000,
      },
    });

    expect(res.analyzedLossUsd).toBeCloseTo(7.5, 4);
    expect(res.causes.selective_execution.usd).toBeCloseTo(7.5, 4);
    expect(res.causes.selective_execution.share).toBeCloseTo(1.0, 4);
    expect(res.causes.selective_execution.exampleFillIds).toEqual(["fill-selective"]);
  });

  it("rejects selective_execution when fill arrived early in quote TTL", () => {
    const issuedAt = 1700000000;
    const expiry = 1700000030;
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
      tokens: defaultTokens,
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
    const fill = createFill({
      id: "fill-whale",
      amountIn: "25000000000",
      markouts: { "5": -20, "300": -20 },
    });

    const res = attributeLosses({
      window: baseWindow,
      fills: [fill],
      tokens: defaultTokens,
      thresholds: { adverseSizeUsd: 10000 },
    });

    expect(res.analyzedLossUsd).toBeCloseTo(50.0, 4);
    expect(res.causes.adverse_size.usd).toBeCloseTo(50.0, 4);
    expect(res.causes.adverse_size.share).toBeCloseTo(1.0, 4);
    expect(res.causes.adverse_size.exampleFillIds).toEqual(["fill-whale"]);
  });

  it("handles overlapping causes without double-counting (proportional and priority)", () => {
    const fill = createFill({
      id: "fill-overlap",
      side: "buy",
      amountIn: "20000000000",
      price: 2.0,
      midAtFill: 2.0,
      markouts: { "5": -25, "300": -25 },
    });

    const leadPrice: AttributionLeadPrice = {
      venue: "hashkey-global",
      pair: "HSK/USDT",
      ts: fill.ts,
      mid: 2.002,
    };

    const lossInput: LossAttributionInput = {
      window: baseWindow,
      fills: [fill],
      tokens: defaultTokens,
      leadPrices: [leadPrice],
      thresholds: {
        staleReferenceBps: 5.0,
        adverseSizeUsd: 10000,
      },
    };

    const propRes = attributeLosses({
      ...lossInput,
      thresholds: { ...lossInput.thresholds, overlapStrategy: "proportional" },
    });

    expect(propRes.analyzedLossUsd).toBeCloseTo(50.0, 4);
    expect(propRes.causes.stale_reference.usd).toBeCloseTo(25.0, 4);
    expect(propRes.causes.adverse_size.usd).toBeCloseTo(25.0, 4);
    expect(propRes.causes.stale_reference.share).toBeCloseTo(0.5, 4);
    expect(propRes.causes.adverse_size.share).toBeCloseTo(0.5, 4);
    expect(propRes.causes.stale_reference.exampleFillIds).toEqual(["fill-overlap"]);
    expect(propRes.causes.adverse_size.exampleFillIds).toEqual(["fill-overlap"]);

    const totalCauseUsd =
      propRes.causes.stale_reference.usd +
      propRes.causes.inventory_imbalance.usd +
      propRes.causes.selective_execution.usd +
      propRes.causes.adverse_size.usd +
      propRes.unclassifiedLossUsd;
    expect(totalCauseUsd).toBeCloseTo(propRes.analyzedLossUsd, 4);

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
    const fillMissingMarkouts = createFill({
      id: "fill-no-markouts",
      markouts: undefined,
    });

    const fillUnclassified = createFill({
      id: "fill-unclassified",
      amountIn: "1000000000",
      markouts: { "5": -15, "300": -15 },
    });

    const res = attributeLosses({
      window: baseWindow,
      fills: [fillMissingMarkouts, fillUnclassified],
      tokens: defaultTokens,
      thresholds: { adverseSizeUsd: 10000 },
    });

    expect(res.excludedFills.length).toBe(1);
    expect(res.excludedFills[0]?.fillId).toBe("fill-no-markouts");
    expect(res.excludedFills[0]?.reason).toContain("Missing markout observations");

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
      tokens: defaultTokens,
    });

    const analyzedIds = res.breakdown.map((b) => b.fillId);
    expect(analyzedIds).toContain("fill-start");
    expect(analyzedIds).toContain("fill-inside");
    expect(analyzedIds).toContain("fill-end");
    expect(analyzedIds).not.toContain("fill-before");
    expect(analyzedIds).not.toContain("fill-after");
  });

  it("respects markout direction: profitable fills have zero loss and are not analyzed", () => {
    const profitableFill = createFill({
      id: "fill-profit",
      markouts: { "5": 25, "300": 30 },
    });

    const res = attributeLosses({
      window: baseWindow,
      fills: [profitableFill],
      tokens: defaultTokens,
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
      tokens: defaultTokens,
      thresholds: { adverseSizeUsd: 10000 },
    };

    const res1 = attributeLosses(input);
    const res2 = attributeLosses(input);

    expect(res1).toEqual(res2);
    expect(JSON.stringify(res1)).toBe(JSON.stringify(res2));
    expect(res1.breakdown[0]?.rawAmountIn).toBe("20000000000");
  });

  // ==================== CHECKPOINT A REGRESSION TESTS ====================

  describe("Checkpoint A Hardened Invariants", () => {
    it("excludes fills with amountIn exceeding uint256 max (2^256)", () => {
      const overUint256 = (2n ** 256n).toString();
      const fill = createFill({
        id: "fill-overflow",
        amountIn: overUint256,
      });

      const res = attributeLosses({
        window: baseWindow,
        fills: [fill],
        tokens: defaultTokens,
      });

      expect(res.excludedFills.length).toBe(1);
      expect(res.excludedFills[0]?.fillId).toBe("fill-overflow");
      expect(res.excludedFills[0]?.reason).toContain("Invalid raw token amounts");
    });

    it("excludes valuation when runtime token metadata is missing entirely or for pair", () => {
      const fill = createFill({ id: "fill-no-meta" });

      // 1. Missing tokens object entirely
      const res1 = attributeLosses({
        window: baseWindow,
        fills: [fill],
        tokens: undefined,
      });

      expect(res1.excludedFills.length).toBe(1);
      expect(res1.excludedFills[0]?.fillId).toBe("fill-no-meta");
      expect(res1.excludedFills[0]?.reason).toContain("Missing runtime token metadata");

      // 2. Tokens object missing quote token
      const partialTokens = {
        WHSK: defaultTokens.WHSK,
      } as unknown as Tokens;

      const res2 = attributeLosses({
        window: baseWindow,
        fills: [fill],
        tokens: partialTokens,
      });

      expect(res2.excludedFills.length).toBe(1);
      expect(res2.excludedFills[0]?.fillId).toBe("fill-no-meta");
      expect(res2.excludedFills[0]?.reason).toContain("Missing runtime token metadata");
    });

    it("respects non-six-decimal quote token metadata (e.g. 18 decimals)", () => {
      const customTokens: Tokens = {
        USDT: {
          symbol: "USDT",
          address: "0x2222222222222222222222222222222222222222",
          decimals: 18,
        },
        WHSK: {
          symbol: "WHSK",
          address: "0x3333333333333333333333333333333333333333",
          decimals: 18,
        },
        WETH: {
          symbol: "WETH",
          address: "0x4444444444444444444444444444444444444444",
          decimals: 18,
        },
      };

      // 1,000 * 10^18 units of quote token
      const fill = createFill({
        id: "fill-18-decimals",
        amountIn: "1000000000000000000000",
        markouts: { "5": -10, "300": -10 },
      });

      const res = attributeLosses({
        window: baseWindow,
        fills: [fill],
        tokens: customTokens,
      });

      // Notional should be 1,000 USD (from 18 decimals), and 10 bps loss = $1.00
      expect(res.breakdown[0]?.notionalUsd).toBeCloseTo(1000, 4);
      expect(res.analyzedLossUsd).toBeCloseTo(1.0, 4);
    });

    it("strictly excludes future lead observations (ts > fill.ts) from establishing stale reference", () => {
      const fill = createFill({
        id: "fill-future-lead",
        side: "buy",
        ts: 1700000005000,
        price: 2.0,
        midAtFill: 2.0,
        amountIn: "1000000000",
        markouts: { "5": -15, "300": -15 },
      });

      // Lead observation happened 500ms AFTER fill (future observation)
      const futureLead: AttributionLeadPrice = {
        venue: "hashkey-global",
        pair: "HSK/USDT",
        ts: fill.ts + 500, // in the future!
        mid: 2.005, // +25 bps
      };

      const res = attributeLosses({
        window: baseWindow,
        fills: [fill],
        tokens: defaultTokens,
        leadPrices: [futureLead],
        thresholds: { staleReferenceBps: 5.0, adverseSizeUsd: 50000 },
      });

      // Future lead cannot trigger stale reference!
      expect(res.causes.stale_reference.usd).toBe(0);
      expect(res.unclassifiedLossUsd).toBeCloseTo(1.5, 4);
    });

    it("rejects inventory_imbalance when actual inventory evidence (snapshot) is missing", () => {
      const fill = createFill({
        id: "fill-no-inventory-snapshot",
        amountIn: "5000000000",
        markouts: { "5": 0, "300": -40 }, // benign 5s, losing 300s
      });

      const res = attributeLosses({
        window: baseWindow,
        fills: [fill],
        tokens: defaultTokens,
        inventorySnapshots: undefined, // No snapshot provided!
        thresholds: {
          inventoryMax5sLossBps: 3.0,
          inventoryMin300sLossBps: 10.0,
          adverseSizeUsd: 50000,
        },
      });

      // Missing inventory evidence is NOT benign evidence!
      expect(res.causes.inventory_imbalance.usd).toBe(0);
      expect(res.unclassifiedLossUsd).toBeCloseTo(20.0, 4);
    });

    it("rejects inventory_imbalance when 5s markout observation is missing", () => {
      const fill = createFill({
        id: "fill-missing-5s",
        amountIn: "5000000000",
        markouts: { "300": -40 }, // 5s markout missing!
      });

      const res = attributeLosses({
        window: baseWindow,
        fills: [fill],
        tokens: defaultTokens,
        inventorySnapshots: {
          "fill-missing-5s": { baseShare: 0.3, targetShare: 0.5 },
        },
        thresholds: {
          inventoryMax5sLossBps: 3.0,
          inventoryMin300sLossBps: 10.0,
          adverseSizeUsd: 50000,
        },
      });

      // Missing 5s markout cannot be treated as benign
      expect(res.causes.inventory_imbalance.usd).toBe(0);
      expect(res.unclassifiedLossUsd).toBeCloseTo(20.0, 4);
    });

    it("does not treat large immediate 5s loss as benign merely because 300s loss is larger", () => {
      // 5s loss is -20 bps (> 3.0 bps threshold), 300s loss is -100 bps
      const fill = createFill({
        id: "fill-large-5s-loss",
        amountIn: "5000000000",
        markouts: {
          "5": -20.0,
          "300": -100.0,
        },
      });

      const res = attributeLosses({
        window: baseWindow,
        fills: [fill],
        tokens: defaultTokens,
        inventorySnapshots: {
          "fill-large-5s-loss": { baseShare: 0.3, targetShare: 0.5 },
        },
        thresholds: {
          inventoryMax5sLossBps: 3.0,
          inventoryMin300sLossBps: 10.0,
          adverseSizeUsd: 50000,
        },
      });

      // 5s loss was -20 bps (not benign!), so inventory_imbalance must reject
      expect(res.causes.inventory_imbalance.usd).toBe(0);
      expect(res.unclassifiedLossUsd).toBeCloseTo(50.0, 4);
    });

    it("rejects selective_execution when quote-time market evidence is missing (does not fall back to fill price)", () => {
      const fill = createFill({
        id: "fill-sel-no-mid",
        quoteId: "quote-no-mid",
        ts: 1700000025000,
        side: "buy",
        price: 2.0,
        midAtFill: 2.005,
        amountIn: "5000000000",
        markouts: { "5": -15, "300": -15 },
      });

      // Quote has NO ref and NO midAtQuote
      const quote: AttributionQuote = {
        id: "quote-no-mid",
        issuedAt: "1700000000",
        expiry: "1700000030",
        // ref and midAtQuote are omitted
      };

      const res = attributeLosses({
        window: baseWindow,
        fills: [fill],
        tokens: defaultTokens,
        quotes: [quote],
        thresholds: {
          selectiveLatenessRatio: 0.6,
          selectiveFavorableMoveBps: 2.0,
          adverseSizeUsd: 50000,
        },
      });

      // Must not fall back to fill.price!
      expect(res.causes.selective_execution.usd).toBe(0);
      expect(res.unclassifiedLossUsd).toBeCloseTo(7.5, 4);
    });

    it("respects inclusive expiry-second semantics for quote validity", () => {
      const fillOnExpiry = createFill({
        id: "fill-on-expiry",
        quoteId: "quote-expiry-check",
        ts: 1700000030999, // Within inclusive expiry second 1700000030
        side: "buy",
        price: 2.0,
        midAtFill: 2.002,
        amountIn: "5000000000",
        markouts: { "5": -10, "300": -10 },
      });

      const fillAfterExpiry = createFill({
        id: "fill-after-expiry",
        quoteId: "quote-expiry-check",
        ts: 1700000031000, // Past inclusive expiry second
        side: "buy",
        price: 2.0,
        midAtFill: 2.002,
        amountIn: "5000000000",
        markouts: { "5": -10, "300": -10 },
      });

      const quote: AttributionQuote = {
        id: "quote-expiry-check",
        issuedAt: "1700000000",
        expiry: "1700000030",
        ref: 2.0,
      };

      const res1 = attributeLosses({
        window: { fromTs: 1700000000000, toTs: 1700000040000 },
        fills: [fillOnExpiry],
        tokens: defaultTokens,
        quotes: [quote],
        thresholds: {
          selectiveLatenessRatio: 0.6,
          selectiveFavorableMoveBps: 2.0,
          adverseSizeUsd: 50000,
        },
      });
      expect(res1.causes.selective_execution.usd).toBeCloseTo(5.0, 4);

      const res2 = attributeLosses({
        window: { fromTs: 1700000000000, toTs: 1700000040000 },
        fills: [fillAfterExpiry],
        tokens: defaultTokens,
        quotes: [quote],
        thresholds: {
          selectiveLatenessRatio: 0.6,
          selectiveFavorableMoveBps: 2.0,
          adverseSizeUsd: 50000,
        },
      });
      // Expired quote cannot trigger selective execution
      expect(res2.causes.selective_execution.usd).toBe(0);
    });

    it("rejects non-finite or out-of-bounds attribution thresholds", () => {
      expect(() =>
        attributeLosses({
          window: baseWindow,
          fills: [],
          thresholds: { staleReferenceBps: -10 },
        }),
      ).toThrow("Threshold staleReferenceBps must be a positive finite number");

      expect(() =>
        attributeLosses({
          window: baseWindow,
          fills: [],
          thresholds: { selectiveLatenessRatio: 1.5 },
        }),
      ).toThrow("Threshold selectiveLatenessRatio must be between 0 and 1 inclusive");

      expect(() =>
        attributeLosses({
          window: baseWindow,
          fills: [],
          thresholds: { minLossUsd: NaN },
        }),
      ).toThrow("Threshold minLossUsd must be a non-negative finite number");
    });
  });
});
