import { DurableObject } from "cloudflare:workers";
import { hskMainnet, hskTestnet } from "@zethos/shared";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../api";
import { OperatorAuth } from "../auth";
import { corsOrigins, DEFAULT_GEMINI_MODEL, loadConfig, defaultParams as params } from "../config";
import { memoryStore } from "../db/memory";
import { neonStore } from "../db/neon";
import { Engine, EngineError, type Frame } from "../engine";
import { pollBooks, pollTrades } from "../feeds";
import { checkVault, type LiveVault, vaultReader } from "../live";
import { Assistant } from "../llm";
import { paperSigner } from "../quotes";
import { loadTokens } from "../tokens";

export interface Env extends Record<string, unknown> {
  MARKET: DurableObjectNamespace<Market>;
}

const RETRY_MS = 5_000;

export class Market extends DurableObject<Env> {
  private booting: Promise<Engine> | null = null;
  private lastActivity = 0;
  private operatorAuth: OperatorAuth | null = null;
  private gasPrice: (() => Promise<bigint>) | null = null;
  private lastGasPoll = 0;
  private readonly assistant = new Assistant({
    key: typeof this.env.GEMINI_API_KEY === "string" ? this.env.GEMINI_API_KEY : null,
    model: typeof this.env.GEMINI_MODEL === "string" ? this.env.GEMINI_MODEL : DEFAULT_GEMINI_MODEL,
  });
  private readonly app = createApp({
    engine: () =>
      this.boot().catch((error) => {
        console.error("engine boot failed", error);
        throw new EngineError("warming_up", 503, "The engine is starting up. Try again shortly.");
      }),
    corsOrigins: corsOrigins(this.env.CORS_ORIGIN),
    waitUntil: (promise) => this.ctx.waitUntil(promise),
    assistant: this.assistant,
    auth: async () => {
      await this.boot();
      if (!this.operatorAuth)
        throw new EngineError("unauthorized", 401, "Configure OPERATOR_ADDRESS and SESSION_SECRET");
      return this.operatorAuth;
    },
    adminToken: typeof this.env.ADMIN_TOKEN === "string" ? this.env.ADMIN_TOKEN : null,
  });

  async fetch(request: Request): Promise<Response> {
    this.lastActivity = Date.now();
    await this.wake();
    if (new URL(request.url).pathname === "/stream") return this.openStream(request);
    return this.app.fetch(request);
  }

  async alarm(): Promise<void> {
    const started = Date.now();
    let next = params.feeds.pollMs;
    try {
      const engine = await this.boot();
      // Overlap independent network reads to keep the heartbeat near its 2s cadence.
      const shouldPollGas = this.gasPrice && started - this.lastGasPoll > 30000;
      const gas =
        shouldPollGas && this.gasPrice
          ? this.gasPrice().catch(() => undefined)
          : Promise.resolve(undefined);
      if (shouldPollGas) this.lastGasPoll = started;
      const tape = Promise.allSettled(
        params.pairs.map(async (pair) => ({ pair, trades: await pollTrades(pair, params.feeds) })),
      );
      await Promise.all([
        engine.syncLive(started),
        ...params.pairs.map(async (pair) =>
          engine.ingest(pair, await pollBooks(pair, params.feeds), Date.now()),
        ),
      ]);
      await engine.ensureArena(Date.now());
      for (const result of await tape) {
        if (result.status === "rejected") console.warn("Trade feed unavailable");
        else
          await engine.ingestTrades(
            result.value.pair,
            params.feeds.tapeSource[result.value.pair],
            result.value.trades,
            Date.now(),
          );
      }
      await engine.tick(Date.now(), await gas);
    } catch (error) {
      console.error("heartbeat failed", error);
      next = RETRY_MS;
    }
    const watched = this.ctx.getWebSockets().length > 0;
    if (watched || Date.now() - this.lastActivity < params.heartbeat.idleStopMs) {
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 50, started + next));
    }
  }

  async webSocketMessage(): Promise<void> {}

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    // 1005 and 1006 only describe how a socket closed, and close() refuses to send them.
    socket.close(code === 1005 || code === 1006 ? 1000 : code, "closing");
  }

  private async wake(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
  }

  private boot(): Promise<Engine> {
    this.booting ??= this.start().catch((error) => {
      this.booting = null;
      throw error;
    });
    return this.booting;
  }

  private async start(): Promise<Engine> {
    const config = loadConfig(this.env);
    const chain = config.chainId === 177 ? hskMainnet : hskTestnet;
    const client = createPublicClient({
      chain,
      transport: http(config.rpcUrl, { timeout: 3000, retryCount: 0 }),
    });
    this.gasPrice = () => client.getGasPrice();
    const tokens = await loadTokens(client, config.tokens, config.assumeDecimals);
    const signer = paperSigner(config.paperSignerKey);
    console.info(`Shadow paper signer: ${signer.address}`);
    if (config.operator && config.sessionSecret) {
      this.operatorAuth = new OperatorAuth({
        operator: config.operator,
        secret: config.sessionSecret,
        origins: config.corsOrigins,
        chainId: config.chainId,
        storage: {
          load: async () => (await this.ctx.storage.get("operatorAuth")) ?? null,
          save: async (state) => {
            await this.ctx.storage.put("operatorAuth", state);
          },
        },
      });
    }
    const store = config.databaseUrl ? neonStore(config.databaseUrl) : memoryStore();
    if (!config.databaseUrl) console.warn("DATABASE_URL not set: using in-memory store");
    let live: LiveVault | undefined;
    let liveBlocked: string[] = [];
    if (config.live) {
      const quoteSigner = privateKeyToAccount(config.live.quoteSignerKey);
      const read = vaultReader(client, config.live.vault, tokens, params.pairs);
      const { reasons, snapshot } = await checkVault(
        client,
        read,
        {
          vault: config.live.vault,
          chainId: config.chainId,
          owner: config.live.owner,
          quoteSigner: quoteSigner.address,
          executor: privateKeyToAccount(config.live.executorKey).address,
        },
        Date.now(),
      );
      if (snapshot && reasons.length === 0)
        live = { vault: config.live.vault, signer: quoteSigner, read, initial: snapshot };
      else {
        liveBlocked = reasons;
        console.error(`ENGINE_MODE=live refused, staying in shadow: ${reasons.join("; ")}`);
      }
    }
    const engine = new Engine({
      chainId: config.chainId,
      params,
      tokens,
      store,
      signer,
      operator: config.operator,
      ...(live ? { live } : {}),
      liveBlocked,
      emit: (frame) => this.broadcast(frame),
      onDecision: (decision) => {
        this.ctx.waitUntil(this.assistant.narrate(decision, engine));
      },
    });
    await engine.init();
    return engine;
  }

  private openStream(request: Request): Response {
    const origin = request.headers.get("Origin");
    if (origin && !corsOrigins(this.env.CORS_ORIGIN).includes(origin))
      return Response.json({ error: "unauthorized" }, { status: 403 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json(
        { error: "invalid_request", message: "Expected a WebSocket" },
        { status: 426 },
      );
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(frame: Frame): void {
    const data = JSON.stringify(frame);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(data);
      } catch {
        // A socket that is closing is dropped by the runtime.
      }
    }
  }
}
