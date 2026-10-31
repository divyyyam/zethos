import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  HeldOutAccessError,
  loadScenario,
  loadScenarioManifest,
} from "../../engine/src/research/index.js";
import { ScenarioRecorder, ScenarioSecurityError, validateScenarioName } from "../src/recorder.js";
import type {
  ScenarioBookRecord,
  ScenarioTakerRequestRecord,
  ScenarioTradeRecord,
} from "../src/types.js";

describe("ScenarioRecorder", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sniper-recorder-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("validates scenario names and rejects path traversal", () => {
    expect(() => validateScenarioName("")).toThrow(ScenarioSecurityError);
    expect(() => validateScenarioName("../escaped")).toThrow(ScenarioSecurityError);
    expect(() => validateScenarioName("sub/folder")).toThrow(ScenarioSecurityError);
    expect(() => validateScenarioName("sub\\folder")).toThrow(ScenarioSecurityError);
    expect(() => validateScenarioName("bad name with spaces")).toThrow(ScenarioSecurityError);
    expect(() => validateScenarioName("bad*char")).toThrow(ScenarioSecurityError);

    // valid names
    validateScenarioName("eth-sniper-01");
    validateScenarioName("hsk_quiet_tape_20261101");
  });

  it("refuses to overwrite existing recording files", async () => {
    const existingFile = path.join(tmpDir, "existing-test.json");
    await fs.writeFile(existingFile, "{}");

    expect(
      () =>
        new ScenarioRecorder({
          name: "existing-test",
          pair: "ETH/USDT",
          scenariosDir: tmpDir,
        }),
    ).toThrow(/already exists/);

    const existingNdjson = path.join(tmpDir, "existing-ndjson.ndjson");
    await fs.writeFile(existingNdjson, "");

    expect(
      () =>
        new ScenarioRecorder({
          name: "existing-ndjson",
          pair: "ETH/USDT",
          scenariosDir: tmpDir,
        }),
    ).toThrow(/already exists/);
  });

  it("records books, trades, and requests and round-trips through engine loader", async () => {
    const recorder = new ScenarioRecorder({
      name: "roundtrip-test",
      pair: "ETH/USDT",
      source: "sniper",
      heldOut: false,
      description: "Roundtrip test recording",
      scenariosDir: tmpDir,
      flushIntervalMs: 0, // manual flush
    });
    await recorder.start();

    const bookRecord: ScenarioBookRecord = {
      type: "book",
      ts: 1700000001000,
      pair: "ETH/USDT",
      venue: "binance",
      book: {
        bids: [
          [2500.5, 10.5],
          [2500.0, 20.0],
        ],
        asks: [
          [2501.0, 8.0],
          [2501.5, 15.0],
        ],
      },
    };

    const tradeRecord: ScenarioTradeRecord = {
      type: "trade",
      ts: 1700000002000,
      pair: "ETH/USDT",
      venue: "binance",
      trade: {
        id: "tr-001",
        ts: 1700000002000,
        side: "buy",
        price: 2501.0,
        size: 2.5,
      },
    };

    const successfulRequest: ScenarioTakerRequestRecord = {
      type: "taker_request",
      ts: 1700000003000,
      pair: "ETH/USDT",
      side: "buy",
      amountIn: "100000000", // 100 USDT (6 decimals)
      taker: "0x1111111111111111111111111111111111111111",
      id: "quote-123",
      tier: "normal",
      score: 0.1,
    };

    const rejectedRequest: ScenarioTakerRequestRecord = {
      type: "taker_request",
      ts: 1700000004000,
      pair: "ETH/USDT",
      side: "sell",
      amountIn: "1000000000000000000", // 1 ETH (18 decimals)
      taker: "0x2222222222222222222222222222222222222222",
    };

    recorder.recordBook(bookRecord);
    recorder.recordTrade(tradeRecord);
    recorder.recordTakerRequest(successfulRequest);
    recorder.recordTakerRequest(rejectedRequest);

    const summary = await recorder.stop();
    expect(summary.counts.total).toBe(4);
    expect(summary.counts.books).toBe(1);
    expect(summary.counts.trades).toBe(1);
    expect(summary.counts.takerRequests).toBe(2);
    expect(summary.heldOut).toBe(false);

    // Verify manifest was loaded by existing engine scenario loader
    const manifest = await loadScenarioManifest("roundtrip-test", { scenariosDir: tmpDir });
    expect(manifest.name).toBe("roundtrip-test");
    expect(manifest.pair).toBe("ETH/USDT");
    expect(manifest.heldOut).toBe(false);

    // Load full scenario via engine loader
    const loaded = await loadScenario("roundtrip-test", {
      scenariosDir: tmpDir,
      role: "research",
    });
    expect(loaded.recordCounts.total).toBe(4);
    expect(loaded.recordCounts.books).toBe(1);
    expect(loaded.recordCounts.trades).toBe(1);
    expect(loaded.recordCounts.takerRequests).toBe(2);

    // Ensure raw amountIn strings and non-empty bids/asks preserved
    const req1 = loaded.records[2] as ScenarioTakerRequestRecord;
    expect(req1.amountIn).toBe("100000000");
    expect(req1.tier).toBe("normal");

    const req2 = loaded.records[3] as ScenarioTakerRequestRecord;
    expect(req2.amountIn).toBe("1000000000000000000");
    expect(req2.taker).toBe("0x2222222222222222222222222222222222222222");
  });

  it("enforces held-out protection in engine loader", async () => {
    const recorder = new ScenarioRecorder({
      name: "heldout-attack-fixture",
      pair: "HSK/USDT",
      source: "sniper",
      heldOut: true,
      description: "Held-out attacker test fixture",
      scenariosDir: tmpDir,
    });
    await recorder.start();

    recorder.recordBook({
      type: "book",
      ts: 1700000001000,
      pair: "HSK/USDT",
      venue: "gate",
      book: {
        bids: [[2.5, 100]],
        asks: [[2.51, 100]],
      },
    });

    await recorder.stop();

    // Research role must fail closed before reading payload
    expect(
      loadScenario("heldout-attack-fixture", {
        scenariosDir: tmpDir,
        role: "research",
      }),
    ).rejects.toThrow(HeldOutAccessError);

    // Evaluator role must successfully load
    const loaded = await loadScenario("heldout-attack-fixture", {
      scenariosDir: tmpDir,
      role: "evaluator",
    });
    expect(loaded.manifest.heldOut).toBe(true);
    expect(loaded.recordCounts.total).toBe(1);
  });

  it("serializes concurrent out-of-order callbacks into chronologically ordered output", async () => {
    const recorder = new ScenarioRecorder({
      name: "concurrency-order-test",
      pair: "ETH/USDT",
      scenariosDir: tmpDir,
      flushIntervalMs: 0,
    });
    await recorder.start();

    // Generate records with jumbled timestamps, including duplicates
    const timestamps = [1050, 1010, 1030, 1020, 1010, 1040, 1020, 1000, 1030, 1060];

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i] ?? 1000;
      if (i % 2 === 0) {
        recorder.recordBook({
          type: "book",
          ts,
          pair: "ETH/USDT",
          venue: "binance",
          book: { bids: [[2000, 1]], asks: [[2001, 1]] },
        });
      } else {
        recorder.recordTrade({
          type: "trade",
          ts,
          pair: "ETH/USDT",
          venue: "binance",
          trade: { id: `tr-${i}`, ts, side: "buy", price: 2000, size: 1 },
        });
      }
    }

    await recorder.stop();

    const loaded = await loadScenario("concurrency-order-test", {
      scenariosDir: tmpDir,
      role: "evaluator",
    });

    expect(loaded.records.length).toBe(10);
    for (let i = 1; i < loaded.records.length; i++) {
      const prev = loaded.records[i - 1];
      const curr = loaded.records[i];
      if (prev && curr) {
        expect(curr.ts).toBeGreaterThanOrEqual(prev.ts);
      }
    }
  });

  it("rejects incomplete captures with 0 records and cleans up", async () => {
    const recorder = new ScenarioRecorder({
      name: "zero-record-test",
      pair: "ETH/USDT",
      scenariosDir: tmpDir,
    });
    await recorder.start();

    // Stop without any records
    expect(recorder.stop()).rejects.toThrow(/captured 0 records/);

    // Verify files were cleaned up
    const files = await fs.readdir(tmpDir);
    expect(files.filter((f) => f.startsWith("zero-record-test"))).toEqual([]);
  });

  it("rejects records with mismatched pair", async () => {
    const recorder = new ScenarioRecorder({
      name: "mismatched-pair-test",
      pair: "ETH/USDT",
      scenariosDir: tmpDir,
    });
    await recorder.start();

    expect(() => {
      recorder.recordBook({
        type: "book",
        ts: 1000,
        pair: "HSK/USDT", // mismatch!
        venue: "binance",
        book: { bids: [[1, 1]], asks: [[2, 1]] },
      });
    }).toThrow(/does not match recorder pair/);

    await recorder.stop().catch(() => {});
  });
});
