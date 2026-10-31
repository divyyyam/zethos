import { expect, test } from "bun:test";
import { createZethos } from "@zethos/sdk";
import { createApp } from "../src/api";
import { defaultParams } from "../src/config";
import { Replay, type ReplayRecord } from "../src/feeds/replay";
import { bookAround, readyEngine, TAKER } from "./helpers";

test("public SDK sniper reaches toxic within 15 fills and loses at least 70% of its edge", async () => {
  let clock = Date.now();
  const start = clock;
  const { engine } = await readyEngine({ now: clock });
  const records: ReplayRecord[] = [];
  for (let cycle = 0; cycle < 25; cycle++) {
    const points: [number, number][] = [
      [0, 0.1],
      [8000, 0.101],
      [9000, 0.101],
      [13000, 0.101],
    ];
    for (let offset = 20000; offset < 360000; offset += 2000) points.push([offset, 0.1]);
    for (const [offset, mid] of points) {
      for (const pair of defaultParams.pairs)
        for (const venue of defaultParams.feeds.sources[pair])
          records.push({
            type: "book",
            ts: start + cycle * 360000 + offset,
            pair,
            venue,
            book: bookAround(pair === "HSK/USDT" ? mid : 3000, 1000000),
          });
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
  const lossesBefore: number[] = [];
  const lossesAfter: number[] = [];
  let detectionFills: number | null = null;
  let postAttempts = 0;
  for (let cycle = 0; cycle < 25; cycle++) {
    clock = start + cycle * 360000;
    await replay.advance(engine, clock);
    const tier = (await sdk.arenaTakers())[0]?.tier ?? "probation";
    const detected = tier === "toxic" || tier === "blocked";
    if (detected) postAttempts++;
    try {
      const q = await sdk.quote({ taker: TAKER, pair: "HSK/USDT", side: "buy", amount: "100" });
      if (q.route !== "paper") throw new Error("Expected paper");
      expect((await sdk.verifyQuote(q)).ok).toBe(true);
      clock += 8000;
      await replay.advance(engine, clock);
      const quantity = Number(BigInt(q.quote.amountOut)) / 1e18;
      const profit = quantity * 0.101 - 100;
      if (profit > 0 && Number(q.quote.expiry) * 1000 >= clock) {
        await sdk.paperFill(q);
        (detected ? lossesAfter : lossesBefore).push(profit);
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        !["taker_restricted", "quote_expired"].includes(String(error.code))
      )
        throw error;
    }
    clock = start + cycle * 360000 + 13000;
    await replay.advance(engine, clock);
    const row = (await sdk.arenaTakers())[0];
    if (row?.detectedAfter) detectionFills = row.detectedAfter.fills;
  }
  expect(detectionFills).not.toBeNull();
  if (detectionFills === null) throw new Error("Attacker was not detected");
  expect(detectionFills).toBeLessThanOrEqual(15);
  expect(postAttempts).toBeGreaterThan(0);
  const pre = lossesBefore.reduce((a, b) => a + b, 0) / lossesBefore.length;
  const post = lossesAfter.length ? lossesAfter.reduce((a, b) => a + b, 0) / lossesAfter.length : 0;
  expect(post).toBeLessThanOrEqual(pre * 0.3);
  expect(
    engine.decisions(100).some((d) => d.type === "taker_tier_change" && d.after?.tier === "toxic"),
  ).toBe(true);
}, 15000);
