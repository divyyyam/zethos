import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { sampleDeskPolicies, sampleMandate } from "../src/content/desk.mock";
import {
  computeObservedInventoryShares,
  fetchMandate,
  formatFractionAsPct,
  formatPct,
  formatUsdOrUnavailable,
  mandateSchema,
} from "../src/lib/engine/desk-types";
import { fetchPolicies, policySummarySchema } from "../src/lib/engine/policies";
import { platformConfig } from "../src/lib/platform-config";

const originalFetch = globalThis.fetch;
const originalUrl = platformConfig.engineUrl;

function respond(body: unknown, status = 200) {
  globalThis.fetch = (async () => Response.json(body, { status })) as typeof fetch;
}

beforeEach(() => {
  platformConfig.engineUrl = null;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  platformConfig.engineUrl = originalUrl;
});

describe("desk mandate schema and sample fixtures", () => {
  test("validates sample mandate against mandateSchema", () => {
    const parsed = mandateSchema.parse(sampleMandate);
    assert.deepEqual(parsed.pairs, ["HSK/USDT", "ETH/USDT"]);
    assert.equal(parsed.inventory.minShare, 0.15);
    assert.equal(parsed.inventory.maxShare, 0.85);
    assert.equal(parsed.service.uptimeTargetPct, 99);
    assert.equal(parsed.loss.maxOperatingLossUsd, 25000);
    assert.equal(parsed.canary.maxAllocationPct, 10);
    assert.equal(parsed.qualification.mustBeatHeldOut, true);
  });

  test("mandate schema rejects out-of-range fractions and invalid percentages", () => {
    assert.throws(() => {
      mandateSchema.parse({
        ...sampleMandate,
        inventory: { minShare: -0.1, maxShare: 0.85 },
      });
    });

    assert.throws(() => {
      mandateSchema.parse({
        ...sampleMandate,
        inventory: { minShare: 0.15, maxShare: 1.2 },
      });
    });

    assert.throws(() => {
      mandateSchema.parse({
        ...sampleMandate,
        service: {
          ...sampleMandate.service,
          uptimeTargetPct: 105,
        },
      });
    });
  });

  test("validates sample desk policies against policySummarySchema", () => {
    for (const p of sampleDeskPolicies) {
      const parsed = policySummarySchema.parse(p);
      assert.ok(["incumbent", "canary"].includes(parsed.status));
      assert.ok(parsed.id.startsWith("p-"));
    }
  });
});

describe("percentage and fraction conversions", () => {
  test("fraction to percentage conversion (0..1 fraction)", () => {
    assert.equal(formatFractionAsPct(0.15), "15.0%");
    assert.equal(formatFractionAsPct(0.85), "85.0%");
    assert.equal(formatFractionAsPct(0.02), "2.0%");
    assert.equal(formatFractionAsPct(0.2), "20.0%");
    assert.equal(formatFractionAsPct(0.005, 2), "0.50%");
  });

  test("handles null, undefined and non-finite fractions as Unavailable", () => {
    assert.equal(formatFractionAsPct(null), "Unavailable");
    assert.equal(formatFractionAsPct(undefined), "Unavailable");
    assert.equal(formatFractionAsPct(Number.NaN), "Unavailable");
  });

  test("percentage unit formatting (0..100 unit)", () => {
    assert.equal(formatPct(10), "10.0%");
    assert.equal(formatPct(99), "99.0%");
    assert.equal(formatPct(0), "0.0%");
    assert.equal(formatPct(100), "100.0%");
  });

  test("handles null, undefined and non-finite percentages as Unavailable", () => {
    assert.equal(formatPct(null), "Unavailable");
    assert.equal(formatPct(undefined), "Unavailable");
    assert.equal(formatPct(Number.NaN), "Unavailable");
  });

  test("currency formatting with Unavailable fallback", () => {
    assert.equal(formatUsdOrUnavailable(25000), "$25,000.00");
    assert.equal(formatUsdOrUnavailable(5), "$5.00");
    assert.equal(formatUsdOrUnavailable(null), "Unavailable");
    assert.equal(formatUsdOrUnavailable(undefined), "Unavailable");
  });
});

describe("runtime token inventory share calculations", () => {
  const pairs: Array<{
    pair: string;
    mid: number | null;
    base: { symbol: string; decimals: number; address: string };
    quote: { symbol: string; decimals: number; address: string };
  }> = [
    {
      pair: "HSK/USDT",
      mid: 0.08,
      base: { symbol: "WHSK", decimals: 18, address: "0x1111111111111111111111111111111111111111" },
      quote: { symbol: "USDT", decimals: 6, address: "0x2222222222222222222222222222222222222222" },
    },
    {
      pair: "ETH/USDT",
      mid: 2500,
      base: { symbol: "WETH", decimals: 18, address: "0x3333333333333333333333333333333333333333" },
      quote: { symbol: "USDT", decimals: 6, address: "0x2222222222222222222222222222222222222222" },
    },
  ];

  test("computes correct inventory shares from runtime decimals and mid", () => {
    const inventory = {
      WHSK: "100000000000000000000000", // 100,000 WHSK * $0.08 = $8,000
      WETH: "4000000000000000000", // 4 WETH * $2,500 = $10,000
      USDT: "20000000000", // 20,000 USDT total -> 10,000 per pair
    };

    const observed = computeObservedInventoryShares(pairs, inventory);
    assert.equal(observed.length, 2);

    const pair0 = observed[0];
    const pair1 = observed[1];
    assert.ok(pair0 && pair1);

    // Pair 1: HSK/USDT
    // baseUsd: $8,000, pairQuoteUsd: $10,000
    // baseShare: 8000 / (8000 + 10000) = 8000 / 18000 = ~0.4444 (44.4%)
    assert.equal(pair0.baseUnits, 100000);
    assert.equal(pair0.baseUsd, 8000);
    assert.equal(pair0.quoteUsd, 10000);
    assert.ok(Math.abs((pair0.baseShare ?? 0) - 8000 / 18000) < 1e-6);

    // Pair 2: ETH/USDT
    // baseUsd: $10,000, pairQuoteUsd: $10,000
    // baseShare: 10000 / (10000 + 10000) = 0.5 (50.0%)
    assert.equal(pair1.baseUnits, 4);
    assert.equal(pair1.baseUsd, 10000);
    assert.equal(pair1.quoteUsd, 10000);
    assert.equal(pair1.baseShare, 0.5);
  });

  test("unpriced or halted pairs result in null baseShare displayed as Unavailable", () => {
    const unpricedPairs: typeof pairs = [
      {
        pair: "HSK/USDT",
        mid: null,
        base: {
          symbol: "WHSK",
          decimals: 18,
          address: "0x1111111111111111111111111111111111111111",
        },
        quote: {
          symbol: "USDT",
          decimals: 6,
          address: "0x2222222222222222222222222222222222222222",
        },
      },
    ];

    const inventory = {
      WHSK: "100000000000000000000000",
      USDT: "20000000000",
    };

    const observed = computeObservedInventoryShares(unpricedPairs, inventory);
    const item = observed[0];
    assert.ok(item);
    assert.equal(item.baseShare, null);
    assert.equal(formatFractionAsPct(item.baseShare), "Unavailable");
  });
});

describe("engine configuration boundary and failure behavior", () => {
  test("unconfigured engine returns sample mandate with explicit sample label", async () => {
    platformConfig.engineUrl = null;
    const mandate = await fetchMandate();
    assert.deepEqual(mandate.pairs, sampleMandate.pairs);
    assert.equal(mandate.inventory.minShare, sampleMandate.inventory.minShare);
  });

  test("configured engine fetches from /mandate and parses response", async () => {
    platformConfig.engineUrl = "https://engine.example.test";
    respond(sampleMandate);
    const mandate = await fetchMandate();
    assert.deepEqual(mandate.pairs, sampleMandate.pairs);
  });

  test("configured engine failure NEVER silently falls back to sample fixture", async () => {
    platformConfig.engineUrl = "https://engine.example.test";
    respond({ error: "service_unavailable" }, 503);

    await assert.rejects(fetchMandate(), (err: unknown) => {
      // Must throw an error, never return sampleMandate!
      return err instanceof Error;
    });
  });

  test("configured engine schema mismatch throws and never falls back", async () => {
    platformConfig.engineUrl = "https://engine.example.test";
    // Corrupt mandate missing pairs
    respond({ inventory: { minShare: 0.15, maxShare: 0.85 } });

    await assert.rejects(fetchMandate(), (err: unknown) => {
      return err instanceof Error;
    });
  });

  test("fetchPolicies returns sample when unconfigured and throws on engine failure", async () => {
    platformConfig.engineUrl = null;
    const samplePolicies = await fetchPolicies();
    assert.equal(samplePolicies.length, 2);
    assert.ok(samplePolicies[0]);
    assert.equal(samplePolicies[0].id, "p-20261031-v0");

    platformConfig.engineUrl = "https://engine.example.test";
    respond({ error: "not_found" }, 404);
    await assert.rejects(fetchPolicies());
  });
});
