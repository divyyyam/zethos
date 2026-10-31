import { describe, expect, test } from "bun:test";
import { fuse, median, midOf, vwap } from "../src/feeds/fuse";
import { bookAround } from "./helpers";

const options = { staleMs: 5000, maxDisagreement: 0.005, minSources: 2 };
const now = 1_000_000;

describe("fuse", () => {
  test("weights fresh sources and reports ok health", () => {
    const fused = fuse(
      [
        { venue: "gate", book: bookAround(0.1, 1000), at: now },
        { venue: "kucoin", book: bookAround(0.1002, 3000), at: now },
      ],
      now,
      options,
    );
    expect(fused.health).toBe("ok");
    expect(fused.mid).toBeGreaterThan(0.1);
    expect(fused.mid).toBeLessThan(0.1002);
    // The deeper venue pulls the mid toward itself.
    expect(Math.abs((fused.mid as number) - 0.1002)).toBeLessThan(
      Math.abs((fused.mid as number) - 0.1),
    );
  });

  test("drops outliers and stale books", () => {
    const fused = fuse(
      [
        { venue: "gate", book: bookAround(0.1), at: now },
        { venue: "kucoin", book: bookAround(0.1), at: now },
        { venue: "mexc", book: bookAround(0.12), at: now },
        { venue: "hashkey-global", book: bookAround(0.1), at: now - 10_000 },
      ],
      now,
      options,
    );
    const status = Object.fromEntries(fused.sources.map((source) => [source.venue, source.status]));
    expect(status).toEqual({
      gate: "ok",
      kucoin: "ok",
      mexc: "outlier",
      "hashkey-global": "stale",
    });
    expect(fused.mid).toBeCloseTo(0.1, 10);
  });

  test("one source is degraded, none is down", () => {
    expect(fuse([{ venue: "gate", book: bookAround(0.1), at: now }], now, options).health).toBe(
      "degraded",
    );
    const down = fuse([{ venue: "gate", book: null, at: 0 }], now, options);
    expect(down.health).toBe("down");
    expect(down.mid).toBeNull();
  });
});

describe("helpers", () => {
  test("midOf rejects crossed books", () => {
    expect(midOf({ bids: [[1.1, 1]], asks: [[1, 1]] })).toBeNull();
  });

  test("median of even and odd lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  test("vwap walks levels and returns null when too thin", () => {
    const levels = [
      [1, 10],
      [2, 10],
    ] as const;
    expect(vwap([...levels], 15)).toBeCloseTo((10 * 1 + 5 * 2) / 15);
    expect(vwap([...levels], 25)).toBeNull();
  });
});
