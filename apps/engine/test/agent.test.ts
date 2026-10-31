import { describe, expect, test } from "bun:test";
import { createZethos } from "@zethos/sdk";
import { createApp } from "../src/api";
import { defaultParams, type Params } from "../src/config";
import { memoryStore } from "../src/db/memory";
import type { Engine } from "../src/engine";
import { bookAround, MIDS, paperOf, readyEngine, TAKER, tokens, usdt } from "./helpers";

const request = (amount = 100) => ({
  taker: TAKER,
  tokenIn: tokens.USDT.address,
  tokenOut: tokens.WHSK.address,
  amountIn: usdt(amount),
});
const body = (q: Awaited<ReturnType<Engine["quote"]>>) => ({
  quote: q.response.quote,
  signature: q.response.signature,
});
function feeds(engine: Engine, now: number, mid = 0.1, params = defaultParams) {
  for (const pair of params.pairs)
    engine.ingest(
      pair,
      params.feeds.sources[pair].map((venue) => ({
        venue,
        book: bookAround(pair === "HSK/USDT" ? mid : MIDS[pair], 1000000),
        error: null,
      })),
      now,
    );
}

describe("durability and settlement", () => {
  test("does not return a quote before it is durably issued", async () => {
    const store = memoryStore();
    const { engine, now } = await readyEngine({ store });
    store.saveQuote = async () => {
      throw new Error("write failed");
    };
    await expect(engine.quote(request(), "web", now)).rejects.toThrow("write failed");
    expect(await store.loadQuotes(1)).toHaveLength(0);
  });

  test("concurrent requests settle a nonce once", async () => {
    const { engine, now } = await readyEngine();
    const q = await engine.quote(request(), "sdk", now);
    const results = await Promise.allSettled([
      engine.paperFill(body(q), "sdk", now),
      engine.paperFill(body(q), "sdk", now),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(engine.status().inventory.USDT).toBe(usdt(50100));
    expect(await engine.fills(undefined, 100)).toHaveLength(1);
  });

  test("a failed concurrent fill cannot roll back another fill", async () => {
    const store = memoryStore();
    const { engine, now } = await readyEngine({ store });
    const a = await engine.quote(request(), "sdk", now);
    const b = await engine.quote(request(), "sdk", now);
    const save = store.saveFill;
    let count = 0;
    store.saveFill = async (...args) => {
      count++;
      if (count === 1) {
        await Promise.resolve();
        throw new Error("transient");
      }
      await save(...args);
    };
    const results = await Promise.allSettled([
      engine.paperFill(body(a), "sdk", now),
      engine.paperFill(body(b), "sdk", now),
    ]);
    expect(results[0]?.status).toBe("rejected");
    expect(results[1]?.status).toBe("fulfilled");
    expect(engine.status().inventory.USDT).toBe(usdt(50100));
    await engine.paperFill(body(a), "sdk", now);
    expect(engine.status().inventory.USDT).toBe(usdt(50200));
  });

  test("restores issued quotes and committed fills even before an analytics checkpoint", async () => {
    const store = memoryStore();
    const first = await readyEngine({ store });
    const a = await first.engine.quote(request(), "sdk", first.now);
    const b = await first.engine.quote(request(), "sdk", first.now);
    await first.engine.paperFill(body(a), "sdk", first.now);
    const restarted = await readyEngine({ store });
    await expect(restarted.engine.paperFill(body(a), "sdk", first.now)).rejects.toMatchObject({
      code: "nonce_used",
    });
    await restarted.engine.paperFill(body(b), "sdk", first.now);
    expect(restarted.engine.takers()[0]?.fills).toBe(2);
    expect(restarted.engine.status().inventory.USDT).toBe(usdt(50200));
  });

  test("a stale feed cannot last-look a previously signed firm quote", async () => {
    const { engine, now } = await readyEngine();
    const q = await engine.quote(request(), "web", now);
    engine.ingest("HSK/USDT", [], now + 6000);
    await engine.paperFill(body(q), "web", now + 6000);
    const fills = await engine.fills(TAKER, 10);
    expect(fills).toHaveLength(1);
    expect(fills[0]?.midAtFill).toBeNull();
  });

  test("checks freshness on request even if the heartbeat stops", async () => {
    const { engine, now } = await readyEngine();
    await expect(engine.quote(request(), "sdk", now + 6000)).rejects.toMatchObject({
      code: "pair_halted",
    });
  });
});

describe("arena, risk and markouts", () => {
  test("reset starts a fresh epoch while preserving history and never deadlocks when paused", async () => {
    const store = memoryStore();
    const { engine, now } = await readyEngine({ store });
    const first = await engine.quote(request(), "web", now);
    const outstanding = await engine.quote(request(), "web", now);
    await engine.paperFill(body(first), "web", now);
    await engine.pause(TAKER, true, now);
    await engine.resetArena(TAKER, now);
    expect(engine.arenaView().epoch).toBe(2);
    expect(engine.arenaView().fills).toBe(0);
    expect(engine.status().paused).toBe(false);
    expect((await store.loadState(1))?.processedFills).toHaveLength(1);
    expect(await engine.fills(TAKER, 100, 1)).toHaveLength(1);
    expect(await engine.fills(TAKER, 100, 2)).toHaveLength(0);
    await expect(engine.paperFill(body(outstanding), "web", now)).rejects.toMatchObject({
      code: "quote_invalid",
    });
  });
  test("a failed reset leaves the original epoch and inventory intact", async () => {
    const store = memoryStore();
    const { engine, now } = await readyEngine({ store });
    const before = engine.status().inventory;
    store.startArena = async () => {
      throw new Error("db down");
    };
    await expect(engine.resetArena(TAKER, now)).rejects.toThrow("db down");
    expect(engine.arenaView().epoch).toBe(1);
    expect(engine.status().inventory).toEqual(before);
  });
  test("display labels cannot affect pricing or the taker score", async () => {
    const { engine, now } = await readyEngine();
    const first = await engine.quote(request(), "web", now);
    await engine.setTaker(TAKER, TAKER, { label: "Attacker bot" }, now);
    const second = await engine.quote(request(), "web", now);
    expect(paperOf(second.response).paperOut).toBe(paperOf(first.response).paperOut);
    expect(engine.takers()[0]?.score).toBe(defaultParams.toxicity.priorScore);
  });
  test("records all four horizons, reconciles paper P&L, persists risk and markouts", async () => {
    const store = memoryStore();
    const { engine, now } = await readyEngine({ store });
    const q = await engine.quote(request(), "web", now);
    const fill = await engine.paperFill(body(q), "web", now);
    if (fill.midAtFill === null) throw new Error("Expected a healthy fill-time observation");
    for (const seconds of [1, 5, 30, 300]) {
      feeds(engine, now + seconds * 1000);
      await engine.tick(now + seconds * 1000);
    }
    const view = (await engine.fills(TAKER, 10))[0];
    expect(Object.keys(view?.markouts ?? {})).toEqual(["1", "5", "30", "300"]);
    expect(view?.markouts?.["5"]).toBeGreaterThan(0);
    const arena = engine.arenaView();
    expect(arena.byFlow.user).toBeGreaterThan(0);
    expect(arena.pnl.total).toBeCloseTo(arena.pnl.spread + arena.pnl.inventory - arena.pnl.gas, 8);
    expect(arena.fills).toBe(1);
    expect(arena.pnl.spread).toBeCloseTo(
      ((fill.price - fill.midAtFill) * Number(BigInt(fill.amountOut))) / 1e18,
      8,
    );
    await engine.pause(TAKER, true, now + 301000);
    const restarted = await readyEngine({ store });
    expect(restarted.engine.status().paused).toBe(true);
    expect(restarted.engine.decisions()[0]?.type).toBe("pause");
    expect((await restarted.engine.fills(TAKER, 10))[0]?.markouts?.["300"]).toBeGreaterThan(0);
  });

  test("drawdown pauses until an operator resumes", async () => {
    const { engine, now } = await readyEngine();
    feeds(engine, now + 2000, 0.05);
    await engine.tick(now + 2000);
    expect(engine.status().paused).toBe(true);
    await expect(engine.quote(request(), "web", now + 2000)).rejects.toMatchObject({
      code: "paused",
    });
    await engine.pause(TAKER, false, now + 2000);
    await engine.tick(now + 4000);
    expect(engine.status().paused).toBe(false);
  });

  test("feed outage halts and requires 30 seconds of healthy recovery", async () => {
    const { engine, now } = await readyEngine();
    await engine.tick(now + 6000);
    await engine.tick(now + 67000);
    expect(engine.decisions().some((d) => d.type === "pair_halt")).toBe(true);
    feeds(engine, now + 68000);
    await engine.tick(now + 68000);
    expect(engine.status().pairs[0]?.halted).toBe(true);
    for (let seconds = 70; seconds <= 100; seconds += 2) {
      feeds(engine, now + seconds * 1000);
      await engine.tick(now + seconds * 1000);
    }
    expect(engine.status().pairs[0]?.halted).toBe(false);
  });

  test("new identities start on probation, not normal", async () => {
    const { engine, now } = await readyEngine();
    const q = await engine.quote(request(), "sdk", now);
    expect(q.response.breakdown.tier).toBe("probation");
    expect(q.response.breakdown.ttlSec).toBe(10);
    await expect(engine.quote(request(7000), "sdk", now)).rejects.toMatchObject({
      code: "vault_capacity",
    });
  });

  test("quote limits include IP, so changing taker cannot bypass the limit", async () => {
    const params: Params = structuredClone(defaultParams);
    params.quote.rateLimitPerMin = 1;
    const { engine, now } = await readyEngine({ params });
    await engine.quote(request(), "web", now, "1.2.3.4");
    await expect(
      engine.quote({ ...request(), taker: tokens.WHSK.address }, "web", now, "1.2.3.4"),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("flow labels never affect prices, tiers, scores or risk", async () => {
    const results = [];
    for (const client of ["web", "sdk", "mcp", "sniper/test"]) {
      const { engine, now } = await readyEngine();
      const q = await engine.quote(request(), client, now);
      await engine.paperFill(body(q), client, now);
      feeds(engine, now + 5000, 0.101);
      await engine.tick(now + 5000);
      const row = engine.takers()[0];
      results.push({
        out: paperOf(q.response).paperOut,
        breakdown: q.response.breakdown,
        row: { tier: row?.tier, score: row?.score, signals: row?.signals },
        risk: engine.status().riskState,
      });
    }
    const first = results[0];
    if (!first) throw new Error("Expected attribution comparisons");
    for (const result of results) expect(result).toEqual(first);
  });

  test("SDK parses Arena, takers, journal, and all emitted frames", async () => {
    const { engine, now } = await readyEngine({ now: Date.now() });
    const q = await engine.quote(request(), "mcp", now);
    await engine.paperFill(body(q), "mcp", now);
    feeds(engine, now + 2000);
    await engine.tick(now + 2000);
    const app = createApp({ engine: async () => engine, corsOrigins: [], waitUntil: () => {} });
    const sdk = createZethos({
      engineUrl: "http://engine.test",
      chainId: 177,
      fetch: ((input, init) => app.request(String(input), init)) as typeof fetch,
    });
    expect((await sdk.arena()).fills).toBe(1);
    expect((await sdk.arenaTakers())[0]?.tier).toBe("probation");
    expect(await sdk.decisions()).toBeArray();
  });
});
