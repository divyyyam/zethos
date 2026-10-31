import { describe, expect, test } from "bun:test";
import { defaultParams } from "../src/config";
import { parseReplay, Replay } from "../src/feeds/replay";
import { bookAround, readyEngine } from "./helpers";

describe("honest tape replay", () => {
  test("fills competitive quotes only, does not duplicate polled trades", async () => {
    const params = structuredClone(defaultParams);
    params.arena.tapeCaptureRate = 1;
    params.arena.tapeLatencyMs = [0, 0];
    const { engine, now } = await readyEngine({ params });
    const trade = { id: "one", price: 0.102, size: 10000, side: "buy" as const, ts: now };
    await engine.ingestTrades("HSK/USDT", "hashkey-global", [trade], now);
    await engine.tick(now);
    const fill = (await engine.fills(undefined, 10))[0];
    expect(fill?.flow).toBe("tape");
    expect(fill?.price).toBeLessThanOrEqual(trade.price);
    await engine.ingestTrades("HSK/USDT", "hashkey-global", [trade], now);
    await engine.tick(now);
    expect(engine.arenaView().fills).toBe(1);
    await engine.ingestTrades(
      "HSK/USDT",
      "hashkey-global",
      [{ ...trade, id: "two", price: 0.099 }],
      now,
    );
    await engine.tick(now);
    expect(engine.arenaView().fills).toBe(1);
    expect(engine.arenaView().tapeCaptureRate).toBe(0.5);
  });
  test("a recorded book is deterministic and invalid records fail explicitly", async () => {
    const { engine, now } = await readyEngine();
    const records = parseReplay(
      JSON.stringify({
        type: "book",
        pair: "HSK/USDT",
        venue: "gate",
        book: bookAround(0.1),
        ts: now,
      }),
    );
    const replay = new Replay(records);
    await replay.advance(engine, now);
    expect(replay.done).toBe(true);
    expect(engine.status().pairs[0]?.mid).toBeCloseTo(0.1, 6);
    expect(() => parseReplay("{}\n")).toThrow("line 1");
    expect(() => parseReplay("")).toThrow("empty");
    expect(() =>
      parseReplay(
        [
          JSON.stringify({ ...records[0], ts: now }),
          JSON.stringify({ ...records[0], ts: now - 1 }),
        ].join("\n"),
      ),
    ).toThrow("ordered");
  });
});
