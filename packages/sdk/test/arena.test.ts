import { describe, expect, test } from "bun:test";
import { createZethos, type QuoteResponse } from "../src/index.js";
import {
  ENGINE_URL,
  fillBody,
  mockEngine,
  paperQuoteBody,
  request,
  statusBody,
  TAKER,
} from "./fixtures.js";

const liveStatus = () =>
  statusBody({
    mode: "live",
    signer: TAKER,
    paperSigner: statusBody().signer,
    verifyingContract: "0x3333333333333333333333333333333333333333",
  });

async function setup(current = liveStatus()) {
  const body = await paperQuoteBody();
  const engine = mockEngine({
    "GET /status": () => current,
    "POST /arena/quote": () => body,
    "POST /paper/fill": () => fillBody(),
  });
  const zethos = createZethos({
    engineUrl: ENGINE_URL,
    chainId: 133,
    client: "sniper/naive",
    fetch: engine.fetch,
  });
  return { body, engine, zethos };
}

describe("Arena SDK", () => {
  for (const mode of ["live", "shadow"] as const) {
    test(`verifies and fills a paper quote in ${mode} mode`, async () => {
      const { zethos, engine, body } = await setup({ ...liveStatus(), mode });
      const quote = await zethos.arenaQuote(request);
      expect(quote.route).toBe("paper");
      expect(await zethos.verifyQuote(quote)).toEqual({ ok: true, trust: "engine", reasons: [] });
      expect(await zethos.arenaFill(quote)).toMatchObject({ paper: true, txHash: null });
      expect(engine.calls.at(-1)?.body).toEqual({ quote: body.quote, signature: body.signature });
      expect(engine.calls.every((c) => c.headers.get("X-Zethos-Client") === "sniper/naive")).toBe(
        true,
      );
    });
  }

  test("refuses tampering before contacting settlement", async () => {
    const { zethos, engine } = await setup();
    const quote = await zethos.arenaQuote(request);
    quote.quote.amountOut = "2000000000000000000";
    quote.paperOut = quote.quote.amountOut;
    await expect(zethos.arenaFill(quote)).rejects.toMatchObject({
      code: "unverified_quote",
      details: { reasons: ["bad_signer"] },
    });
    expect(engine.calls.some((c) => c.path === "/paper/fill")).toBe(false);
  });

  test("never falls back to the vault signer when paperSigner is missing", async () => {
    const { zethos, engine } = await setup({
      ...liveStatus(),
      signer: statusBody().signer,
      paperSigner: undefined,
    });
    await expect(zethos.arenaFill(await zethos.arenaQuote(request))).rejects.toMatchObject({
      code: "unverified_quote",
      details: { reasons: ["bad_signer"] },
    });
    expect(engine.calls.some((c) => c.path === "/paper/fill")).toBe(false);
  });

  test("refuses the wrong paper signer and an unknown request", async () => {
    const { zethos, engine, body } = await setup({ ...liveStatus(), paperSigner: TAKER });
    await expect(zethos.arenaFill(await zethos.arenaQuote(request))).rejects.toMatchObject({
      code: "unverified_quote",
    });
    await expect(zethos.arenaFill(body)).rejects.toMatchObject({ code: "unverified_quote" });
    expect(engine.calls.some((c) => c.path === "/paper/fill")).toBe(false);
  });

  test("rejects non-paper routes at both Arena boundaries", async () => {
    const { zethos, engine, body } = await setup();
    await expect(
      zethos.arenaFill({ ...body, route: "conduit" } as unknown as QuoteResponse, request),
    ).rejects.toMatchObject({ code: "unverified_quote" });
    const other = mockEngine({ "POST /arena/quote": () => ({ ...body, route: "conduit" }) });
    const client = createZethos({ engineUrl: ENGINE_URL, chainId: 133, fetch: other.fetch });
    await expect(client.arenaQuote(request)).rejects.toMatchObject({ code: "invalid_response" });
    expect(engine.calls).toHaveLength(0);
  });
});
