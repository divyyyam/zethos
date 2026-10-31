import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Market, PaperQuote, QuoteIntent, QuoteResponse } from "@zethos/sdk";
import { ZethosError } from "@zethos/sdk";
import { parseUnits } from "viem";
import {
  DEFAULT_LEAD_LAG_CONFIG,
  detectOpportunity,
  edgeBps,
  HELD_OUT_DESCRIPTION,
  HELD_OUT_SOURCE,
  type LeadFeed,
  type LeadLagSdk,
  type MidObservation,
  quotePrice,
  RateLimiter,
  RestLeadFeed,
  runLeadLag,
  soldAmount,
  summarize,
} from "../src/lead-lag.js";
import { parseSniperOptions } from "../src/options.js";
import { ScenarioRecorder } from "../src/recorder.js";

const TAKER = "0x00000000000000000000000000000000000000aa" as const;
const config = { ...DEFAULT_LEAD_LAG_CONFIG, minQuoteGapMs: 0 };

function market(mid: number | null): Market {
  return {
    pair: "HSK/USDT",
    base: { symbol: "WHSK", address: `0x${"1".repeat(40)}`, decimals: 18 },
    quote: { symbol: "USDT", address: `0x${"2".repeat(40)}`, decimals: 6 },
    mid,
    bid: null,
    ask: null,
    spread: null,
    health: "ok",
    halted: false,
    sources: [],
    updatedAt: null,
  };
}

/** Builds a paper quote at `price` (USDT per HSK) for `side`, using runtime decimals. */
function paperQuote(side: "buy" | "sell", amount: string, price: number, expirySec: number) {
  const amountIn = side === "buy" ? parseUnits(amount, 6) : parseUnits(amount, 18);
  const inHuman = Number(amount);
  const outHuman = side === "buy" ? inHuman / price : inHuman * price;
  const amountOut =
    side === "buy" ? parseUnits(outHuman.toFixed(18), 18) : parseUnits(outHuman.toFixed(6), 6);
  return {
    route: "paper",
    id: `q-${Math.random()}`,
    quote: {
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      expiry: String(expirySec),
    },
    breakdown: { tier: "normal" },
  } as unknown as PaperQuote;
}

interface Harness {
  clock: { t: number };
  lead: { obs: MidObservation | null };
  calls: { quotes: QuoteIntent[]; fills: number; verifies: number };
  sdk: LeadLagSdk;
  feed: LeadFeed;
}

function harness(options: {
  engineMid: number | (() => number);
  quoteAt?: (intent: QuoteIntent) => number;
  quoteError?: Error;
  verifyOk?: boolean;
  ttlSec?: number;
  route?: "paper" | "pool";
}): Harness {
  const clock = { t: 1_800_000_000_000 };
  const lead: { obs: MidObservation | null } = { obs: null };
  const calls = { quotes: [] as QuoteIntent[], fills: 0, verifies: 0 };
  const engineMid = () =>
    typeof options.engineMid === "function" ? options.engineMid() : options.engineMid;
  const sdk: LeadLagSdk = {
    market: async () => [market(engineMid())],
    quote: async (intent) => {
      calls.quotes.push(intent);
      if (options.quoteError) throw options.quoteError;
      if (options.route === "pool") return { route: "pool" } as unknown as QuoteResponse;
      const price = options.quoteAt ? options.quoteAt(intent) : engineMid();
      return paperQuote(
        intent.side,
        intent.amount,
        price,
        Math.floor(clock.t / 1000) + (options.ttlSec ?? 10),
      );
    },
    verifyQuote: async () => {
      calls.verifies++;
      return (options.verifyOk ?? true)
        ? ({ ok: true } as never)
        : ({ ok: false, reason: "bad_signature" } as never);
    },
    paperFill: async (quote) => {
      calls.fills++;
      const q = quote as PaperQuote;
      return { id: `f-${calls.fills}`, price: Number(q.quote.amountIn) > 0 ? engineMid() : 0 };
    },
  };
  const feed: LeadFeed = { latest: () => lead.obs, start: () => {}, stop: () => {} };
  return { clock, lead, calls, sdk, feed };
}

function run(
  h: Harness,
  extra: { maxTicks?: number; maxFills?: number; recorder?: ScenarioRecorder } = {},
) {
  let ticks = 0;
  const maxTicks = extra.maxTicks ?? 40;
  return runLeadLag({
    pair: "HSK/USDT",
    usdAmount: "100",
    taker: () => TAKER,
    config,
    sdk: h.sdk,
    lead: h.feed,
    recorder: extra.recorder ?? null,
    now: () => h.clock.t,
    sleep: async (ms) => {
      h.clock.t += ms;
      // Keep the lead observation fresh unless a test clears it.
      if (h.lead.obs) h.lead.obs = { ...h.lead.obs, at: h.clock.t };
    },
    shouldStop: () => ticks++ >= maxTicks,
    maxFills: extra.maxFills,
  });
}

describe("lead-lag decision core", () => {
  const now = 1_000_000;

  it("buys when the lead venue is above the engine mid", () => {
    const found = detectOpportunity({ mid: 0.1012, at: now }, { mid: 0.1, at: now }, now, config);
    expect(found.kind).toBe("opportunity");
    if (found.kind === "opportunity") {
      expect(found.side).toBe("buy");
      expect(found.divergenceBps).toBeCloseTo(120, 6);
    }
  });

  it("sells when the lead venue is below the engine mid", () => {
    const found = detectOpportunity({ mid: 0.0988, at: now }, { mid: 0.1, at: now }, now, config);
    expect(found).toMatchObject({ kind: "opportunity", side: "sell" });
  });

  it("reports no opportunity when aligned, stale or missing", () => {
    expect(
      detectOpportunity({ mid: 0.10005, at: now }, { mid: 0.1, at: now }, now, config),
    ).toEqual({
      kind: "none",
      reason: "aligned",
    });
    expect(
      detectOpportunity(
        { mid: 0.11, at: now - config.staleMs - 1 },
        { mid: 0.1, at: now },
        now,
        config,
      ),
    ).toEqual({ kind: "none", reason: "stale_lead" });
    expect(detectOpportunity(null, { mid: 0.1, at: now }, now, config)).toEqual({
      kind: "none",
      reason: "no_lead",
    });
    expect(detectOpportunity({ mid: 0.11, at: now }, null, now, config)).toEqual({
      kind: "none",
      reason: "no_engine",
    });
  });

  it("computes side-aware price and edge from runtime decimals", () => {
    const m = market(0.1);
    const buy = paperQuote("buy", "100", 0.1, 1);
    expect(quotePrice(buy, "buy", m)).toBeCloseTo(0.1, 9);
    expect(edgeBps("buy", 0.1, 0.101)).toBeCloseTo(100, 6);
    const sell = paperQuote("sell", "1000", 0.1, 1);
    expect(quotePrice(sell, "sell", m)).toBeCloseTo(0.1, 9);
    expect(edgeBps("sell", 0.1, 0.099)).toBeCloseTo(101.0101, 3);
  });

  it("sizes sells in base worth the USD amount", () => {
    expect(soldAmount("buy", "100", 0.1, market(0.1))).toBe("100");
    expect(soldAmount("sell", "100", 0.1, market(0.1))).toBe("1000");
  });

  it("rate-limits by gap and per-minute cap", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.canRequest(0)).toBe(true);
    limiter.record(0);
    expect(limiter.canRequest(500)).toBe(false);
    expect(limiter.canRequest(1000)).toBe(true);
    limiter.record(1000);
    expect(limiter.canRequest(30_000)).toBe(false);
    expect(limiter.canRequest(60_001)).toBe(true);
  });
});

describe("lead-lag runner (mocked engine and feed)", () => {
  it("fills a buy when the engine lags an upward lead move", async () => {
    const h = harness({ engineMid: 0.1 });
    h.lead.obs = { mid: 0.1015, at: h.clock.t };
    const stats = await run(h, { maxFills: 1 });
    expect(h.calls.quotes[0]?.side).toBe("buy");
    expect(stats.fills).toBe(1);
    expect(stats.estimatedPnlUsd).toBeGreaterThan(0);
  });

  it("fills a sell when the engine lags a downward lead move", async () => {
    const h = harness({ engineMid: 0.1 });
    h.lead.obs = { mid: 0.0985, at: h.clock.t };
    const stats = await run(h, { maxFills: 1 });
    expect(h.calls.quotes[0]?.side).toBe("sell");
    expect(h.calls.quotes[0]?.amount).toBe(soldAmount("sell", "100", 0.0985, market(0.1)));
    expect(stats.fills).toBe(1);
  });

  it("requests nothing when there is no opportunity", async () => {
    const h = harness({ engineMid: 0.1 });
    h.lead.obs = { mid: 0.10001, at: h.clock.t };
    const stats = await run(h);
    expect(h.calls.quotes).toHaveLength(0);
    expect(stats.fills).toBe(0);
    expect(summarize(stats)).toContain("Nothing filled");
  });

  it("ignores stale lead observations", async () => {
    const h = harness({ engineMid: 0.1 });
    h.lead.obs = null;
    const stats = await run(h);
    expect(stats.opportunities).toBe(0);
    expect(h.calls.quotes).toHaveLength(0);
  });

  it("does not fill when the engine has already priced the move", async () => {
    // The engine's signed price already reflects the lead move: no edge left.
    const h = harness({ engineMid: 0.1, quoteAt: () => 0.1016 });
    h.lead.obs = { mid: 0.1015, at: h.clock.t };
    const stats = await run(h, { maxTicks: 5 });
    expect(stats.quotes).toBeGreaterThan(0);
    expect(stats.fills).toBe(0);
    expect(stats.noEdge).toBeGreaterThan(0);
    expect(h.calls.fills).toBe(0);
  });

  it("stops at the quote rate cap", async () => {
    const h = harness({ engineMid: 0.1, quoteAt: () => 0.2 });
    h.lead.obs = { mid: 0.1015, at: h.clock.t };
    let ticks = 0;
    const stats = await runLeadLag({
      pair: "HSK/USDT",
      usdAmount: "100",
      taker: () => TAKER,
      config: { ...config, maxQuotesPerMinute: 3, minQuoteGapMs: 0 },
      sdk: h.sdk,
      lead: h.feed,
      recorder: null,
      now: () => h.clock.t,
      sleep: async (ms) => {
        h.clock.t += ms;
        if (h.lead.obs) h.lead.obs = { ...h.lead.obs, at: h.clock.t };
      },
      shouldStop: () => ticks++ >= 100,
    });
    expect(stats.quotes).toBe(3);
    expect(stats.rateLimited).toBeGreaterThan(0);
  });

  it("never fills a quote that fails verification", async () => {
    const h = harness({ engineMid: 0.1, verifyOk: false });
    h.lead.obs = { mid: 0.1015, at: h.clock.t };
    const stats = await run(h, { maxTicks: 3 });
    expect(stats.verifyFailed).toBeGreaterThan(0);
    expect(h.calls.fills).toBe(0);
  });

  it("counts expired quotes without filling them", async () => {
    const h = harness({ engineMid: 0.1, ttlSec: -1 });
    h.lead.obs = { mid: 0.1015, at: h.clock.t };
    const stats = await run(h, { maxTicks: 3 });
    expect(stats.expired).toBeGreaterThan(0);
    expect(h.calls.fills).toBe(0);
  });

  it("counts engine rejections and declined routes honestly", async () => {
    const rejected = harness({ engineMid: 0.1, quoteError: new ZethosError("blocked", "no") });
    rejected.lead.obs = { mid: 0.1015, at: rejected.clock.t };
    const a = await run(rejected, { maxTicks: 3 });
    expect(a.rejected).toBeGreaterThan(0);
    expect(a.fills).toBe(0);

    const pool = harness({ engineMid: 0.1, route: "pool" });
    pool.lead.obs = { mid: 0.1015, at: pool.clock.t };
    const b = await run(pool, { maxTicks: 3 });
    expect(b.declined).toBeGreaterThan(0);
    expect(b.fills).toBe(0);
  });
});

describe("lead-lag recording", () => {
  it("forces held-out recording from the CLI options", () => {
    const parsed = parseSniperOptions(["--mode", "lead-lag", "--pair", "HSK/USDT"]);
    expect(parsed.heldOut).toBe(true);
    expect(parsed.record).toMatch(/^heldout-hsk-usdt-\d+$/);
    const named = parseSniperOptions(["--mode=lead-lag", "--record=demo-run", "--held-out=false"]);
    expect(named.heldOut).toBe(true);
    expect(named.record).toBe("demo-run");
  });

  it("records lead books and taker requests into a held-out scenario with a generic manifest", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lead-lag-"));
    try {
      const recorder = new ScenarioRecorder({
        name: "heldout-test",
        pair: "HSK/USDT",
        source: HELD_OUT_SOURCE,
        heldOut: true,
        description: HELD_OUT_DESCRIPTION,
        scenariosDir: dir,
      });
      await recorder.start();

      const book = { b: [["0.1015", "1000"]], a: [["0.1016", "1000"]] };
      const feed = new RestLeadFeed({
        pair: "HSK/USDT",
        venue: "hashkey-global",
        intervalMs: 250,
        fetchFn: (async () => new Response(JSON.stringify(book))) as unknown as typeof fetch,
        recorder,
      });
      await feed.pollOnce();
      expect(feed.latest()?.mid).toBeCloseTo(0.10155, 9);

      const h = harness({ engineMid: 0.1 });
      h.lead.obs = { mid: 0.10155, at: h.clock.t };
      await run(h, { maxFills: 1, recorder });
      const summary = await recorder.stop();

      expect(summary.heldOut).toBe(true);
      expect(summary.counts.books).toBeGreaterThan(0);
      expect(summary.counts.takerRequests).toBeGreaterThan(0);
      const manifest = JSON.parse(await fs.readFile(summary.manifestPath, "utf8"));
      expect(manifest).toMatchObject({
        heldOut: true,
        source: HELD_OUT_SOURCE,
        description: HELD_OUT_DESCRIPTION,
      });
      expect(JSON.stringify(manifest)).not.toMatch(/lead|lag/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lead-lag against the real engine (in-process, paper)", () => {
  it("extracts a paper profit from the v0 incumbent when the engine lags the lead venue", async () => {
    const { createZethos } = await import("@zethos/sdk");
    const { createApp } = await import("../../engine/src/api/index.js");
    const { readyEngine } = await import("../../engine/test/helpers.js");

    let clock = 1_800_000_000_000;
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
      client: "sniper/held-out-test",
      now: () => Math.floor(clock / 1000),
      fetch: ((input, init) => app.request(String(input), init)) as typeof fetch,
    });

    const engineMid = (await sdk.market("HSK/USDT"))[0]?.mid ?? 0;
    expect(engineMid).toBeGreaterThan(0);
    const lead = { obs: { mid: engineMid * 1.015, at: clock } };
    const feed: LeadFeed = { latest: () => lead.obs, start: () => {}, stop: () => {} };

    let ticks = 0;
    const stats = await runLeadLag({
      pair: "HSK/USDT",
      usdAmount: "100",
      taker: () => TAKER,
      config,
      sdk,
      lead: feed,
      recorder: null,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        lead.obs = { ...lead.obs, at: clock };
      },
      shouldStop: () => ticks++ >= 20,
      maxFills: 1,
    });

    expect(stats.quotes).toBeGreaterThan(0);
    expect(stats.fills).toBe(1);
    expect(stats.estimatedPnlUsd).toBeGreaterThan(0);
  });
});
