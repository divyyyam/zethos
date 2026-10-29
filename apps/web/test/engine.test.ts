import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { EngineError, engine } from "../src/lib/engine/client";
import type { QuoteRequest } from "../src/lib/engine/types";
import { platformConfig } from "../src/lib/platform-config";

const taker = "0x1111111111111111111111111111111111111111";
const tokenIn = "0x2222222222222222222222222222222222222222";
const tokenOut = "0x3333333333333333333333333333333333333333";
const request: QuoteRequest = { taker, tokenIn, tokenOut, amountIn: "1000000" };
const originalFetch = globalThis.fetch;
const originalUrl = platformConfig.engineUrl;
const originalVault = platformConfig.vaultAddress;

function fixture() {
  const now = Math.floor(Date.now() / 1000);
  return {
    route: "conduit",
    quote: {
      ...request,
      amountOut: "12000000000000000000",
      nonce: "37",
      issuedAt: String(now),
      expiry: String(now + 30),
    },
    signature: `0x${"12".repeat(65)}`,
    conduitOut: "12000000000000000000",
    hskswapOut: "11900000000000000000",
    spotOut: "11950000000000000000",
    savingPct: 0.84,
    expiresAt: now + 30,
  };
}

function respond(body: unknown, status = 200) {
  globalThis.fetch = (async () => Response.json(body, { status })) as typeof fetch;
}

beforeEach(() => {
  platformConfig.engineUrl = "https://engine.example.test";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  platformConfig.engineUrl = originalUrl;
  platformConfig.vaultAddress = originalVault;
});

describe("engine quote boundary", () => {
  test("preserves raw token precision and normalizes millisecond expiry", async () => {
    const body = fixture();
    body.expiresAt *= 1000;
    respond(body);
    const result = await engine.quote(request);
    assert.equal(result.route, "conduit");
    if (result.route !== "conduit") throw new Error("Expected a vault quote");
    assert.equal(result.quote.amountOut, "12000000000000000000");
    assert.equal(result.expiresAt, Number(body.quote.expiry));
  });

  test("keeps a pool recommendation distinct from a signed vault quote", async () => {
    respond({ route: "hskswap", hskswapOut: { raw: "12000000000000000001" } });
    assert.deepEqual(await engine.quote(request), {
      route: "hskswap",
      hskswapOut: "12000000000000000001",
      reason: "The pool has the better price for this swap.",
    });
  });

  for (const field of ["taker", "tokenIn", "tokenOut", "amountIn"] as const) {
    test(`rejects a signed quote for a different ${field}`, async () => {
      const body = fixture();
      if (field === "amountIn") body.quote.amountIn = "999999";
      else body.quote[field] = "0x4444444444444444444444444444444444444444";
      respond(body);
      await assert.rejects(engine.quote(request), { code: "invalid_quote" });
    });
  }

  test("rejects unsigned or ambiguous routes", async () => {
    respond({ ...fixture(), route: "unexpected" });
    await assert.rejects(engine.quote(request), { code: "invalid_response" });
    respond({ ...fixture(), signature: "0x1234" });
    await assert.rejects(engine.quote(request), { code: "invalid_quote" });
  });

  test("rejects expired quotes and a mismatched display expiry", async () => {
    const body = fixture();
    body.quote.issuedAt = String(Number(body.quote.issuedAt) - 40);
    body.quote.expiry = String(Number(body.quote.expiry) - 40);
    body.expiresAt -= 40;
    respond(body);
    await assert.rejects(engine.quote(request), { code: "expired_quote" });
    respond({ ...fixture(), expiresAt: body.expiresAt + 80 });
    await assert.rejects(engine.quote(request), { code: "expired_quote" });
  });

  test("rejects quotes outside the contract's maximum validity window", async () => {
    const body = fixture();
    body.quote.expiry = String(Number(body.quote.issuedAt) + 121);
    body.expiresAt = Number(body.quote.expiry);
    respond(body);
    await assert.rejects(engine.quote(request), { code: "invalid_quote" });
  });

  for (const [field, value] of [
    ["amountOut", "-1"],
    ["amountOut", "1.5"],
    ["amountOut", "1e18"],
    ["nonce", (1n << 256n).toString()],
    ["issuedAt", (1n << 64n).toString()],
    ["expiry", (1n << 64n).toString()],
  ] as const) {
    test(`rejects invalid ${field}: ${value}`, async () => {
      const body = fixture();
      body.quote[field] = value;
      respond(body);
      await assert.rejects(engine.quote(request), { code: "invalid_response" });
    });
  }

  test("rejects an output that differs from the signed amount", async () => {
    respond({ ...fixture(), conduitOut: "13000000000000000000" });
    await assert.rejects(engine.quote(request), { code: "invalid_quote" });
  });

  for (const field of ["hskswapOut", "spotOut"] as const) {
    test(`rejects a vault price worse than ${field}`, async () => {
      respond({ ...fixture(), [field]: "12000000000000000001" });
      await assert.rejects(engine.quote(request), { code: "invalid_quote" });
    });
  }

  test("does not request a same-token or zero-amount swap", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json(fixture());
    }) as typeof fetch;
    await assert.rejects(engine.quote({ ...request, tokenOut: tokenIn }), {
      code: "invalid_request",
    });
    await assert.rejects(engine.quote({ ...request, amountIn: "0" }), { code: "invalid_request" });
    assert.equal(calls, 0);
  });
});

describe("engine failure behavior", () => {
  test("does not fetch or return sample data without a configured service", async () => {
    platformConfig.engineUrl = null;
    globalThis.fetch = (async () => {
      throw new Error("A network request should not have happened");
    }) as typeof fetch;
    await assert.rejects(engine.quote(request), { code: "not_configured" });
  });

  test("maps a real service rejection without fabricating a quote", async () => {
    respond({ error: "paused" }, 503);
    await assert.rejects(engine.quote(request), (error: unknown) => {
      assert.ok(error instanceof EngineError);
      assert.equal(error.code, "paused");
      assert.equal(error.status, 503);
      return true;
    });
  });

  test("rejects malformed JSON", async () => {
    globalThis.fetch = (async () => new Response("not json")) as typeof fetch;
    await assert.rejects(engine.quote(request), { code: "invalid_response" });
  });

  test("rejects vault status from a different deployment", async () => {
    platformConfig.vaultAddress = taker;
    respond({
      paused: false,
      riskState: "healthy",
      pairs: [],
      vault: { address: tokenIn, balances: {} },
    });
    await assert.rejects(engine.status(), { code: "invalid_response" });
  });

  test("rejects non-finite market data", async () => {
    respond({ series: [{ t: 100, mid: null, poolPrice: 0.08 }], summary: {} });
    await assert.rejects(engine.stats("HSK/USDT", 0, 100), { code: "invalid_response" });
  });
});
