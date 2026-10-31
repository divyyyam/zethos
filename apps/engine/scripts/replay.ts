import { hskMainnet, hskTestnet } from "@zethos/shared";
import { createPublicClient, http } from "viem";
import { createApp } from "../src/api";
import { defaultParams, loadConfig } from "../src/config";
import { memoryStore } from "../src/db/memory";
import { Engine, type Frame } from "../src/engine";
import { parseReplay, Replay } from "../src/feeds/replay";
import { paperSigner } from "../src/quotes";
import { loadTokens } from "../src/tokens";

const path = process.env.FEEDS_REPLAY;
if (!path)
  throw new Error("Set FEEDS_REPLAY to an NDJSON recording. This server is labelled paper replay.");
const config = loadConfig({
  CHAIN_ID: "177",
  HSK_RPC_URL: "https://mainnet.hsk.xyz",
  CORS_ORIGIN: "http://localhost:3000",
  ...process.env,
});
const tokens = await loadTokens(
  createPublicClient({
    chain: config.chainId === 177 ? hskMainnet : hskTestnet,
    transport: http(config.rpcUrl, { timeout: 2000, retryCount: 0 }),
  }),
  config.tokens,
  config.assumeDecimals,
);
const source = parseReplay(await Bun.file(path).text());
const start = Date.now();
const first = source[0]?.ts ?? 0;
// Shift the recording onto wall time so SDK expiry verification remains meaningful.
const replay = new Replay(
  source.map((r) => ({
    ...r,
    ts: start + r.ts - first,
    ...(r.type === "trade" ? { trade: { ...r.trade, ts: start + r.trade.ts - first } } : {}),
  })),
);
let publish: ((frame: Frame) => void) | null = null;
const engine = new Engine({
  chainId: config.chainId,
  params: defaultParams,
  tokens,
  signer: paperSigner(config.paperSignerKey),
  store: memoryStore(),
  dataSource: "replay",
  emit: (frame) => publish?.(frame),
});
await engine.init();
await replay.advance(engine, start);
const app = createApp({
  engine: async () => engine,
  corsOrigins: config.corsOrigins,
  waitUntil: () => {},
});
const server = Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  fetch: async (request, socketServer) => {
    if (new URL(request.url).pathname === "/stream") {
      const origin = request.headers.get("Origin");
      if (origin && !config.corsOrigins.includes(origin))
        return Response.json({ error: "unauthorized" }, { status: 403 });
      if (socketServer.upgrade(request)) return;
      return Response.json(
        { error: "invalid_request", message: "Expected a WebSocket" },
        { status: 426 },
      );
    }
    const response = await app.fetch(request);
    response.headers.set("X-Zethos-Data", "paper-replay");
    return response;
  },
  websocket: {
    open: (socket) => {
      socket.subscribe("market");
    },
    message() {},
  },
});
publish = (frame) => {
  server.publish("market", JSON.stringify(frame));
};
let advancing = false;
const timer = setInterval(async () => {
  if (advancing) return;
  advancing = true;
  try {
    await replay.advance(engine, Date.now());
  } catch (error) {
    console.error(error);
  } finally {
    advancing = false;
  }
}, 100);
console.log(`Paper REPLAY engine on ${server.url}; finite recording, no live-feed fallback`);
process.on("SIGINT", async () => {
  clearInterval(timer);
  await server.stop(true);
  process.exit(0);
});
