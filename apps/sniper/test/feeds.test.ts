import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadScenario } from "../../engine/src/research/index.js";
import { BoundedIdSet, MarketFeedCollector } from "../src/feeds.js";
import { ScenarioRecorder } from "../src/recorder.js";

describe("BoundedIdSet", () => {
  it("bounds memory to max size", () => {
    const set = new BoundedIdSet(3);
    set.add("id1");
    set.add("id2");
    set.add("id3");
    expect(set.size).toBe(3);
    expect(set.has("id1")).toBe(true);

    set.add("id4");
    expect(set.size).toBe(3);
    expect(set.has("id1")).toBe(false); // evicted oldest
    expect(set.has("id2")).toBe(true);
    expect(set.has("id4")).toBe(true);

    // Duplicate add does not increase size
    set.add("id4");
    expect(set.size).toBe(3);
  });
});

describe("MarketFeedCollector", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sniper-feeds-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("fetches book depth and trades from mock exchange feeds", async () => {
    const recorder = new ScenarioRecorder({
      name: "feeds-collection-test",
      pair: "ETH/USDT",
      scenariosDir: tmpDir,
      flushIntervalMs: 0,
    });
    await recorder.start();

    // Mock fetch for binance
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/depth")) {
        return new Response(
          JSON.stringify({
            bids: [
              ["3000.00", "5.0"],
              ["2999.50", "12.0"],
            ],
            asks: [
              ["3000.50", "4.0"],
              ["3001.00", "8.0"],
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/trades")) {
        return new Response(
          JSON.stringify([
            { id: 101, price: "3000.25", qty: "1.5", isBuyerMaker: false, time: 1700000000100 },
            { id: 102, price: "3000.50", qty: "0.8", isBuyerMaker: true, time: 1700000000200 },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const collector = new MarketFeedCollector({
      pair: "ETH/USDT",
      venues: ["binance"],
      recorder,
      fetchFn: mockFetch,
      pollIntervalMs: 0, // manual poll
    });

    const recordedCount = await collector.pollOnce();
    expect(recordedCount).toBe(3); // 1 book + 2 trades

    // Second poll with same trades should only record the book (trades deduplicated)
    const secondCount = await collector.pollOnce();
    expect(secondCount).toBe(1); // 1 book, 0 new trades

    collector.stop();
    await recorder.stop();

    const loaded = await loadScenario("feeds-collection-test", {
      scenariosDir: tmpDir,
      role: "evaluator",
    });

    expect(loaded.recordCounts.total).toBe(4); // 2 books + 2 trades
    expect(loaded.recordCounts.books).toBe(2);
    expect(loaded.recordCounts.trades).toBe(2);
    expect(loaded.recordCounts.takerRequests).toBe(0);
  });

  it("handles feed network errors and malformed responses without crashing", async () => {
    const recorder = new ScenarioRecorder({
      name: "feeds-error-test",
      pair: "ETH/USDT",
      scenariosDir: tmpDir,
    });
    await recorder.start();

    let errorReported = false;

    const failingFetch: typeof fetch = async () => {
      throw new Error("Connection refused to exchange API");
    };

    const collector = new MarketFeedCollector({
      pair: "ETH/USDT",
      venues: ["binance"],
      recorder,
      fetchFn: failingFetch,
      onError: (err) => {
        errorReported = true;
        expect(err.message).toContain("Connection refused");
      },
    });

    const count = await collector.pollOnce();
    expect(count).toBe(0);
    expect(errorReported).toBe(true);

    const statuses = collector.getVenueStatuses();
    expect(statuses[0]?.healthy).toBe(false);
    expect(statuses[0]?.errorCount).toBe(1);
    expect(collector.getHealthyVenueCount()).toBe(0);

    collector.stop();
    await recorder.stop().catch(() => {});
  });

  it("records quiet tape in capture-only mode", async () => {
    const recorder = new ScenarioRecorder({
      name: "quiet-tape-test",
      pair: "HSK/USDT",
      source: "tape",
      description: "Quiet tape capture without taker requests",
      scenariosDir: tmpDir,
      flushIntervalMs: 0,
    });
    await recorder.start();

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("hashkey")) {
        return new Response(
          JSON.stringify({
            b: [["2.10", "500"]],
            a: [["2.11", "500"]],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const collector = new MarketFeedCollector({
      pair: "HSK/USDT",
      venues: ["hashkey-global"],
      recorder,
      fetchFn: mockFetch,
    });

    await collector.pollOnce();
    collector.stop();

    const summary = await recorder.stop();
    expect(summary.counts.total).toBe(1);
    expect(summary.counts.books).toBe(1);
    expect(summary.counts.takerRequests).toBe(0);

    const loaded = await loadScenario("quiet-tape-test", {
      scenariosDir: tmpDir,
      role: "research",
    });

    expect(loaded.manifest.source).toBe("tape");
    expect(loaded.recordCounts.takerRequests).toBe(0);
    expect(loaded.recordCounts.books).toBe(1);
  });
});
