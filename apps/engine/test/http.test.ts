import { describe, expect, test } from "bun:test";
import { createApp } from "../src/api";
import { EngineError } from "../src/engine";
import { readyEngine, TAKER, tokens, usdt } from "./helpers";

const json = async (response: Response): Promise<Record<string, unknown>> => {
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
};

async function app() {
  const { engine } = await readyEngine({ now: Date.now() });
  return createApp({
    engine: async () => engine,
    corsOrigins: ["http://localhost:3000"],
    waitUntil: () => {},
  });
}

describe("http", () => {
  test("health and status", async () => {
    const server = await app();
    expect(await json(await server.request("/health"))).toEqual({ status: "ok" });
    const status = await json(await server.request("/status"));
    expect(status.mode).toBe("shadow");
    const mandate = await json(await server.request("/mandate"));
    expect(mandate.pairs).toContain("HSK/USDT");
    expect(mandate.canary).toBeDefined();
  });

  test("diagnosis exposes attributed paper losses and validates filters", async () => {
    const server = await app();
    const response = await server.request("/diagnosis?pair=HSK%2FUSDT&window=1h");
    expect(response.status).toBe(200);
    const diagnosis = await json(response);
    expect(diagnosis.totalLossUsd).toBe(0);
    expect(diagnosis.window).toBeDefined();
    const invalid = await server.request("/diagnosis?window=30d");
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).error).toBe("invalid_request");
  });

  test("quote then fill over HTTP with CORS", async () => {
    const server = await app();
    const quoteResponse = await server.request("/quote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        "X-Zethos-Client": "web",
      },
      body: JSON.stringify({
        taker: TAKER,
        tokenIn: tokens.USDT.address,
        tokenOut: tokens.WHSK.address,
        amountIn: usdt(100),
      }),
    });
    expect(quoteResponse.status).toBe(200);
    expect(quoteResponse.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    const quote = await json(quoteResponse);
    const fill = await server.request("/paper/fill", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Zethos-Client": "web" },
      body: JSON.stringify({ quote: quote.quote, signature: quote.signature }),
    });
    expect(fill.status).toBe(200);
    const fills = await json(await server.request(`/fills?taker=${TAKER}`));
    expect(fills.fills).toHaveLength(1);
  });

  test("errors use the wire shape", async () => {
    const server = await app();
    const bad = await server.request("/quote", { method: "POST", body: "not json" });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toBe("invalid_request");
    const missing = await server.request("/nope");
    expect(await json(missing)).toEqual({ error: "not_found" });
  });

  test("warming up while the engine boots", async () => {
    const server = createApp({
      engine: async () => {
        throw new EngineError("warming_up", 503);
      },
      corsOrigins: [],
      waitUntil: () => {},
    });
    const response = await server.request("/status");
    expect(response.status).toBe(503);
    expect((await json(response)).error).toBe("warming_up");
  });
});
