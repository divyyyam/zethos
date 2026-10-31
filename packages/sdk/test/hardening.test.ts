import { describe, expect, test } from "bun:test";
import { zeroAddress } from "viem";
import {
  createZethos,
  MAX_CLOCK_SKEW_SEC,
  type QuoteIntent,
  type QuoteResponse,
  resolveQuoteIntent,
  schemas,
  type VerifyOptions,
  verifyQuote,
  ZethosError,
} from "../src/index.js";
import {
  ENGINE_URL,
  mockEngine,
  nowSec,
  paperQuoteBody,
  request,
  signedQuote,
  signer,
  statusBody,
  TAKER,
  USDT,
  VAULT,
  vaultQuoteBody,
  WHSK,
} from "./fixtures.js";

const paperOptions: VerifyOptions = {
  chainId: 133,
  status: { signer: signer.address, verifyingContract: zeroAddress },
};

const intent = { taker: TAKER, pair: "HSK/USDT", side: "buy", amount: "5" } as const;

const badIntents: [string, Record<string, unknown>][] = [
  ["unknown side", { side: "invalid" }],
  ["wrong-case side", { side: "SELL" }],
  ["missing side", { side: undefined }],
  ["null side", { side: null }],
  ["unknown pair", { pair: "DOGE/USDT" }],
  ["numeric amount", { amount: 5 }],
  ["negative amount", { amount: "-1" }],
  ["exponent amount", { amount: "1e3" }],
  ["empty amount", { amount: "" }],
  ["zero amount", { amount: "0" }],
  ["too many decimals", { amount: "1.0000001" }],
  ["malformed taker", { taker: "0x123" }],
  ["missing taker", { taker: undefined }],
];

describe("S-01: convenience quote input", () => {
  for (const [name, change] of badIntents) {
    test(`${name} is rejected before any quote is requested`, async () => {
      const input = { ...intent, ...change } as unknown as QuoteIntent;
      const engine = mockEngine({
        "GET /status": () => statusBody(),
        "POST /quote": () => paperQuoteBody(),
      });
      const zethos = createZethos({ engineUrl: ENGINE_URL, chainId: 133, fetch: engine.fetch });

      const error = await zethos.quote(input).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ZethosError);
      expect((error as ZethosError).code).toBe("invalid_request");
      expect(engine.calls.filter((call) => call.path === "/quote")).toEqual([]);
    });
  }

  test("resolveQuoteIntent refuses an unknown side rather than treating it as a buy", () => {
    const status = schemas.status.parse(statusBody());
    const input = { ...intent, side: "invalid" } as unknown as QuoteIntent;
    expect(() => resolveQuoteIntent(input, status)).toThrow(ZethosError);
  });

  test("valid sides still choose the sold token", () => {
    const status = schemas.status.parse(statusBody());
    expect(resolveQuoteIntent(intent, status)).toEqual({
      taker: TAKER,
      tokenIn: USDT.address,
      tokenOut: WHSK.address,
      amountIn: "5000000",
    } as typeof request);
    expect(resolveQuoteIntent({ ...intent, side: "sell" }, status).tokenIn).toBe(
      WHSK.address as `0x${string}`,
    );
  });

  test("a pair absent from status is still refused", () => {
    const status = schemas.status.parse(statusBody({ pairs: [] }));
    expect(() => resolveQuoteIntent(intent, status)).toThrow("Unknown pair HSK/USDT");
  });

  for (const input of [null, undefined, 5, "quote"]) {
    test(`quote(${String(input)}) rejects with invalid_request`, async () => {
      const zethos = createZethos({
        engineUrl: ENGINE_URL,
        chainId: 133,
        fetch: mockEngine({}).fetch,
      });
      const error = await zethos.quote(input as unknown as QuoteIntent).catch((e: unknown) => e);
      expect((error as ZethosError).code).toBe("invalid_request");
    });
  }
});

describe("S-02: issuance anchored to the current time", () => {
  const issuedIn = (offset: number, now: number) =>
    signedQuote({ issuedAt: String(now + offset), expiry: String(now + offset + 30) });

  test("a genuinely signed quote issued an hour ahead is rejected", async () => {
    const body = await paperQuoteBody(issuedIn(3600, nowSec()));
    expect(await verifyQuote(body, request, paperOptions)).toEqual({
      ok: false,
      trust: "engine",
      reasons: ["issued_in_future"],
    });
  });

  test("the live route applies the same check", async () => {
    const body = await vaultQuoteBody(issuedIn(3600, nowSec()));
    const options = { chainId: 133, status: { signer: signer.address, verifyingContract: VAULT } };
    expect((await verifyQuote(body, request, options)).reasons).toContain("issued_in_future");
  });

  test("clock skew is allowed up to the limit and no further", async () => {
    const now = nowSec();
    const options = { ...paperOptions, now };
    const atLimit = await paperQuoteBody(issuedIn(MAX_CLOCK_SKEW_SEC, now));
    expect((await verifyQuote(atLimit, request, options)).reasons).toEqual([]);
    const past = await paperQuoteBody(issuedIn(MAX_CLOCK_SKEW_SEC + 1, now));
    expect((await verifyQuote(past, request, options)).reasons).toEqual(["issued_in_future"]);
  });

  test("the client's replay clock anchors the check", async () => {
    const replayNow = nowSec() + 3600;
    const body = await paperQuoteBody(issuedIn(0, replayNow));
    const engine = mockEngine({ "GET /status": () => statusBody() });
    const replay = createZethos({
      engineUrl: ENGINE_URL,
      chainId: 133,
      fetch: engine.fetch,
      now: () => replayNow,
    });
    expect((await replay.verifyQuote(body, request)).reasons).toEqual([]);
  });
});

describe("S-03: unparsed input and options", () => {
  for (const input of [null, undefined, 0, "paper", [], {}, { route: 1 }, { route: "hskswap" }]) {
    test(`verifyQuote(${JSON.stringify(input)}) returns a reason`, async () => {
      expect(await verifyQuote(input, request, paperOptions)).toEqual({
        ok: false,
        trust: "none",
        reasons: ["not_signed_route"],
      });
    });
  }

  test("a signed route with nothing else fails without throwing", async () => {
    expect(await verifyQuote({ route: "paper" }, request, paperOptions)).toEqual({
      ok: false,
      trust: "engine",
      reasons: ["out_of_bounds"],
    });
  });

  test("wrong-shaped fields around a valid signed quote produce named reasons", async () => {
    const body = await paperQuoteBody();
    for (const expiresAt of ["soon", null, undefined, {}]) {
      const result = await verifyQuote({ ...body, expiresAt }, request, paperOptions);
      expect(result.reasons).toEqual(["expiry_mismatch"]);
    }
    const noOut = await verifyQuote({ ...body, paperOut: undefined }, request, paperOptions);
    expect(noOut.reasons).toEqual(["display_mismatch"]);
    const noSpot = await verifyQuote({ ...body, spotOut: null }, request, paperOptions);
    expect(noSpot.reasons).toEqual(["worse_than_reference"]);
    const noPool = await verifyQuote({ ...body, poolOut: 5 }, request, paperOptions);
    expect(noPool.reasons).toEqual(["worse_than_reference"]);
  });

  test("a wrong-shaped request is a binding mismatch", async () => {
    const body = await paperQuoteBody();
    for (const junk of [null, 5, "request", {}]) {
      const result = await verifyQuote(body, junk as unknown as typeof request, paperOptions);
      expect(result.reasons).toEqual(["binding_mismatch"]);
    }
  });

  const badOptions: [string, Partial<Record<keyof VerifyOptions, unknown>>][] = [
    ["NaN now", { now: Number.NaN }],
    ["infinite now", { now: Number.POSITIVE_INFINITY }],
    ["negative now", { now: -1 }],
    ["string now", { now: "1800000000" }],
    ["NaN minRemainingSec", { minRemainingSec: Number.NaN }],
    ["negative minRemainingSec", { minRemainingSec: -5 }],
    ["NaN maxSpreadVsMid", { maxSpreadVsMid: Number.NaN }],
    ["negative maxSpreadVsMid", { maxSpreadVsMid: -0.1 }],
    ["maxSpreadVsMid of one", { maxSpreadVsMid: 1 }],
    ["maxSpreadVsMid above one", { maxSpreadVsMid: 2 }],
    ["fractional chainId", { chainId: 1.5 }],
    ["missing status", { status: undefined }],
  ];

  for (const [name, change] of badOptions) {
    test(`${name} fails closed`, async () => {
      const options = { ...paperOptions, ...change } as VerifyOptions;
      expect(await verifyQuote(await paperQuoteBody(), request, options)).toEqual({
        ok: false,
        trust: "none",
        reasons: ["invalid_options"],
      });
    });
  }

  test("missing options fail closed", async () => {
    const result = await verifyQuote(
      await paperQuoteBody(),
      request,
      undefined as unknown as VerifyOptions,
    );
    expect(result.reasons).toEqual(["invalid_options"]);
  });

  test("the client turns an unusable quote into unverified_quote, not a TypeError", async () => {
    const engine = mockEngine({ "GET /status": () => statusBody() });
    const zethos = createZethos({ engineUrl: ENGINE_URL, chainId: 133, fetch: engine.fetch });
    const error = await zethos
      .paperFill(null as unknown as QuoteResponse, request)
      .catch((e: unknown) => e);
    expect((error as ZethosError).code).toBe("unverified_quote");
    expect(engine.calls.filter((call) => call.path === "/paper/fill")).toEqual([]);
  });
});
