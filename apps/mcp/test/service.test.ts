import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZethosError } from "@zethos/sdk";
import { loadConfig } from "../src/config";
import { notional } from "../src/limits";
import { TradingService } from "../src/service";
import { Ledger } from "../src/store";
import { fixture, TAKER } from "./helpers";

const close: (() => void)[] = [];
afterEach(() => {
  for (const fn of close.splice(0).reverse()) fn();
});
const buy = { pair: "HSK/USDT", side: "buy", amount: "100" };

test("quotes keep signed fields server-side; explicit confirmation and fresh local verification precede an agent fill", async () => {
  const f = await fixture();
  close.push(() => f.ledger.close());
  const service = f.service();
  const q = await service.call("get_quote", buy);
  expect(q.isError).toBeUndefined();
  expect(q.data).toMatchObject({
    paper: true,
    youPay: { amount: "100", symbol: "USDT" },
    onChainComparison: "no on-chain venue",
  });
  expect(q.data).not.toHaveProperty("quote");
  expect(q.data).not.toHaveProperty("signature");
  expect(f.engine.arenaView().fills).toBe(0);
  const quoteId = q.data.quoteId;
  expect(await service.call("execute_swap", { quoteId })).toMatchObject({
    isError: true,
    data: { error: "invalid_request" },
  });
  expect(await service.call("execute_swap", { quoteId, confirm: false })).toHaveProperty(
    "isError",
    true,
  );
  expect(
    await service.call("execute_swap", { quoteId, confirm: true, amount: "1" }),
  ).toHaveProperty("isError", true);
  expect(await service.call("verify_quote", { quoteId })).toMatchObject({
    data: { ok: true, trust: "engine" },
  });
  const [first, duplicate] = await Promise.all([
    service.call("execute_swap", { quoteId, confirm: true }),
    service.call("execute_swap", { quoteId, confirm: true }),
  ]);
  expect(first).toEqual(duplicate);
  expect(first).toMatchObject({ data: { paper: true, fill: { flow: "agent", taker: TAKER } } });
  expect(f.engine.arenaView().fills).toBe(1);
  f.advance(120000);
  expect(await service.call("execute_swap", { quoteId, confirm: true })).toEqual(first);
});

test("spend limits cover buys and sales; exact integer rounding cannot admit a fraction over the cap", async () => {
  const f = await fixture({ ZETHOS_MAX_NOTIONAL_USD: "100" });
  close.push(() => f.ledger.close());
  let requested = 0;
  const service = f.service({
    ...f.sdk,
    quote: async (request) => {
      requested++;
      return f.sdk.quote(request);
    },
  });
  for (const input of [
    { ...buy, amount: "100.000001" },
    { ...buy, side: "sell", amount: "1000.000000000000000001" },
  ])
    expect(await service.call("get_quote", input)).toMatchObject({
      isError: true,
      data: { error: "spend_limit" },
    });
  expect(requested).toBe(0);
  const p = (await f.sdk.status()).pairs[0];
  if (!p) throw new Error("No pair");
  expect(
    notional(
      {
        taker: TAKER,
        tokenIn: p.base.address,
        tokenOut: p.quote.address,
        amountIn: "1000000000000000000001",
      },
      "sell",
      p,
      f.now(),
    ),
  ).toBe(100000001n);
  f.advance(11000);
  expect(await service.call("get_quote", { ...buy, side: "sell" })).toMatchObject({
    isError: true,
    data: { error: "stale_market" },
  });
});

test("daily reservations are atomic across concurrent quotes and persist across a restart", async () => {
  const f = await fixture({ ZETHOS_DAILY_NOTIONAL_USD: "100" });
  close.push(() => f.ledger.close());
  const path = mkdtempSync(join(tmpdir(), "zethos-mcp-"));
  close.push(() => {
    if (!path.startsWith(join(tmpdir(), "zethos-mcp-")))
      throw new Error("Unexpected cleanup target");
    rmSync(path, { recursive: true, force: true });
  });
  let ledger = new Ledger(join(path, "state.db"), "same-identity");
  close.push(() => ledger.close());
  let service = new TradingService(f.sdk, f.config, ledger, f.now);
  const a = await service.call("get_quote", buy),
    b = await service.call("get_quote", buy);
  const results = await Promise.all(
    [a, b].map((q) => service.call("execute_swap", { quoteId: q.data.quoteId, confirm: true })),
  );
  expect(results.filter((r) => !r.isError)).toHaveLength(1);
  expect(results.find((r) => r.isError)).toMatchObject({ data: { error: "daily_limit" } });
  const winner = results.find((r) => !r.isError);
  if (!winner) throw new Error("Expected one successful fill");
  ledger.close();
  ledger = new Ledger(join(path, "state.db"), "same-identity");
  service = new TradingService(f.sdk, f.config, ledger, f.now);
  expect(
    await service.call("execute_swap", { quoteId: winner?.data.quoteId, confirm: true }),
  ).toEqual(winner);
  const newQuote = await service.call("get_quote", buy);
  expect(
    await service.call("execute_swap", { quoteId: newQuote.data.quoteId, confirm: true }),
  ).toMatchObject({ data: { error: "daily_limit" } });
  const tomorrow = new Date(f.now());
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  // A fresh quote is needed the next day; ledger budget resets at UTC midnight.
  expect(
    ledger.reserve("tomorrow", tomorrow.toISOString().slice(0, 10), 100000000n, 100000000n),
  ).toBeNull();
});

test("expiry, tampering and route failures never reach settlement", async () => {
  const f = await fixture();
  close.push(() => f.ledger.close());
  const normal = f.service(),
    q = await normal.call("get_quote", buy);
  f.advance(31000);
  expect(
    await normal.call("execute_swap", { quoteId: q.data.quoteId, confirm: true }),
  ).toMatchObject({ isError: true, data: { error: "quote_expired" } });
  // Renew fixture books after the intentionally expired quote.
  const fresh = await fixture();
  close.push(() => fresh.ledger.close());
  const tampered = fresh.service({
    ...fresh.sdk,
    quote: async (request) => {
      const signed = await fresh.sdk.quote(request);
      return signed.route === "paper"
        ? { ...signed, quote: { ...signed.quote, amountOut: "1" } }
        : signed;
    },
  });
  expect(await tampered.call("get_quote", buy)).toMatchObject({
    isError: true,
    data: { error: "unverified_quote" },
  });
  expect(
    await fresh
      .service({
        ...fresh.sdk,
        quote: async () => ({
          route: "hskswap",
          hskswapOut: "1",
          venue: "test",
          reason: "better pool",
        }),
      })
      .call("get_quote", buy),
  ).toMatchObject({ isError: true, data: { error: "pool_route" } });
  expect(f.engine.arenaView().fills + fresh.engine.arenaView().fills).toBe(0);
});

test("an uncertain submission is never repeated and keeps its daily reservation", async () => {
  const f = await fixture({ ZETHOS_DAILY_NOTIONAL_USD: "100" });
  close.push(() => f.ledger.close());
  let submissions = 0;
  const service = f.service({
    ...f.sdk,
    paperFill: async () => {
      submissions++;
      throw new ZethosError("timeout", "lost response");
    },
  });
  const q = await service.call("get_quote", buy);
  const first = await service.call("execute_swap", { quoteId: q.data.quoteId, confirm: true });
  expect(first).toMatchObject({
    isError: true,
    data: { error: "timeout", execution: "unknown", retryable: false },
  });
  expect(await service.call("execute_swap", { quoteId: q.data.quoteId, confirm: true })).toEqual(
    first,
  );
  expect(submissions).toBe(1);
  const second = await service.call("get_quote", buy);
  expect(
    await service.call("execute_swap", { quoteId: second.data.quoteId, confirm: true }),
  ).toMatchObject({ data: { error: "daily_limit" } });
});

test("verification is repeated at execution; unknown IDs and live builders cannot paper-fill", async () => {
  const f = await fixture();
  close.push(() => f.ledger.close());
  const good = f.service(),
    q = await good.call("get_quote", buy);
  expect(await good.call("build_fill_tx", { quoteId: q.data.quoteId })).toMatchObject({
    data: { error: "wrong_mode" },
  });
  expect(await good.call("verify_quote", { quoteId: "invented" })).toMatchObject({
    data: { error: "unknown_quote" },
  });
  const bad = f.service({
    ...f.sdk,
    verifyQuote: async () => ({ ok: false, trust: "engine", reasons: ["bad_signer"] }),
  });
  expect(await bad.call("execute_swap", { quoteId: q.data.quoteId, confirm: true })).toMatchObject({
    data: { error: "unverified_quote" },
  });
  expect(f.engine.arenaView().fills).toBe(0);
});

test("public tools return actual engine data and structured failures without invented defaults", async () => {
  const f = await fixture();
  close.push(() => f.ledger.close());
  const s = f.service();
  expect(await s.call("get_market", {})).toMatchObject({
    data: {
      paper: true,
      dataSource: "replay",
      pairs: [{ pair: "HSK/USDT", venues: [] }, { pair: "ETH/USDT" }],
    },
  });
  expect(await s.call("get_arena", {})).toMatchObject({
    data: { paper: true, fills: 0, tierCounts: { toxic: 0 } },
  });
  expect(await s.call("get_stats", { pair: "HSK/USDT" })).toMatchObject({ data: { paper: true } });
  expect(await s.call("get_quote", { ...buy, amount: "a hundred" })).toHaveProperty(
    "isError",
    true,
  );
  const failure = f.service({
    ...f.sdk,
    status: async () => {
      throw new ZethosError("network", "Engine unreachable");
    },
  });
  expect(await failure.call("get_market", {})).toMatchObject({
    isError: true,
    data: { error: "network", message: "Engine unreachable" },
  });
});

test("configuration refuses missing identity, private material in URL and invalid budgets", () => {
  expect(() => loadConfig({})).toThrow();
  for (const input of [
    { ZETHOS_TAKER_ADDRESS: "secret" },
    { ZETHOS_MAX_NOTIONAL_USD: "-1" },
    { ZETHOS_ENGINE_URL: "https://user:secret@engine.test" },
    { ZETHOS_DAILY_NOTIONAL_USD: "1e3" },
  ])
    expect(() => loadConfig({ ZETHOS_TAKER_ADDRESS: TAKER, ...input })).toThrow();
});

test("a crash after reservation blocks replay and preserves the daily budget across ledger handles", async () => {
  const f = await fixture();
  close.push(() => f.ledger.close());
  const service = f.service();
  const quote = await service.call("get_quote", buy);
  const id = String(quote.data.quoteId);
  const day = new Date(f.now()).toISOString().slice(0, 10);
  f.ledger.reserve(id, day, 100000000n, 100000000n);
  expect(await service.call("execute_swap", { quoteId: id, confirm: true })).toMatchObject({
    isError: true,
    data: { error: "execution_unknown" },
  });
  expect(() => f.ledger.reserve("another", day, 1n, 100000000n)).toThrow("UTC-day");
  expect(f.engine.arenaView().fills).toBe(0);
});

test("a definitive rejection is terminal for that quote and releases only its own budget", async () => {
  const f = await fixture({ ZETHOS_DAILY_NOTIONAL_USD: "100" });
  close.push(() => f.ledger.close());
  let count = 0;
  const service = f.service({
    ...f.sdk,
    paperFill: async (quote, request) => {
      count++;
      if (count === 1) throw new ZethosError("vault_capacity", "Insufficient paper inventory", 422);
      return f.sdk.paperFill(quote, request);
    },
  });
  const a = await service.call("get_quote", buy);
  const rejected = await service.call("execute_swap", { quoteId: a.data.quoteId, confirm: true });
  expect(rejected).toMatchObject({
    isError: true,
    data: { error: "vault_capacity", execution: "rejected" },
  });
  expect(await service.call("execute_swap", { quoteId: a.data.quoteId, confirm: true })).toEqual(
    rejected,
  );
  expect(count).toBe(1);
  const b = await service.call("get_quote", buy);
  expect(
    await service.call("execute_swap", { quoteId: b.data.quoteId, confirm: true }),
  ).toMatchObject({ data: { paper: true } });
  expect(f.engine.arenaView().fills).toBe(1);
});
