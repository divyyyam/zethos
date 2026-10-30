import { describe, expect, test } from "bun:test";
import { createZethos, type QuoteRequest, type QuoteResponse, ZethosError } from "../src/index.js";
import {
  ENGINE_URL,
  fillBody,
  mockEngine,
  paperQuoteBody,
  request,
  signedQuote,
  statusBody,
  TAKER,
  USDT,
  WHSK,
} from "./fixtures.js";

function client(routes: Parameters<typeof mockEngine>[0], extra = {}) {
  const engine = mockEngine({ "GET /status": () => statusBody(), ...routes });
  return {
    engine,
    zethos: createZethos({ engineUrl: ENGINE_URL, chainId: 133, fetch: engine.fetch, ...extra }),
  };
}

async function expectCode(promise: Promise<unknown>, code: string, status?: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ZethosError);
  expect((error as ZethosError).code).toBe(code);
  if (status !== undefined) expect((error as ZethosError).status).toBe(status);
}

describe("quote boundary", () => {
  test("preserves raw token precision and accepts a millisecond expiresAt", async () => {
    const body = await paperQuoteBody(signedQuote({ amountOut: "1990000000000000001" }));
    body.paperOut = body.quote.amountOut;
    body.expiresAt *= 1000;
    const { zethos } = client({ "POST /quote": () => body });
    const quote = await zethos.quote(request);
    if (quote.route !== "paper") throw new Error("Expected a paper quote");
    expect(quote.quote.amountOut).toBe("1990000000000000001");
    expect(await zethos.verifyQuote(quote)).toEqual({ ok: true, trust: "engine", reasons: [] });
  });

  test("keeps a pool recommendation distinct from a signed quote", async () => {
    const pool = {
      route: "hskswap",
      hskswapOut: "12000000000000000001",
      venue: "hskswap",
      reason: "pool is better",
    };
    const { zethos } = client({ "POST /quote": () => pool });
    const quote = await zethos.quote(request);
    expect(quote).toEqual(pool as QuoteResponse);
    expect(await zethos.verifyQuote(quote)).toEqual({
      ok: false,
      trust: "none",
      reasons: ["not_signed_route"],
    });
  });

  for (const field of ["taker", "tokenIn", "tokenOut", "amountIn"] as const) {
    test(`flags a correctly signed quote for a different ${field}`, async () => {
      const other = field === "amountIn" ? "999999" : "0x6666666666666666666666666666666666666666";
      const body = await paperQuoteBody(signedQuote({ [field]: other }));
      const { zethos } = client({ "POST /quote": () => body });
      const quote = await zethos.quote(request);
      expect((await zethos.verifyQuote(quote)).reasons).toEqual(["binding_mismatch"]);
    });
  }

  test("rejects unknown routes and flags a short signature", async () => {
    const body = await paperQuoteBody();
    const { zethos } = client({ "POST /quote": () => ({ ...body, route: "unexpected" }) });
    await expectCode(zethos.quote(request), "invalid_response");

    const short = client({ "POST /quote": () => ({ ...body, signature: "0x1234" }) }).zethos;
    const quote = await short.quote(request);
    expect((await short.verifyQuote(quote)).reasons).toEqual(["bad_signature_format"]);
  });

  test("flags expired quotes and a mismatched display expiry", async () => {
    const now = Math.floor(Date.now() / 1000);
    const stale = await paperQuoteBody(
      signedQuote({ issuedAt: String(now - 40), expiry: String(now - 10) }),
    );
    const { zethos } = client({ "POST /quote": () => stale });
    expect((await zethos.verifyQuote(await zethos.quote(request))).reasons).toEqual(["expired"]);

    const fresh = await paperQuoteBody();
    const shifted = client({
      "POST /quote": () => ({ ...fresh, expiresAt: fresh.expiresAt + 80 }),
    });
    const quote = await shifted.zethos.quote(request);
    expect((await shifted.zethos.verifyQuote(quote)).reasons).toEqual(["expiry_mismatch"]);
  });

  test("flags quotes outside the maximum validity window", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = await paperQuoteBody(
      signedQuote({ issuedAt: String(now), expiry: String(now + 121) }),
    );
    const { zethos } = client({ "POST /quote": () => body });
    expect((await zethos.verifyQuote(await zethos.quote(request))).reasons).toEqual([
      "ttl_too_long",
    ]);
  });

  for (const [field, value] of [
    ["amountOut", "-1"],
    ["amountOut", "1.5"],
    ["amountOut", "1e18"],
    ["amountOut", 5],
    ["nonce", (1n << 256n).toString()],
    ["issuedAt", (1n << 64n).toString()],
    ["expiry", (1n << 64n).toString()],
  ] as const) {
    test(`rejects invalid ${field}: ${value}`, async () => {
      const body = await paperQuoteBody();
      const { zethos } = client({
        "POST /quote": () => ({ ...body, quote: { ...body.quote, [field]: value } }),
      });
      await expectCode(zethos.quote(request), "invalid_response");
    });
  }

  test("flags an output that differs from the signed amount", async () => {
    const body = await paperQuoteBody();
    const { zethos } = client({
      "POST /quote": () => ({ ...body, paperOut: "2100000000000000000" }),
    });
    expect((await zethos.verifyQuote(await zethos.quote(request))).reasons).toEqual([
      "display_mismatch",
    ]);
  });

  for (const [field, value] of [
    ["poolOut", "1990000000000000001"],
    ["spotOut", "2100000000000000000"],
  ] as const) {
    test(`flags a price worse than ${field}`, async () => {
      const body = await paperQuoteBody();
      const { zethos } = client({ "POST /quote": () => ({ ...body, [field]: value }) });
      expect((await zethos.verifyQuote(await zethos.quote(request))).reasons).toEqual([
        "worse_than_reference",
      ]);
    });
  }

  test("does not request a same-token or zero-amount swap", async () => {
    const { zethos, engine } = client({ "POST /quote": () => ({}) });
    await expectCode(zethos.quote({ ...request, tokenOut: request.tokenIn }), "invalid_request");
    await expectCode(zethos.quote({ ...request, amountIn: "0" }), "invalid_request");
    await expectCode(zethos.quote({ ...request, taker: "0x123" }), "invalid_request");
    expect(engine.calls).toHaveLength(0);
  });
});

describe("quote convenience overload", () => {
  test("sell spends the base token with its decimals (WHSK, 18)", async () => {
    const { zethos, engine } = client({ "POST /quote": async () => paperQuoteBody() });
    await zethos.quote({ taker: TAKER, pair: "HSK/USDT", side: "sell", amount: "1.5" });
    expect(engine.calls.at(-1)?.body).toEqual({
      taker: TAKER,
      tokenIn: WHSK.address,
      tokenOut: USDT.address,
      amountIn: "1500000000000000000",
    });
  });

  test("buy spends the quote token with its decimals (USDT, 6)", async () => {
    const { zethos, engine } = client({ "POST /quote": async () => paperQuoteBody() });
    await zethos.quote({ taker: TAKER, pair: "HSK/USDT", side: "buy", amount: "25.5" });
    expect(engine.calls.at(-1)?.body).toEqual({
      taker: TAKER,
      tokenIn: USDT.address,
      tokenOut: WHSK.address,
      amountIn: "25500000",
    });
  });

  test("remembers the resolved request for verification", async () => {
    const { zethos } = client({ "POST /quote": async () => paperQuoteBody() });
    const quote = await zethos.quote({ taker: TAKER, pair: "HSK/USDT", side: "buy", amount: "1" });
    expect((await zethos.verifyQuote(quote)).ok).toBe(true);
  });

  test("rejects unknown pairs, excess precision and malformed amounts before quoting", async () => {
    const { zethos, engine } = client({ "POST /quote": () => ({}) });
    const intent = { taker: TAKER, pair: "HSK/USDT", side: "buy" } as const;
    await expectCode(zethos.quote({ ...intent, amount: "1.0000001" }), "invalid_request");
    await expectCode(zethos.quote({ ...intent, amount: "-1" }), "invalid_request");
    await expectCode(zethos.quote({ ...intent, amount: "0" }), "invalid_request");
    await expectCode(
      zethos.quote({ ...intent, pair: "BTC/USDT" as "HSK/USDT", amount: "1" }),
      "invalid_request",
    );
    expect(engine.calls.filter((c) => c.path === "/quote")).toHaveLength(0);
  });
});

describe("paperFill", () => {
  test("verifies, then posts the signed quote and returns the fill", async () => {
    const body = await paperQuoteBody();
    const { zethos, engine } = client({
      "POST /quote": () => body,
      "POST /paper/fill": () => fillBody(),
    });
    const fill = await zethos.paperFill(await zethos.quote(request));
    expect(fill.id).toBe("f_01");
    expect(fill.txHash).toBeNull();
    expect(engine.calls.at(-1)?.body).toEqual({ quote: body.quote, signature: body.signature });
  });

  test("refuses an unverified quote without contacting /paper/fill", async () => {
    const body = await paperQuoteBody();
    const tampered = {
      ...body,
      quote: { ...body.quote, amountOut: "2000000000000000000" },
      paperOut: "2000000000000000000",
    };
    const { zethos, engine } = client({
      "POST /quote": () => tampered,
      "POST /paper/fill": () => fillBody(),
    });
    const quote = await zethos.quote(request);
    const error = await zethos.paperFill(quote).catch((e: ZethosError) => e);
    expect(error).toBeInstanceOf(ZethosError);
    expect((error as ZethosError).code).toBe("unverified_quote");
    expect((error as ZethosError).details).toMatchObject({ reasons: ["bad_signer"] });
    expect(engine.calls.some((c) => c.path === "/paper/fill")).toBe(false);
  });

  test("refuses a quote whose request is unknown", async () => {
    const body = await paperQuoteBody();
    const { zethos } = client({});
    await expectCode(zethos.paperFill(body), "unverified_quote");
    expect(await zethos.verifyQuote(body, request)).toMatchObject({ ok: true });
  });

  test("refuses pool routes", async () => {
    const { zethos } = client({});
    const pool = { route: "hskswap", hskswapOut: "1", venue: "hskswap", reason: "" } as const;
    await expectCode(zethos.paperFill(pool, request), "unverified_quote");
  });

  test("refuses outside shadow mode", async () => {
    const body = await paperQuoteBody();
    const { zethos, engine } = client({ "GET /status": () => statusBody({ mode: "live" }) });
    await expectCode(zethos.paperFill(body, request), "wrong_mode");
    expect(engine.calls.some((c) => c.path === "/paper/fill")).toBe(false);
  });

  test("buildFill is live-only", async () => {
    const body = await paperQuoteBody();
    const { zethos } = client({});
    await expectCode(zethos.buildFill(body, { account: TAKER }, request), "wrong_mode");
  });
});

describe("transport and error mapping", () => {
  test("maps an engine rejection to its code and status", async () => {
    const { zethos } = client({
      "POST /quote": () =>
        Response.json({ error: "paused", message: "Vault paused" }, { status: 503 }),
    });
    const error = await zethos.quote(request).catch((e: ZethosError) => e);
    expect(error).toBeInstanceOf(ZethosError);
    expect(error).toMatchObject({ code: "paused", status: 503, message: "Vault paused" });
  });

  test("uses http_<status> when the error body has no code", async () => {
    const { zethos } = client({
      "GET /arena": () => new Response("<html>bad gateway</html>", { status: 502 }),
    });
    await expectCode(zethos.arena(), "http_502", 502);
  });

  test("treats an error body on a 200 as an error", async () => {
    const { zethos } = client({ "GET /arena": () => ({ error: "warming_up" }) });
    await expectCode(zethos.arena(), "warming_up", 200);
  });

  test("rejects malformed JSON", async () => {
    const { zethos } = client({ "POST /quote": () => new Response("not json") });
    await expectCode(zethos.quote(request), "invalid_response");
  });

  test("maps network failures and timeouts", async () => {
    const down = createZethos({
      engineUrl: ENGINE_URL,
      chainId: 133,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expectCode(down.status(), "network");

    const hanging = createZethos({
      engineUrl: ENGINE_URL,
      chainId: 133,
      timeoutMs: 20,
      fetch: ((_: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        })) as unknown as typeof fetch,
    });
    await expectCode(hanging.status(), "timeout");
  });

  test("rejects status from an engine on a different chain", async () => {
    const { zethos } = client({ "GET /status": () => statusBody({ chainId: 177 }) });
    await expectCode(zethos.status(), "invalid_response");
  });

  test("rejects non-finite market data", async () => {
    const { zethos } = client({
      "GET /stats": () => ({ series: [{ t: 100, mid: null }], venues: [] }),
    });
    await expectCode(zethos.stats({ pair: "HSK/USDT", from: 0, to: 100 }), "invalid_response");
  });

  test("sends the attribution header, credentials and query parameters", async () => {
    const { zethos, engine } = client(
      { "GET /fills": () => ({ fills: [fillBody()] }) },
      {
        client: "mcp",
        credentials: "include",
      },
    );
    await zethos.fills({ taker: TAKER, limit: 5 });
    const call = engine.calls[0];
    expect(call?.path).toBe(`/fills?taker=${TAKER}&limit=5`);
    expect(call?.headers.get("X-Zethos-Client")).toBe("mcp");
    expect(call?.init.credentials).toBe("include");

    const plain = client({ "GET /arena/takers": () => ({ takers: [] }) });
    await plain.zethos.arenaTakers();
    expect(plain.engine.calls[0]?.headers.get("X-Zethos-Client")).toBe("sdk");
    expect(plain.engine.calls[0]?.init.credentials).toBeUndefined();
  });

  test("fills accepts both a bare array and {fills}", async () => {
    const bare = client({ "GET /fills": () => [fillBody()] });
    expect(await bare.zethos.fills()).toHaveLength(1);
    const wrapped = client({
      "GET /fills": () => ({ fills: [fillBody(), fillBody({ id: "f_02" })] }),
    });
    expect((await wrapped.zethos.fills()).map((f) => f.id)).toEqual(["f_01", "f_02"]);
  });
});

describe("market", () => {
  test("derives bid, ask and spread from status", async () => {
    const { zethos } = client({});
    const [hsk] = await zethos.market("HSK/USDT");
    expect(hsk?.pair).toBe("HSK/USDT");
    expect(hsk?.bid).toBeCloseTo(0.5 * 0.997);
    expect(hsk?.ask).toBeCloseTo(0.5 * 1.002);
    expect(hsk?.spread).toBeCloseTo(0.005);
    expect(await zethos.market()).toHaveLength(2);
  });
});

describe("quickstart", () => {
  test("market, convenience quote, verify, paperFill", async () => {
    const signFor = async (body: unknown) => ({
      ...(await paperQuoteBody(signedQuote({ ...(body as QuoteRequest), amountOut: "4990000" }))),
      poolOut: "4980000",
      spotOut: "5000000",
    });
    const { zethos, engine } = client({
      "POST /quote": signFor,
      "POST /paper/fill": () => fillBody({ side: "sell" }),
    });
    const [hsk] = await zethos.market("HSK/USDT");
    expect(hsk?.base.symbol).toBe("WHSK");

    const quote = await zethos.quote({
      taker: TAKER,
      pair: "HSK/USDT",
      side: "sell",
      amount: "10",
    });
    expect(engine.calls.at(-1)?.body).toEqual({
      taker: TAKER,
      tokenIn: WHSK.address,
      tokenOut: USDT.address,
      amountIn: "10000000000000000000",
    });
    expect(await zethos.verifyQuote(quote)).toEqual({ ok: true, trust: "engine", reasons: [] });
    expect((await zethos.paperFill(quote)).side).toBe("sell");
  });
});
