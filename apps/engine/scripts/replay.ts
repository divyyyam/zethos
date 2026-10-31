import fs from "node:fs/promises";
import path from "node:path";
import { hskMainnet, hskTestnet } from "@zethos/shared";
import { createPublicClient, http } from "viem";
import { createApp } from "../src/api";
import { defaultParams, loadConfig } from "../src/config";
import { memoryStore } from "../src/db/memory";
import { Engine, type Frame } from "../src/engine";
import { Replay } from "../src/feeds/replay";
import { loadReplaySource, ReplayPlayer } from "../src/feeds/replay-scenario";
import { paperSigner } from "../src/quotes";
import { loadTokens } from "../src/tokens";

// Stage fallback: a local paper engine driven by a recorded development scenario.
//   FEEDS_REPLAY=scenarios/<name>.json bun scripts/replay.ts   (manifest, recommended)
//   FEEDS_REPLAY=scenarios/<name>.ndjson bun scripts/replay.ts (payload; manifest still checked)
//   REPLAY_LOOP=1 replays the recording continuously instead of ending.
// Every HTTP response carries X-Zethos-Data: paper-replay; /status reports dataSource "replay".

const target = process.env.FEEDS_REPLAY;
if (!target)
  throw new Error(
    "Set FEEDS_REPLAY to a scenario manifest or NDJSON recording. This server is labelled paper replay.",
  );
const loop = process.env.REPLAY_LOOP === "1" || process.env.REPLAY_LOOP === "true";

const source = await loadReplaySource(target, {
  exists: async (file) =>
    fs.stat(file).then(
      () => true,
      () => false,
    ),
  read: (file) => fs.readFile(file, "utf8"),
});
const label = source.scenario ?? path.basename(source.payloadPath);

const config = loadConfig({
  CHAIN_ID: "177",
  HSK_RPC_URL: "https://mainnet.hsk.xyz",
  CORS_ORIGIN: "http://localhost:3000",
  ...process.env,
});
// Token decimals still come from the chain. This needs RPC access even when exchange feeds
// are down; set ASSUME_DECIMALS only if the owner has verified them.
const tokens = await loadTokens(
  createPublicClient({
    chain: config.chainId === 177 ? hskMainnet : hskTestnet,
    transport: http(config.rpcUrl, { timeout: 2000, retryCount: 0 }),
  }),
  config.tokens,
  config.assumeDecimals,
);

const start = Date.now();
const player = new ReplayPlayer(source.records, start, loop);
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
await new Replay(player.take(start)).advance(engine, start);

const app = createApp({
  engine: async () => engine,
  corsOrigins: config.corsOrigins,
  waitUntil: () => {},
});

const replayInfo = () => ({
  dataSource: "paper-replay",
  scenario: label,
  payload: path.basename(source.payloadPath),
  loop,
  passes: player.passes,
  finished: player.finished,
  durationMs: source.durationMs,
  marketRecords: source.records.length,
  skippedTakerRequests: source.skippedTakerRequests,
});

const label_ = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set("X-Zethos-Data", "paper-replay");
  headers.set("X-Zethos-Replay-Source", label);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  fetch: async (request, socketServer) => {
    const url = new URL(request.url);
    if (url.pathname === "/stream") {
      const origin = request.headers.get("Origin");
      if (origin && !config.corsOrigins.includes(origin))
        return label_(Response.json({ error: "unauthorized" }, { status: 403 }));
      if (socketServer.upgrade(request)) return;
      return label_(
        Response.json(
          { error: "invalid_request", message: "Expected a WebSocket" },
          { status: 426 },
        ),
      );
    }
    if (url.pathname === "/replay" && request.method === "GET")
      return label_(Response.json(replayInfo()));
    try {
      return label_(await app.fetch(request));
    } catch (error) {
      console.error(error);
      return label_(
        Response.json({ error: "internal", message: "Replay engine error" }, { status: 500 }),
      );
    }
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
let announcedEnd = false;
const timer = setInterval(async () => {
  if (advancing) return;
  advancing = true;
  try {
    const now = Date.now();
    await new Replay(player.take(now)).advance(engine, now);
    if (player.finished && !announcedEnd) {
      announcedEnd = true;
      console.warn(
        "[REPLAY] Recording finished. Feeds will now go stale and the engine will degrade; no live or sample fallback.",
      );
    }
  } catch (error) {
    console.error(error);
  } finally {
    advancing = false;
  }
}, 100);

console.log(
  `Paper REPLAY engine on ${server.url} · scenario '${label}' · ${source.records.length} market records over ${Math.round(
    source.durationMs / 1000,
  )}s · ${source.skippedTakerRequests} taker requests skipped · ${loop ? "looping" : "finite, no live-feed fallback"}`,
);
process.on("SIGINT", async () => {
  clearInterval(timer);
  await server.stop(true);
  process.exit(0);
});
