import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Fill, Status, VaultQuote } from "@zethos/sdk";
import { ZethosError } from "@zethos/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Result } from "../src/components/platform/agent/result";
import { parseIntent } from "../src/lib/agent/intent";
import { runSlice } from "../src/lib/agent/runtime/execution";
import { addDraft } from "../src/lib/agent/runtime/missions";
import { compilePlan } from "../src/lib/agent/runtime/planning";
import { readPosition, readReport } from "../src/lib/agent/runtime/reports";
import { RuntimeState } from "../src/lib/agent/runtime/state";
import type { AgentSdk } from "../src/lib/agent/runtime/types";

const taker = "0x1111111111111111111111111111111111111111";
const tokenIn = "0x2222222222222222222222222222222222222222";
const tokenOut = "0x3333333333333333333333333333333333333333";
const txHash = `0x${"ab".repeat(32)}` as const;
const current: Status = {
  mode: "live",
  chainId: 133,
  signer: taker,
  verifyingContract: tokenOut,
  paused: false,
  riskState: "normal",
  equityUsd: 10000,
  inventory: { WHSK: "1000000000000000000000" },
  pairs: [
    {
      pair: "HSK/USDT",
      base: { address: tokenOut, symbol: "WHSK", label: "tWHSK", decimals: 18 },
      quote: { address: tokenIn, symbol: "USDT", label: "tUSDT", decimals: 6 },
      mid: 1,
      health: "ok",
      halted: false,
      sources: [],
      halfSpread: { buy: 0, sell: 0 },
      updatedAt: Date.now(),
      vaultRoutes: {
        buy: { enabled: true, maxAmountIn: "100000000" },
        sell: { enabled: true, maxAmountIn: "100000000000000000000" },
      },
    },
  ],
};
function fill(paper: boolean, units: number): Fill {
  return {
    id: paper ? "paper" : "chain",
    quoteId: "q",
    policyId: "v0",
    ts: Date.now(),
    taker,
    pair: "HSK/USDT",
    side: "buy",
    tokenIn,
    tokenOut,
    amountIn: String(units * 1000000),
    amountOut: String(BigInt(units) * 10n ** 18n),
    price: 1,
    midAtFill: 1,
    flow: "agent",
    paper,
    txHash: paper ? null : txHash,
  };
}
const sdk = (extra: Partial<AgentSdk> = {}): AgentSdk => ({
  status: async () => current,
  fills: async () => [fill(true, 10), fill(false, 20)],
  quote: async () => {
    throw new Error("Unexpected quote");
  },
  verifyQuote: async () => ({ ok: true, trust: "chain", reasons: [] }),
  paperFill: async () => {
    throw new Error("Live mission must not paper-fill");
  },
  stats: async () => ({ series: [], venues: [] }),
  stream: () => () => {},
  ...extra,
});

test("position keeps paper and on-chain exposure in separate rows", async () => {
  const report = await readPosition(new RuntimeState({ sdk: sdk() }), taker);
  assert.equal(report.type, "position");
  if (report.type !== "position") throw new Error("Expected position");
  assert.equal(report.rows.find((r) => r.settlement === "paper")?.net, 10);
  assert.equal(report.rows.find((r) => r.settlement === "onchain")?.net, 20);
  assert.equal(report.rows.find((r) => r.settlement === "paper")?.fills, 1);
  assert.equal(report.rows.find((r) => r.settlement === "onchain")?.fills, 1);
  assert.equal(report.rows[0]?.baseSymbol, "tWHSK");
});

test("live mission verifies before settlement, reports waiting progress and renders explorer link", async () => {
  const intent = parseIntent("Buy 25 USDT of HSK").intent;
  assert.equal(intent.kind, "swap");
  if (intent.kind !== "swap" || !current.pairs[0]) throw new Error("Expected swap");
  const plan = compilePlan(intent, current.pairs[0]);
  if (typeof plan === "string") throw new Error(plan);
  const order: string[] = [];
  const quote: VaultQuote = {
    route: "conduit",
    id: "q",
    quote: {
      taker,
      tokenIn,
      tokenOut,
      amountIn: "25000000",
      amountOut: "25000000000000000000",
      nonce: "1",
      issuedAt: String(Math.floor(Date.now() / 1000)),
      expiry: String(Math.floor(Date.now() / 1000) + 60),
    },
    signature: `0x${"00".repeat(65)}`,
    conduitOut: "25000000000000000000",
    hskswapOut: null,
    spotOut: "25000000000000000000",
    vsMidBps: 0,
    savingPct: null,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    breakdown: {
      mid: 1,
      ref: 1,
      sources: [],
      base: 0,
      vol: 0,
      inventory: 0,
      toxicity: 0,
      degraded: 0,
      tuner: 1,
      half: 0,
      sigmaT: 0,
      ttlSec: 60,
      tier: "probation",
    },
  };
  const context = new RuntimeState({
    sdk: sdk({
      quote: async () => quote,
      verifyQuote: async () => {
        order.push("verify");
        return { ok: true, trust: "chain", reasons: [] };
      },
    }),
    sleep: async () => {},
    settleLive: async (_quote, trade) => {
      assert.deepEqual(order, ["verify"]);
      trade.onProgress?.("Approve token spending in your wallet…");
      assert.equal(
        context.missions[0]?.stages.settle.detail,
        "Approve token spending in your wallet…",
      );
      trade.onProgress?.("Confirm the vault fill in your wallet…");
      assert.equal(
        context.missions[0]?.stages.settle.detail,
        "Confirm the vault fill in your wallet…",
      );
      return fill(false, 25);
    },
  });
  const mission = addDraft(context, "Buy 25 USDT of HSK", taker, plan, false);
  const measures: Promise<void>[] = [];
  assert.equal(
    await runSlice(context, mission.id, plan, 0, false, new AbortController().signal, measures),
    "filled",
  );
  await Promise.all(measures);
  const completed = context.missions[0];
  assert.ok(completed);
  assert.equal(completed.quote?.route, "conduit");
  const html = renderToStaticMarkup(createElement(Result, { mission: completed }));
  assert.ok(html.includes(`/tx/${txHash}`));
  assert.ok(!/paper/i.test(html));
});

test("price explanation includes route capacity and the actual refusal", async () => {
  const report = await readReport(
    new RuntimeState({
      sdk: sdk({
        quote: async () => {
          throw new ZethosError("vault_capacity", "The vault is not taking this side right now");
        },
      }),
    }),
    { kind: "explain", pair: "HSK/USDT" },
    taker,
  );
  assert.equal(report.type, "notice");
  if (report.type !== "notice") throw new Error("Expected capacity notice");
  assert.ok(report.detail.includes("100 tUSDT"));
  assert.ok(report.detail.includes("1000 tWHSK"));
  assert.ok(report.detail.includes("The vault is not taking this side right now"));
});
