import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { createHttpHandler } from "../src/http";
import { inputs } from "../src/service";
import { fixture, replayEngine, TAKER } from "./helpers";

const storedId = (result: unknown) =>
  z.object({ structuredContent: z.object({ quoteId: z.string() }) }).parse(result).structuredContent
    .quoteId;

test("stdio client drives real replay engine: discovery, prompt, quote, verification, paper fill, refusal and restart", async () => {
  const runtime = await replayEngine();
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => runtime.app.fetch(r) });
  const path = mkdtempSync(join(tmpdir(), "zethos-mcp-protocol-"));
  expect(path.startsWith(join(tmpdir(), "zethos-mcp-protocol-"))).toBe(true);
  const clients: Client[] = [];
  const connect = async () => {
    const client = new Client({ name: "zethos-test", version: "1.0.0" });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["src/index.ts"],
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        stderr: "pipe",
        env: {
          ZETHOS_ENGINE_URL: engine.url.origin,
          ZETHOS_CHAIN_ID: "177",
          ZETHOS_TAKER_ADDRESS: TAKER,
          ZETHOS_MAX_NOTIONAL_USD: "100",
          ZETHOS_DAILY_NOTIONAL_USD: "300",
          MCP_STATE_PATH: join(path, "state.db"),
        },
      }),
    );
    return client;
  };
  try {
    const client = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(Object.keys(inputs).sort());
    expect(tools.tools.find((t) => t.name === "execute_swap")?.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
    });
    expect((await client.listResources()).resources).toHaveLength(3);
    const methodology = await client.readResource({ uri: "zethos://methodology" });
    expect(methodology.contents[0]).toHaveProperty("text", expect.stringContaining("PAPER"));
    const prompt = await client.getPrompt({
      name: "best-price-swap",
      arguments: { pair: "HSK/USDT", side: "buy", amount: "100" },
    });
    expect(prompt.messages[0]?.content).toHaveProperty(
      "text",
      expect.stringContaining("explicit approval"),
    );
    const market = await client.callTool({ name: "get_market", arguments: {} });
    expect(market.structuredContent).toMatchObject({ paper: true, dataSource: "replay" });
    const quote = await client.callTool({
      name: "get_quote",
      arguments: { pair: "HSK/USDT", side: "buy", amount: "100" },
    });
    expect(quote.isError).toBeUndefined();
    const quoteId = storedId(quote);
    expect(typeof quoteId).toBe("string");
    expect(
      (await client.callTool({ name: "verify_quote", arguments: { quoteId } })).structuredContent,
    ).toMatchObject({ ok: true });
    const missingConsent = await client.callTool({ name: "execute_swap", arguments: { quoteId } });
    expect(missingConsent.isError).toBe(true);
    const fill = await client.callTool({
      name: "execute_swap",
      arguments: { quoteId, confirm: true },
    });
    expect(fill.structuredContent).toMatchObject({ paper: true, fill: { flow: "agent" } });
    expect(runtime.engine.arenaView().fills).toBe(1);
    expect(
      (await client.callTool({ name: "get_my_fills", arguments: {} })).structuredContent,
    ).toMatchObject({ fills: [{ flow: "agent", paper: true, markout5sBps: null }] });
    expect(
      (
        await client.callTool({
          name: "get_quote",
          arguments: { pair: "HSK/USDT", side: "buy", amount: "101" },
        })
      ).structuredContent,
    ).toMatchObject({ error: "spend_limit" });
    const expiring = await client.callTool({
      name: "get_quote",
      arguments: { pair: "HSK/USDT", side: "buy", amount: "100" },
    });
    runtime.advance(31000);
    const expired = await client.callTool({
      name: "execute_swap",
      arguments: { quoteId: storedId(expiring), confirm: true },
    });
    expect(expired.isError).toBe(true);
    expect(expired.structuredContent).toMatchObject({ error: "quote_expired" });
    await client.close();
    const restarted = await connect();
    const duplicate = await restarted.callTool({
      name: "execute_swap",
      arguments: { quoteId, confirm: true },
    });
    expect(duplicate.structuredContent).toEqual(fill.structuredContent);
    expect(runtime.engine.arenaView().fills).toBe(1);
  } finally {
    for (const client of clients) await client.close();
    await engine.stop(true);
    rmSync(path, { recursive: true, force: true });
  }
}, 20000);

test("Streamable HTTP uses shared quote/budget state and rejects untrusted origins, hosts and missing tokens", async () => {
  const f = await fixture();
  const config = {
    ...f.config,
    authToken: "test-token-123456789012345678901234567890",
    allowedOrigins: ["https://agent.test"],
  };
  const handler = createHttpHandler(f.service(), config);
  const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  const client = new Client({ name: "http-test", version: "1.0.0" });
  try {
    const url = new URL("mcp", http.url);
    const headers = { Authorization: `Bearer ${config.authToken}` };
    expect((await fetch(url)).status).toBe(401);
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: "https://agent.test",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("https://agent.test");
    expect(
      (await fetch(url, { headers: { ...headers, Origin: "https://evil.test" } })).status,
    ).toBe(403);
    expect(
      (await handler(new Request(url.toString(), { headers: { ...headers, Host: "evil.test" } })))
        .status,
    ).toBe(403);
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
    expect((await client.listTools()).tools).toHaveLength(10);
    const quote = await client.callTool({
      name: "get_quote",
      arguments: { pair: "HSK/USDT", side: "buy", amount: "100" },
    });
    expect(quote.isError).toBeUndefined();
    const args = { quoteId: storedId(quote), confirm: true };
    const result = await client.callTool({ name: "execute_swap", arguments: args });
    expect(result.structuredContent).toMatchObject({ paper: true, fill: { flow: "agent" } });
    expect(
      (await client.callTool({ name: "execute_swap", arguments: args })).structuredContent,
    ).toEqual(result.structuredContent);
    expect(f.engine.arenaView().fills).toBe(1);
  } finally {
    await client.close();
    await http.stop(true);
    f.ledger.close();
  }
  expect(() => createHttpHandler(f.service(), { ...f.config, host: "0.0.0.0" })).toThrow(
    "MCP_AUTH_TOKEN",
  );
});
