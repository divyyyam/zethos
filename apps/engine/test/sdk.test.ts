import { describe, expect, test } from "bun:test";
import { createZethos } from "@zethos/sdk";
import { createApp } from "../src/api";
import { readyEngine, TAKER } from "./helpers";

// The SDK and the engine must agree on the wire contract: run the real SDK against the real app.
async function connect(client = "sdk") {
  const { engine } = await readyEngine({ now: Date.now() });
  const app = createApp({ engine: async () => engine, corsOrigins: [], waitUntil: () => {} });
  const fetcher = ((input: string | URL | Request, init?: RequestInit) =>
    app.request(String(input), init)) as typeof fetch;
  return createZethos({ engineUrl: "http://engine.test", chainId: 177, client, fetch: fetcher });
}

describe("sdk ↔ engine contract", () => {
  test("status and market parse", async () => {
    const zethos = await connect();
    const status = await zethos.status();
    expect(status.mode).toBe("shadow");
    const markets = await zethos.market("HSK/USDT");
    expect(markets[0]?.mid).toBeCloseTo(0.1, 6);
  });

  test("quote → verify → paper fill → fills", async () => {
    const zethos = await connect("mcp");
    const quote = await zethos.quote({
      taker: TAKER,
      pair: "HSK/USDT",
      side: "buy",
      amount: "250",
    });
    expect(quote.route).toBe("paper");
    const verification = await zethos.verifyQuote(quote);
    expect(verification.reasons).toEqual([]);
    expect(verification).toMatchObject({ ok: true, trust: "engine" });
    const fill = await zethos.paperFill(quote);
    expect(fill.flow).toBe("agent");
    const fills = await zethos.fills({ taker: TAKER });
    expect(fills.map((item) => item.id)).toEqual([fill.id]);
  });

  test("selling base resolves decimals from status", async () => {
    const zethos = await connect();
    const quote = await zethos.quote({
      taker: TAKER,
      pair: "HSK/USDT",
      side: "sell",
      amount: "1000",
    });
    if (quote.route !== "paper") throw new Error("expected a paper quote");
    expect(quote.quote.amountIn).toBe((1000n * 10n ** 18n).toString());
    expect((await zethos.verifyQuote(quote)).ok).toBe(true);
  });

  test("engine errors surface as SDK error codes", async () => {
    const zethos = await connect();
    await expect(
      zethos.quote({ taker: TAKER, pair: "HSK/USDT", side: "buy", amount: "1" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  test("stats parse", async () => {
    const zethos = await connect();
    const stats = await zethos.stats({ pair: "HSK/USDT" });
    expect(stats.series.length).toBeGreaterThan(0);
  });
});
