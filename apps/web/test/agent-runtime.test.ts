import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { type Fill, type PairStatus, type PaperQuote, type Status, ZethosError } from "@zethos/sdk";
import type { Address } from "viem";
import { parseIntent, type SwapIntent } from "../src/lib/agent/intent";
import {
  AgentRuntime,
  type AgentSdk,
  compilePlan,
  type Mission,
  missionTotals,
} from "../src/lib/agent/runtime";

const taker = "0x1111111111111111111111111111111111111111" as Address;
const usdt = { symbol: "USDT", address: `0x${"a".repeat(40)}` as Address, decimals: 6 };
const whsk = { symbol: "WHSK", address: `0x${"b".repeat(40)}` as Address, decimals: 18 };
const weth = { symbol: "WETH", address: `0x${"c".repeat(40)}` as Address, decimals: 18 };

function pairStatus(mid: number, overrides: Partial<PairStatus> = {}): PairStatus {
  return {
    pair: "HSK/USDT",
    base: whsk,
    quote: usdt,
    mid,
    health: "ok",
    halted: false,
    sources: [{ venue: "gate", mid, weight: 1, status: "ok" }],
    halfSpread: { buy: 0.004, sell: 0.004 },
    updatedAt: Date.now(),
    ...overrides,
  };
}

function statusOf(mid: number, overrides: Partial<Status> = {}): Status {
  return {
    mode: "shadow",
    chainId: 177,
    signer: taker,
    verifyingContract: `0x${"0".repeat(40)}` as Address,
    paused: false,
    riskState: "normal",
    pairs: [pairStatus(mid), pairStatus(2000, { pair: "ETH/USDT", base: weth })],
    inventory: {},
    equityUsd: 100_000,
    ...overrides,
  };
}

const breakdown = {
  mid: 0.1,
  ref: 0.1003,
  sources: [],
  base: 0.002,
  vol: 0.002,
  inventory: 0,
  toxicity: 0,
  degraded: 0,
  tuner: 1,
  half: 0.004,
  sigmaT: 0.001,
  ttlSec: 30,
  tier: "normal" as const,
};

type Fake = AgentSdk & {
  calls: { quote: number; verify: number; fill: number };
  state: {
    mid: number;
    vsMidBps: number[];
    verifyOk: boolean;
    fillError: Error | null;
    status: Status | null;
  };
};

function fakeSdk(): Fake {
  const calls = { quote: 0, verify: 0, fill: 0 };
  const state: Fake["state"] = {
    mid: 0.1,
    vsMidBps: [50],
    verifyOk: true,
    fillError: null,
    status: null,
  };
  return {
    calls,
    state,
    status: async () => state.status ?? statusOf(state.mid),
    quote: async (input: unknown) => {
      const request = input as { amountIn: string };
      const vsMidBps = state.vsMidBps[Math.min(calls.quote, state.vsMidBps.length - 1)] ?? 50;
      calls.quote += 1;
      const out = ((BigInt(request.amountIn) * 10n ** 12n) / 1004n) * 10n;
      return {
        route: "paper",
        id: `q_${calls.quote}`,
        quote: { amountIn: request.amountIn, amountOut: out.toString(), nonce: "7" },
        signature: "0xabc",
        paperOut: out.toString(),
        vsMidBps,
        expiresAt: 0,
        breakdown,
      } as unknown as PaperQuote;
    },
    verifyQuote: async () => {
      calls.verify += 1;
      return state.verifyOk
        ? { ok: true, trust: "engine", reasons: [] }
        : { ok: false, trust: "engine", reasons: ["bad_signer"] };
    },
    paperFill: async (quote: unknown) => {
      calls.fill += 1;
      if (state.fillError) throw state.fillError;
      const paper = quote as PaperQuote;
      return {
        id: `f_${calls.fill}`,
        quoteId: paper.id,
        policyId: paper.policyId,
        ts: Date.now(),
        taker,
        pair: "HSK/USDT",
        side: "buy",
        tokenIn: usdt.address,
        tokenOut: whsk.address,
        amountIn: paper.quote.amountIn,
        amountOut: paper.paperOut,
        price: 0.1004,
        midAtFill: state.mid,
        flow: "agent",
        paper: true,
        txHash: null,
      } satisfies Fill;
    },
    fills: async () => [],
    stats: async () => ({ series: [], venues: [] }),
    stream: () => () => {},
  } as unknown as Fake;
}

let release: (() => void) | null = null;
function setup(sdk: AgentSdk) {
  const runtime = new AgentRuntime({
    sdk,
    pollMs: 1,
    // Virtual waits: everything that sleeps resumes on the next macrotask.
    sleep: (_ms, signal) =>
      new Promise((resolve) => {
        if (signal.aborted) resolve();
        else setTimeout(resolve, 1);
      }),
  });
  release = runtime.retain();
  return runtime;
}
afterEach(() => {
  release?.();
  release = null;
});

async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 2000; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(`timed out waiting for ${label}`);
}
async function ready(runtime: AgentRuntime) {
  await until(() => runtime.getMarket().status !== null, "first status");
}
function only(runtime: AgentRuntime): Mission {
  const mission = runtime.getMissions()[0];
  assert.ok(mission);
  return mission;
}
const settled = (status: string) => ["done", "failed", "stopped"].includes(status);

describe("planning", () => {
  const plan = (text: string, mid = 0.1) => {
    const { intent } = parseIntent(text);
    return compilePlan(intent as SwapIntent, pairStatus(mid));
  };
  test("slices sum exactly to the total", () => {
    const result = plan("buy 100 usdt of hsk in 3 slices");
    assert.ok(typeof result !== "string");
    assert.equal(result.amountIn, "100000000");
    assert.deepEqual(result.sliceAmounts, ["33333333", "33333333", "33333334"]);
    assert.equal(
      result.sliceAmounts.reduce((sum, value) => sum + BigInt(value), 0n),
      100000000n,
    );
  });
  test("uses engine decimals, never assumed ones", () => {
    const result = plan("sell 1000 hsk");
    assert.ok(typeof result !== "string");
    assert.equal(result.amountIn, `1000${"0".repeat(18)}`);
    assert.equal(result.approximate, false);
  });
  test("sizing the other token is flagged as approximate", () => {
    const result = plan("buy 1000 hsk");
    assert.ok(typeof result !== "string");
    assert.equal(result.approximate, true);
    assert.equal(result.soldSymbol, "USDT");
  });
  test("refuses below the minimum and shrinks slices that would be", () => {
    assert.equal(typeof plan("buy 2 usdt of hsk"), "string");
    const shrunk = plan("buy 30 usdt of hsk in 20 slices");
    assert.ok(typeof shrunk !== "string");
    assert.equal(shrunk.sliceAmounts.length, 5);
    assert.equal(shrunk.notes.length, 1);
  });
  test("refuses a halted pair", () => {
    const { intent } = parseIntent("buy 100 usdt of hsk");
    assert.equal(
      typeof compilePlan(intent as SwapIntent, pairStatus(0.1, { halted: true })),
      "string",
    );
  });
});

describe("missions", () => {
  test("nothing is priced or filled before authorization", async () => {
    const sdk = fakeSdk();
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("buy 100 usdt of hsk", taker);
    assert.equal(only(runtime).status, "draft");
    assert.equal(sdk.calls.quote, 0);
    runtime.discard(only(runtime).id);
    assert.equal(runtime.getMissions().length, 0);
    assert.equal(sdk.calls.fill, 0);
  });

  test("runs every stage and reports real totals", async () => {
    const sdk = fakeSdk();
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("buy 100 usdt of hsk", taker);
    runtime.authorize(only(runtime).id);
    await until(() => settled(only(runtime).status), "mission end");
    const mission = only(runtime);
    assert.equal(mission.status, "done");
    assert.equal(sdk.calls.fill, 1);
    for (const stage of Object.values(mission.stages)) assert.equal(stage.state, "done");
    const totals = missionTotals(mission);
    assert.equal(totals.filled, 1);
    assert.equal(totals.paid, 100);
    assert.equal(Object.keys(mission.slices[0]?.markouts ?? {}).length, 3);
  });

  test("a failed local verification never fills", async () => {
    const sdk = fakeSdk();
    sdk.state.verifyOk = false;
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("buy 100 usdt of hsk", taker);
    runtime.authorize(only(runtime).id);
    await until(() => settled(only(runtime).status), "mission end");
    assert.equal(only(runtime).status, "failed");
    assert.equal(sdk.calls.fill, 0);
    assert.match(only(runtime).error ?? "", /bad_signer/);
  });

  test("holds over the cost limit, then fills when the price comes back", async () => {
    const sdk = fakeSdk();
    sdk.state.vsMidBps = [200, 200, 80];
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("buy 100 usdt of hsk, max 100 bps", taker);
    runtime.authorize(only(runtime).id);
    await until(() => settled(only(runtime).status), "mission end");
    assert.equal(only(runtime).status, "done");
    assert.equal(sdk.calls.quote, 3);
    assert.equal(sdk.calls.fill, 1);
  });

  test("gives up over the limit once the hold window ends, unfilled", async () => {
    const sdk = fakeSdk();
    sdk.state.vsMidBps = [500];
    let now = 1_000_000;
    const runtime = new AgentRuntime({
      sdk,
      now: () => now,
      pollMs: 1,
      sleep: (ms, signal) =>
        new Promise((resolve) => {
          now += ms;
          if (signal.aborted) resolve();
          else setTimeout(resolve, 1);
        }),
    });
    release = runtime.retain();
    await ready(runtime);
    runtime.submit("buy 100 usdt of hsk, max 100 bps", taker);
    runtime.authorize(only(runtime).id);
    await until(() => settled(only(runtime).status), "mission end");
    assert.equal(only(runtime).status, "failed");
    assert.equal(sdk.calls.fill, 0);
    assert.match(only(runtime).error ?? "", /Nothing was filled/);
  });

  test("dry runs price and verify but never settle", async () => {
    const sdk = fakeSdk();
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("quote 100 usdt of hsk", taker);
    runtime.authorize(only(runtime).id);
    await until(() => settled(only(runtime).status), "mission end");
    assert.equal(only(runtime).status, "done");
    assert.equal(sdk.calls.verify, 1);
    assert.equal(sdk.calls.fill, 0);
  });

  test("a failed slice stops the schedule and keeps earlier fills", async () => {
    const sdk = fakeSdk();
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("buy 100 usdt of hsk in 3 slices", taker);
    runtime.authorize(only(runtime).id);
    await until(() => sdk.calls.fill >= 1, "first fill");
    sdk.state.fillError = new ZethosError("vault_capacity", "full", 422);
    await until(() => settled(only(runtime).status), "mission end");
    const mission = only(runtime);
    assert.equal(mission.status, "failed");
    assert.deepEqual(
      mission.slices.map((slice) => slice.state),
      ["filled", "failed", "skipped"],
    );
    assert.equal(missionTotals(mission).filled, 1);
  });

  test("a network failure at settlement is reported as unknown and never retried", async () => {
    const sdk = fakeSdk();
    sdk.state.fillError = new ZethosError("network", "unreachable");
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("buy 100 usdt of hsk", taker);
    runtime.authorize(only(runtime).id);
    await until(() => settled(only(runtime).status), "mission end");
    assert.equal(sdk.calls.fill, 1);
    assert.match(only(runtime).error ?? "", /may or may not have settled/);
  });

  test("an expired quote is re-priced once, because it can't have filled", async () => {
    const sdk = fakeSdk();
    sdk.state.fillError = new ZethosError("quote_expired", "expired", 409);
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("buy 100 usdt of hsk", taker);
    runtime.authorize(only(runtime).id);
    await until(() => settled(only(runtime).status), "mission end");
    assert.equal(sdk.calls.fill, 2);
    assert.equal(only(runtime).status, "failed");
  });

  test("refuses to run outside shadow mode", async () => {
    const sdk = fakeSdk();
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("buy 100 usdt of hsk", taker);
    sdk.state.status = statusOf(0.1, { mode: "live" });
    runtime.authorize(only(runtime).id);
    await until(() => settled(only(runtime).status), "mission end");
    assert.equal(only(runtime).status, "failed");
    assert.equal(sdk.calls.quote, 0);
  });

  test("an armed trigger waits, fires on the real mid, then fills", async () => {
    const sdk = fakeSdk();
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("buy 100 usdt of hsk if it drops 1%", taker);
    runtime.authorize(only(runtime).id);
    await until(() => only(runtime).trigger !== null, "arming");
    assert.equal(only(runtime).status, "armed");
    assert.equal(sdk.calls.quote, 0);
    sdk.state.mid = 0.0985;
    await until(() => settled(only(runtime).status), "mission end");
    assert.equal(only(runtime).status, "done");
    assert.ok(only(runtime).trigger?.firedAt);
    assert.equal(sdk.calls.fill, 1);
  });

  test("stopping an armed trigger never fills", async () => {
    const sdk = fakeSdk();
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("buy 100 usdt of hsk when hsk is below 0.01", taker);
    runtime.authorize(only(runtime).id);
    await until(() => only(runtime).trigger !== null, "arming");
    runtime.submit("stop", taker);
    const armed = runtime.getMissions().find((mission) => mission.trigger);
    await until(
      () => runtime.getMissions().find((m) => m.id === armed?.id)?.status === "stopped",
      "stop",
    );
    assert.equal(sdk.calls.fill, 0);
  });

  test("position marks net exposure at the mid; flatten drafts the closing trade", async () => {
    const sdk = fakeSdk();
    sdk.fills = (async () => [
      {
        id: "f1",
        pair: "HSK/USDT",
        side: "buy",
        amountIn: "100000000",
        amountOut: `1000${"0".repeat(18)}`,
      },
    ]) as unknown as AgentSdk["fills"];
    const runtime = setup(sdk);
    await ready(runtime);
    runtime.submit("my position", taker);
    await until(() => only(runtime).report !== null, "position");
    const report = only(runtime).report;
    assert.ok(report?.type === "position");
    const row = report.rows.find((r) => r.pair === "HSK/USDT");
    assert.equal(row?.net, 1000);
    assert.equal(row?.quoteFlow, -100);
    assert.ok(Math.abs(row?.pnlUsd ?? 1) < 1e-9);

    runtime.submit("flatten hsk", taker);
    await until(() => only(runtime).status === "draft", "flatten draft");
    assert.equal(only(runtime).plan?.side, "sell");
    assert.equal(sdk.calls.fill, 0);
  });

  test("with no engine it refuses instead of inventing anything", () => {
    const runtime = new AgentRuntime({ sdk: null });
    assert.equal(runtime.getMarket().connection, "unconfigured");
    const { refusal, missions } = runtime.submit("buy 100 usdt of hsk", taker);
    assert.ok(refusal);
    assert.equal(missions.length, 0);
  });
});
