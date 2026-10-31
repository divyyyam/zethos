import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createZethos, type PaperQuote, ZethosError } from "@zethos/sdk";
import { createApp } from "../../engine/src/api/index.js";
import { defaultParams } from "../../engine/src/config/index.js";
import { Replay, type ReplayRecord } from "../../engine/src/feeds/replay.js";
import { loadScenario } from "../../engine/src/research/index.js";
import { bookAround, readyEngine, TAKER } from "../../engine/test/helpers.js";
import { resolveAmountIn } from "../src/options.js";
import { ScenarioRecorder } from "../src/recorder.js";
import type { ScenarioTakerRequestRecord } from "../src/types.js";

describe("Sniper recording integration with engine", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sniper-integ-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("records books, trades, and taker requests during a sniper run", async () => {
    let clock = Date.now();
    const start = clock;
    const { engine } = await readyEngine({ now: clock });

    const records: ReplayRecord[] = [];
    const points: [number, number][] = [
      [0, 0.1],
      [8000, 0.101],
      [9000, 0.101],
      [13000, 0.101],
    ];
    for (const [offset, mid] of points) {
      for (const pair of defaultParams.pairs) {
        for (const venue of defaultParams.feeds.sources[pair]) {
          records.push({
            type: "book",
            ts: start + offset,
            pair,
            venue,
            book: bookAround(pair === "HSK/USDT" ? mid : 3000, 1000000),
          });
        }
      }
    }

    const replay = new Replay(records);
    const app = createApp({
      engine: async () => engine,
      corsOrigins: [],
      waitUntil: () => {},
      clock: () => clock,
    });

    const sdk = createZethos({
      engineUrl: "http://engine.test",
      chainId: 177,
      client: "sniper/test",
      now: () => Math.floor(clock / 1000),
      fetch: ((input, init) => app.request(String(input), init)) as typeof fetch,
    });

    const recorder = new ScenarioRecorder({
      name: "engine-sniper-integration",
      pair: "HSK/USDT",
      source: "sniper",
      heldOut: false,
      scenariosDir: tmpDir,
      flushIntervalMs: 0,
    });
    await recorder.start();

    // 1. Advance replay and record book observation
    clock = start;
    await replay.advance(engine, clock);

    recorder.recordBook({
      type: "book",
      ts: clock,
      pair: "HSK/USDT",
      venue: "gate",
      book: {
        bids: [[0.1, 1000]],
        asks: [[0.101, 1000]],
      },
    });

    // 2. Resolve runtime decimals
    const status = await sdk.status();
    const hskPair = status.pairs.find((p) => p.pair === "HSK/USDT");
    expect(hskPair).toBeDefined();
    const quoteToken = hskPair?.quote;
    expect(quoteToken?.decimals).toBe(6);

    const amountIn = resolveAmountIn(
      "100",
      quoteToken?.decimals ?? 6,
      quoteToken?.symbol ?? "USDT",
    );
    expect(amountIn).toBe("100000000");

    // 3. Request quote and record taker request
    const requestTs = clock;
    const quoteRes = await sdk.quote({
      taker: TAKER,
      pair: "HSK/USDT",
      side: "buy",
      amount: "100",
    });
    expect(quoteRes.route).toBe("paper");
    const paperQuote = quoteRes as PaperQuote;

    recorder.recordTakerRequest({
      type: "taker_request",
      ts: requestTs,
      pair: "HSK/USDT",
      side: "buy",
      amountIn,
      taker: TAKER,
      id: paperQuote.id,
      tier: paperQuote.breakdown.tier,
    });

    // 4. Verify quote using SDK verifier
    const verification = await sdk.verifyQuote(paperQuote);
    expect(verification.ok).toBe(true);

    // 5. Fill quote and ensure no fill retry on failure
    const fill = await sdk.paperFill(paperQuote);
    expect(fill.id).toBeDefined();

    // Attempting to fill the exact same quote again must throw (never retry)
    expect(sdk.paperFill(paperQuote)).rejects.toThrow();

    // 6. Record a rejected quote request (e.g. invalid size or rate limited)
    const badRequestTs = clock + 1000;
    let rejectedError: unknown = null;
    try {
      await sdk.quote({
        taker: TAKER,
        pair: "HSK/USDT",
        side: "buy",
        amount: "9999999999", // exceed max size
      });
    } catch (err) {
      rejectedError = err;
    }
    expect(rejectedError).toBeInstanceOf(ZethosError);

    // Rejected quote is still recorded in scenario
    recorder.recordTakerRequest({
      type: "taker_request",
      ts: badRequestTs,
      pair: "HSK/USDT",
      side: "buy",
      amountIn: resolveAmountIn("9999999999", 6, "USDT"),
      taker: TAKER,
    });

    const summary = await recorder.stop();
    expect(summary.counts.total).toBe(3); // 1 book, 2 requests
    expect(summary.counts.books).toBe(1);
    expect(summary.counts.takerRequests).toBe(2);

    // Round-trip through loader
    const loaded = await loadScenario("engine-sniper-integration", {
      scenariosDir: tmpDir,
      role: "research",
    });

    expect(loaded.recordCounts.total).toBe(3);
    const req1 = loaded.records[1] as ScenarioTakerRequestRecord;
    expect(req1.amountIn).toBe("100000000");
    expect(req1.taker).toBe(TAKER);

    const req2 = loaded.records[2] as ScenarioTakerRequestRecord;
    expect(req2.amountIn).toBe("9999999999000000");
  });
});
