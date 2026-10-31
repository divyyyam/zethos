import { expect, spyOn, test } from "bun:test";
import { createZethos } from "@zethos/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/api";
import { defaultParams, type Params } from "../src/config";
import { memoryStore } from "../src/db/memory";
import { Engine } from "../src/engine";
import { defaultMandate, type Mandate, type Policy } from "../src/policy";
import { createPolicySpec } from "../src/research/canonical";
import { compile } from "../src/research/compile";
import { createV0Spec } from "../src/research/incumbent";
import { bookAround, MIDS, SIGNER_KEY, TAKER, tokens, usdt } from "./helpers";

async function readyCompiled(
  policy: Policy,
  options: { params?: Params; mandate?: Mandate; now?: number } = {},
) {
  const params = options.params ?? defaultParams;
  const now = options.now ?? Date.now();
  const store = memoryStore();
  const signer = privateKeyToAccount(SIGNER_KEY);
  const engine = new Engine({
    chainId: 177,
    params,
    tokens,
    store,
    signer,
    policy,
    mandate: options.mandate ?? defaultMandate,
  });
  await engine.init();
  for (const pair of params.pairs) {
    engine.ingest(
      pair,
      params.feeds.sources[pair].map((venue) => ({
        venue,
        book: bookAround(MIDS[pair], pair === "HSK/USDT" ? 1_000_000 : 50),
        error: null,
      })),
      now,
    );
  }
  await engine.ensureArena(now);
  return { engine, store, signer, now };
}

test("compiled declarative v0 preserves SDK quote, local verification and durable paper fills", async () => {
  const policy = compile(createV0Spec("20261031"));
  const { engine, store } = await readyCompiled(policy);
  const app = createApp({ engine: async () => engine, corsOrigins: [], waitUntil: () => {} });
  const fetcher = ((input: string | URL | Request, init?: RequestInit) =>
    app.request(String(input), init)) as typeof fetch;
  const zethos = createZethos({
    engineUrl: "http://engine.test",
    chainId: 177,
    client: "mcp",
    fetch: fetcher,
  });
  const quote = await zethos.quote({
    taker: TAKER,
    pair: "HSK/USDT",
    side: "buy",
    amount: "250",
  });
  expect(quote.route).toBe("paper");
  if (quote.route !== "paper") throw new Error("Expected a signed paper quote");
  for (const field of ["amountIn", "amountOut", "nonce", "issuedAt", "expiry"] as const) {
    expect(quote.quote[field]).toMatch(/^\d+$/);
  }
  expect(await zethos.verifyQuote(quote)).toMatchObject({
    ok: true,
    trust: "engine",
    reasons: [],
  });
  const fill = await zethos.paperFill(quote);
  expect(fill).toMatchObject({
    quoteId: quote.id,
    amountIn: quote.quote.amountIn,
    amountOut: quote.quote.amountOut,
    flow: "agent",
    paper: true,
    txHash: null,
  });
  expect((await zethos.fills({ taker: TAKER })).map((item) => item.id)).toEqual([fill.id]);
  const persisted = await store.fills({ taker: TAKER, limit: 10, epoch: 1 });
  expect(persisted).toHaveLength(1);
  expect(persisted[0]).toMatchObject({
    id: fill.id,
    quoteId: quote.id,
    taker: TAKER,
    amountIn: quote.quote.amountIn,
    amountOut: quote.quote.amountOut,
    paper: true,
    flow: "agent",
    gasUsd: 0,
  });
  expect(await store.loadQuotes(1)).toMatchObject([
    { id: quote.id, quote: quote.quote, signature: quote.signature, status: "filled" },
  ]);
});

test("execution rejects a statically valid candidate whose book impact exceeds the fused-mid mandate", async () => {
  const params = structuredClone(defaultParams);
  const mandate = structuredClone(defaultMandate);
  mandate.service.maxHalfSpreadBps = [{ maxNotionalUsd: 50_000, maxBps: 21 }];
  const { id: _id, ...body } = createV0Spec("20261031", params);
  body.hypothesis = "Test the authority boundary between a valid policy clamp and execution.";
  body.clamp = { minBps: 5, maxBps: 21 };
  const spec = createPolicySpec(body, "20261031");
  // Static compilation accepts 21 bps; the 20 bps base plus 1 bp ask exceeds 21 in total.
  const policy = compile(spec, { params, mandate });
  const { engine, store, signer, now } = await readyCompiled(policy, { params, mandate });
  const signing = spyOn(signer, "signTypedData");
  const saving = spyOn(store, "saveQuote");
  try {
    await expect(
      engine.quote(
        {
          taker: TAKER,
          tokenIn: tokens.USDT.address,
          tokenOut: tokens.WHSK.address,
          amountIn: usdt(100),
        },
        "sdk",
        now,
      ),
    ).rejects.toMatchObject({ code: "mandate_breach", status: 422 });
    expect(signing).not.toHaveBeenCalled();
    expect(saving).not.toHaveBeenCalled();
    expect(await store.loadQuotes(1)).toEqual([]);
    const breaches = (await store.loadState(1))?.decisions.filter(
      (decision) => decision.type === "mandate_breach",
    );
    expect(breaches).toHaveLength(1);
    expect(breaches?.[0]).toMatchObject({
      pair: "HSK/USDT",
      inputs: { rule: "maximum_half_spread", limit: 21 },
    });
    expect(Number(breaches?.[0]?.inputs.actual)).toBeGreaterThan(21);
  } finally {
    signing.mockRestore();
    saving.mockRestore();
  }
});
