import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { createZethos, type PaperQuote } from "@zethos/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/api";
import { defaultParams } from "../src/config";
import { memoryStore } from "../src/db/memory";
import { Engine } from "../src/engine";
import { Replay, type ReplayRecord } from "../src/feeds/replay";
import {
  HeldOutReplayError,
  loadReplaySource,
  parseScenarioReplay,
  type ReplayFiles,
  ReplayPlayer,
  remapToWallTime,
} from "../src/feeds/replay-scenario";
import { bookAround, SIGNER_KEY, TAKER, tokens } from "./helpers";

const scenariosDir = path.resolve(import.meta.dir, "../scenarios");
const diskFiles: ReplayFiles = {
  exists: async (file) =>
    fs.stat(file).then(
      () => true,
      () => false,
    ),
  read: (file) => fs.readFile(file, "utf8"),
};

function memoryFiles(entries: Record<string, string>): ReplayFiles {
  const map = new Map(Object.entries(entries).map(([k, v]) => [path.resolve(k), v]));
  return {
    exists: async (file) => map.has(path.resolve(file)),
    read: async (file) => {
      const value = map.get(path.resolve(file));
      if (value === undefined) throw new Error(`missing ${file}`);
      return value;
    },
  };
}

const book = (ts: number, mid: number): ReplayRecord => ({
  type: "book",
  ts,
  pair: "HSK/USDT",
  venue: "gate",
  book: bookAround(mid),
});
const trade = (ts: number, id: string): ReplayRecord => ({
  type: "trade",
  ts,
  pair: "HSK/USDT",
  venue: "gate",
  trade: { id, ts, side: "buy", price: 0.1, size: 10 },
});
const takerRequest = (ts: number) => ({
  type: "taker_request",
  ts,
  pair: "HSK/USDT",
  side: "buy",
  amountIn: "1000000",
  taker: TAKER,
});
const ndjson = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n");

describe("replay fallback: S9 compatibility", () => {
  it("keeps market events and explicitly skips taker requests", () => {
    const parsed = parseScenarioReplay(
      ndjson([book(1000, 0.1), takerRequest(1500), trade(2000, "t1")]),
    );
    expect(parsed.records.map((r) => r.type)).toEqual(["book", "trade"]);
    expect(parsed.skippedTakerRequests).toBe(1);
  });

  it("rejects malformed, unordered or market-empty payloads", () => {
    expect(() => parseScenarioReplay("{not json")).toThrow(/line 1/);
    expect(() => parseScenarioReplay(ndjson([book(2000, 0.1), book(1000, 0.1)]))).toThrow(
      /ordered/,
    );
    expect(() => parseScenarioReplay(ndjson([takerRequest(1000)]))).toThrow(/no book or trade/);
  });

  it("loads the dev partition of the repository's synthetic scenario through its manifest", async () => {
    const source = await loadReplaySource(
      path.join(scenariosDir, "synthetic-dev-tape.json"),
      diskFiles,
    );
    expect(source.scenario).toBe("synthetic-dev-tape");
    expect(path.basename(source.payloadPath)).toBe("synthetic-dev-tape.dev.ndjson");
    expect(source.records.every((r) => r.ts <= 1700000005000)).toBe(true);
    expect(source.skippedTakerRequests).toBe(1);
  });

  it("refuses held-out scenarios by manifest or by payload path", async () => {
    await expect(
      loadReplaySource(path.join(scenariosDir, "synthetic-heldout-leadlag.json"), diskFiles),
    ).rejects.toBeInstanceOf(HeldOutReplayError);
    await expect(
      loadReplaySource(path.join(scenariosDir, "synthetic-heldout-leadlag.ndjson"), diskFiles),
    ).rejects.toBeInstanceOf(HeldOutReplayError);
  });

  it("requires a materialized dev partition for mixed recordings", async () => {
    const files = memoryFiles({
      "s/mixed.json": JSON.stringify({
        name: "mixed",
        heldOut: false,
        heldOutWindow: { fromTs: 5000, toTs: 9000 },
      }),
      "s/mixed.ndjson": ndjson([book(1000, 0.1), book(6000, 0.1)]),
    });
    await expect(loadReplaySource("s/mixed.json", files)).rejects.toThrow(/dev\.ndjson/);
  });

  it("accepts a legacy replay file with no manifest", async () => {
    const files = memoryFiles({ "legacy.ndjson": ndjson([book(1000, 0.1), trade(1500, "a")]) });
    const source = await loadReplaySource("legacy.ndjson", files);
    expect(source.scenario).toBeNull();
    expect(source.durationMs).toBe(500);
  });
});

describe("replay fallback: timing", () => {
  it("remaps book, record and trade timestamps by one offset", () => {
    const remapped = remapToWallTime([book(1000, 0.1), trade(1400, "a"), book(3000, 0.1)], 50_000);
    expect(remapped.map((r) => r.ts)).toEqual([50_000, 50_400, 52_000]);
    const t = remapped[1];
    expect(t?.type === "trade" && t.trade.ts).toBe(50_400);
  });

  it("ends a finite recording with no fallback", () => {
    const player = new ReplayPlayer([book(0, 0.1), book(1000, 0.1)], 10_000, false);
    expect(player.take(10_000)).toHaveLength(1);
    expect(player.take(11_000)).toHaveLength(1);
    expect(player.finished).toBe(true);
    expect(player.take(1_000_000)).toHaveLength(0);
  });

  it("loops with ordered timestamps and de-duplicated trade IDs", () => {
    const player = new ReplayPlayer([book(0, 0.1), trade(500, "x")], 10_000, true, 1000);
    const first = player.take(10_500);
    const second = player.take(12_000);
    expect(first.map((r) => r.ts)).toEqual([10_000, 10_500]);
    expect(second.map((r) => r.ts)).toEqual([11_500, 12_000]);
    const ids = [...first, ...second].flatMap((r) => (r.type === "trade" ? [r.trade.id] : []));
    expect(new Set(ids).size).toBe(2);
    expect(player.finished).toBe(false);
    expect(player.passes).toBe(2);
  });
});

describe("replay fallback: engine", () => {
  it("serves a quote that verifies against remapped wall time and labels the data source", async () => {
    let clock = 1_800_000_000_000;
    const recording = defaultParams.pairs.flatMap((pair) =>
      defaultParams.feeds.sources[pair].map(
        (venue): ReplayRecord => ({
          type: "book",
          ts: 1_700_000_000_000,
          pair,
          venue,
          book: bookAround(pair === "HSK/USDT" ? 0.1 : 3000, pair === "HSK/USDT" ? 1_000_000 : 50),
        }),
      ),
    );
    const player = new ReplayPlayer(recording, clock, false);
    const engine = new Engine({
      chainId: 177,
      params: defaultParams,
      tokens,
      store: memoryStore(),
      signer: privateKeyToAccount(SIGNER_KEY),
      dataSource: "replay",
      emit: () => {},
    });
    await engine.init();
    await new Replay(player.take(clock)).advance(engine, clock);
    const app = createApp({
      engine: async () => engine,
      corsOrigins: [],
      waitUntil: () => {},
      clock: () => clock,
    });
    const sdk = createZethos({
      engineUrl: "http://replay.test",
      chainId: 177,
      client: "replay-test",
      now: () => Math.floor(clock / 1000),
      fetch: ((input, init) => app.request(String(input), init)) as typeof fetch,
    });

    const status = (await (await app.request("/status")).json()) as { dataSource: string };
    expect(status.dataSource).toBe("replay");
    const quote = (await sdk.quote({
      taker: TAKER,
      pair: "HSK/USDT",
      side: "buy",
      amount: "100",
    })) as PaperQuote;
    expect(quote.route).toBe("paper");
    expect((await sdk.verifyQuote(quote)).ok).toBe(true);
    // Expiry is real wall-clock time: once it passes, the quote no longer verifies.
    clock = (Number(quote.quote.expiry) + 1) * 1000;
    expect((await sdk.verifyQuote(quote)).ok).toBe(false);
  });
});
