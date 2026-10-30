import { createZethos } from "@zethos/sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApp } from "../../engine/src/api";
import { defaultParams } from "../../engine/src/config";
import { memoryStore } from "../../engine/src/db/memory";
import { Engine } from "../../engine/src/engine";
import { parseReplay, Replay } from "../../engine/src/feeds/replay";
import { tokens } from "../../engine/test/helpers";
import { loadConfig } from "../src/config";
import { type EngineClient, TradingService } from "../src/service";
import { Ledger } from "../src/store";

export const TAKER = "0x1111111111111111111111111111111111111111";
export async function replayEngine() {
  let now = Date.now();
  const engine = new Engine({
    chainId: 177,
    params: defaultParams,
    tokens,
    signer: privateKeyToAccount(generatePrivateKey()),
    store: memoryStore(),
    dataSource: "replay",
  });
  await engine.init();
  // Synthetic test fixture, not a real-market backtest or demo performance claim.
  const records = parseReplay(
    await Bun.file(new URL("fixtures/market.ndjson", import.meta.url)).text(),
  );
  await new Replay(records.map((r) => ({ ...r, ts: now }))).advance(engine, now);
  const app = createApp({
    engine: async () => engine,
    corsOrigins: [],
    waitUntil: () => {},
    clock: () => now,
  });
  return {
    engine,
    app,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

export async function fixture(overrides: Record<string, unknown> = {}) {
  const runtime = await replayEngine();
  const config = loadConfig({
    ZETHOS_TAKER_ADDRESS: TAKER,
    MCP_STATE_PATH: ":memory:",
    ...overrides,
  });
  const sdk = createZethos({
    engineUrl: config.engineUrl,
    chainId: 177,
    client: "mcp",
    now: () => Math.floor(runtime.now() / 1000),
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      runtime.app.request(String(input), init)) as typeof fetch,
  });
  const ledger = new Ledger(":memory:", "test");
  const service = (client: EngineClient = sdk) =>
    new TradingService(client, config, ledger, runtime.now);
  return { ...runtime, config, sdk, ledger, service };
}
