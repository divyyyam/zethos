import { describe, expect, it } from "bun:test";
import { createZethos } from "@zethos/sdk";
import { createApp } from "../src/api";
import { defaultMandate } from "../src/policy/mandate";
import { readyEngine, TAKER } from "./helpers";

describe("GET /desk/compliance", () => {
  it("measures signed half-spreads per mandate size bucket over the epoch's quotes", async () => {
    const clock = 1_800_000_000_000;
    const { engine } = await readyEngine({ now: clock });
    const app = createApp({
      engine: async () => engine,
      corsOrigins: [],
      waitUntil: () => {},
      clock: () => clock,
    });
    const sdk = createZethos({
      engineUrl: "http://engine.test",
      chainId: 177,
      client: "compliance-test",
      now: () => Math.floor(clock / 1000),
      fetch: ((input, init) => app.request(String(input), init)) as typeof fetch,
    });

    const empty = (await (await app.request("/desk/compliance")).json()) as {
      sizeBucketCompliance: { quotes: number; compliant: boolean | null }[];
      observedUptimePct: null;
    };
    expect(empty.observedUptimePct).toBeNull();
    expect(empty.sizeBucketCompliance.every((b) => b.quotes === 0 && b.compliant === null)).toBe(
      true,
    );

    const buckets = [...defaultMandate.service.maxHalfSpreadBps].sort(
      (a, b) => a.maxNotionalUsd - b.maxNotionalUsd,
    );
    await sdk.quote({ taker: TAKER, pair: "HSK/USDT", side: "buy", amount: "100" });
    await sdk.quote({ taker: TAKER, pair: "HSK/USDT", side: "sell", amount: "1000" });

    const body = (await (await app.request("/desk/compliance")).json()) as {
      sizeBucketCompliance: {
        maxNotionalUsd: number;
        quotes: number;
        compliant: boolean | null;
        observedAvgHalfSpreadBps: number | null;
        observedMaxHalfSpreadBps: number | null;
      }[];
    };
    const total = body.sizeBucketCompliance.reduce((sum, b) => sum + b.quotes, 0);
    expect(total).toBe(2);
    for (const [i, bucket] of body.sizeBucketCompliance.entries()) {
      expect(bucket.maxNotionalUsd).toBe(buckets[i]?.maxNotionalUsd ?? Number.NaN);
      if (bucket.quotes === 0) {
        expect(bucket.compliant).toBeNull();
        continue;
      }
      expect(bucket.compliant).toBe(true);
      expect(bucket.observedAvgHalfSpreadBps).toBeGreaterThan(0);
      expect(bucket.observedMaxHalfSpreadBps ?? Infinity).toBeLessThanOrEqual(
        buckets[i]?.maxBps ?? 0,
      );
    }
  });
});
