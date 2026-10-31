import {
  createZethos,
  type Pair,
  type PairStatus,
  type PaperQuote,
  type QuoteResponse,
  ZethosError,
} from "@zethos/sdk";
import { bytesToHex, formatUnits, getAddress } from "viem";
import { z } from "zod";
import { DEFAULT_PAIR_VENUES, MarketFeedCollector } from "./feeds.js";
import {
  BinanceWsLeadFeed,
  DEFAULT_LEAD_LAG_CONFIG,
  HELD_OUT_DESCRIPTION,
  HELD_OUT_SOURCE,
  LEAD_VENUE,
  type LeadFeed,
  RestLeadFeed,
  runLeadLag,
  summarize,
} from "./lead-lag.js";
import { type ParsedSniperOptions, parseSniperOptions, resolveAmountIn } from "./options.js";
import { ScenarioRecorder } from "./recorder.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const randomIdentity = () => getAddress(bytesToHex(crypto.getRandomValues(new Uint8Array(20))));
type ZethosClient = ReturnType<typeof createZethos>;

/** Connects to a fast exchange WebSocket ticker for paper sniper attacker modes. */
class FastTickerFeed {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  fast: { mid: number; at: number } | null = null;

  constructor(private readonly pair: Pair) {}

  start(): void {
    const hsk = this.pair === "HSK/USDT";
    const url = hsk
      ? "wss://api.gateio.ws/ws/v4/"
      : "wss://data-stream.binance.vision/ws/ethusdt@bookTicker";
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      if (hsk) {
        socket.send(
          JSON.stringify({
            time: Math.floor(Date.now() / 1000),
            channel: "spot.book_ticker",
            event: "subscribe",
            payload: ["HSK_USDT"],
          }),
        );
      }
    };

    socket.onmessage = (event) => {
      try {
        const json: unknown = JSON.parse(String(event.data));
        const wrapper = z.object({ result: z.unknown().optional() }).passthrough().parse(json);
        const book = z
          .object({ b: z.coerce.number().positive(), a: z.coerce.number().positive() })
          .parse(hsk ? wrapper.result : json);
        if (book.a >= book.b) {
          this.fast = { mid: (book.a + book.b) / 2, at: Date.now() };
        }
      } catch {
        /* Subscription acknowledgements and non-book messages carry no price. */
      }
    };

    socket.onclose = () => {
      this.fast = null;
      if (!this.stopped) {
        setTimeout(() => this.start(), Math.min(30000, 500 * 2 ** this.attempt++));
      }
    };
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
  }
}

async function runCaptureOnly(
  options: ParsedSniperOptions,
  shouldStop: () => boolean,
  shutdown: () => Promise<void>,
): Promise<void> {
  console.log(
    `Capture-only quiet tape · ${options.pair}. Direct public exchange feeds only; no quotes requested or fills submitted.`,
  );
  if (options.record) {
    console.log(
      `[RECORDER ACTIVE] Recording quiet tape into '${options.record}' (heldOut: ${options.heldOut})`,
    );
  }

  while (!shouldStop()) {
    await sleep(500);
  }

  await shutdown();
}

async function runHeldOutLeadLag(
  options: ParsedSniperOptions,
  sdk: ZethosClient,
  recorder: ScenarioRecorder | null,
  shouldStop: () => boolean,
  shutdown: () => Promise<void>,
): Promise<void> {
  const leadVenue = LEAD_VENUE[options.pair];
  const lead: LeadFeed =
    leadVenue === "binance"
      ? new BinanceWsLeadFeed({ pair: options.pair, recorder })
      : new RestLeadFeed({
          pair: options.pair,
          venue: leadVenue,
          intervalMs: options.leadPollMs,
          recorder,
        });

  lead.start();
  console.log(
    `Paper held-out run · ${options.pair}. Public SDK only; no wallet or private key. Recording '${options.record}' (heldOut: true).`,
  );

  const stats = await runLeadLag({
    pair: options.pair,
    usdAmount: options.amount,
    taker: () => getAddress(bytesToHex(crypto.getRandomValues(new Uint8Array(20)))),
    config: {
      ...DEFAULT_LEAD_LAG_CONFIG,
      thresholdBps: options.thresholdBps,
      minEdgeBps: options.edge,
      maxQuotesPerMinute: options.maxQuotesPerMinute,
    },
    sdk,
    lead,
    recorder,
    shouldStop,
    maxFills: options.maxFills,
    log: (line) => console.log(line),
  });

  lead.stop();
  console.log(`[SUMMARY] ${summarize(stats)}`);
  console.log(JSON.stringify({ paper: true, summary: stats }));
  await shutdown();
}

interface AttackerIterationState {
  taker: `0x${string}`;
  fills: number;
  pnl: number;
}

async function requestAttackerQuote(
  sdk: ZethosClient,
  options: ParsedSniperOptions,
  pairStatus: PairStatus,
  taker: `0x${string}`,
  recorder: ScenarioRecorder | null,
): Promise<QuoteResponse | null> {
  // Convert human amount to base units using runtime token decimals (never hardcode 6 or 18)
  const soldToken = pairStatus.quote; // buy side: taker pays quote token (USDT)
  const amountIn = resolveAmountIn(options.amount, soldToken.decimals, soldToken.symbol);
  const requestTs = Date.now();

  let response: QuoteResponse | null = null;
  let quoteError: unknown = null;

  try {
    response = await sdk.quote({
      taker,
      pair: options.pair as Pair,
      side: "buy",
      amount: options.amount,
    });
  } catch (err: unknown) {
    quoteError = err;
  }

  // Record the taker request observation even if rejected by engine
  if (recorder) {
    const paperQuote = response?.route === "paper" ? response : null;
    recorder.recordTakerRequest({
      type: "taker_request",
      ts: requestTs,
      pair: options.pair,
      side: "buy",
      amountIn,
      taker,
      ...(paperQuote?.id ? { id: paperQuote.id } : {}),
      ...(paperQuote?.breakdown?.tier ? { tier: paperQuote.breakdown.tier } : {}),
    });
  }

  if (quoteError) {
    throw quoteError;
  }

  return response;
}

async function evaluateAttackerFill(
  quote: PaperQuote,
  sdk: ZethosClient,
  options: ParsedSniperOptions,
  ticker: FastTickerFeed,
  state: AttackerIterationState,
  isStopped: () => boolean,
): Promise<boolean> {
  const market = (await sdk.market(options.pair))[0];
  if (!market) throw new Error("Market is not enabled");

  const out = Number(formatUnits(BigInt(quote.quote.amountOut), market.base.decimals));
  const input = Number(formatUnits(BigInt(quote.quote.amountIn), market.quote.decimals));
  const price = input / out;

  while (!isStopped() && Date.now() < Number(quote.quote.expiry) * 1000) {
    if (ticker.fast && Date.now() - ticker.fast.at <= 5000) {
      const edge = (ticker.fast.mid / price - 1) * 10000;
      const late = Date.now() >= (Number(quote.quote.expiry) - 1) * 1000;
      const acceptable =
        options.mode === "naive" ||
        (edge >= options.edge && (options.mode !== "latecomer" || late));

      if (acceptable) {
        const verified = await sdk.verifyQuote(quote, undefined, { minRemainingSec: 0 });
        if (!verified.ok) break;

        const fill = await sdk.paperFill(quote);
        state.fills++;
        state.pnl += (ticker.fast.mid - fill.price) * out;

        console.log(
          JSON.stringify({
            paper: true,
            taker: state.taker,
            fills: state.fills,
            estimatedPnlAtFastMidUsd: state.pnl,
            fillId: fill.id,
            edgeBps: edge,
          }),
        );

        if (options.mode === "rotating" && state.fills % options.rotate === 0) {
          state.taker = randomIdentity();
          console.log(`New probation identity: ${state.taker}`);
        }
        return true;
      }
    }
    await sleep(100);
  }

  return false;
}

async function runAttackerMode(
  options: ParsedSniperOptions,
  sdk: ZethosClient,
  pairStatus: PairStatus,
  recorder: ScenarioRecorder | null,
  shouldStop: () => boolean,
  isStopped: () => boolean,
  shutdown: () => Promise<void>,
): Promise<void> {
  const ticker = new FastTickerFeed(options.pair);
  ticker.start();

  const state: AttackerIterationState = {
    taker: randomIdentity(),
    fills: 0,
    pnl: 0,
  };

  console.log(
    `Paper ${options.mode} · ${options.pair} · ${state.taker}. Public SDK only; no wallet or private key.`,
  );
  if (options.record) {
    console.log(
      `[RECORDER ACTIVE] Recording scenario '${options.record}' (mode: ${options.mode}, heldOut: ${options.heldOut})`,
    );
  }

  try {
    while (!shouldStop()) {
      try {
        if (options.maxFills && state.fills >= options.maxFills) {
          break;
        }

        if (!ticker.fast || Date.now() - ticker.fast.at > 5000) {
          await sleep(500);
          continue;
        }

        const response = await requestAttackerQuote(
          sdk,
          options,
          pairStatus,
          state.taker,
          recorder,
        );
        if (response?.route !== "paper") {
          await sleep(1000);
          continue;
        }

        const filled = await evaluateAttackerFill(response, sdk, options, ticker, state, isStopped);

        // At most 30 requests/minute under steady fills, below the engine default of 60.
        if (filled) await sleep(2000);
        else await sleep(500);
      } catch (error) {
        console.error(
          error instanceof ZethosError
            ? `${error.code}: ${error.message}`
            : "Sniper request failed",
        );
        // Never retry a fill; only ask for a fresh quote after the backoff.
        await sleep(error instanceof ZethosError && error.code === "rate_limited" ? 60000 : 2000);
      }
    }
  } finally {
    ticker.stop();
  }

  await shutdown();
}

async function setupRecorderAndFeeds(options: ParsedSniperOptions): Promise<{
  recorder: ScenarioRecorder;
  feedCollector: MarketFeedCollector;
}> {
  const leadLag = options.mode === "lead-lag";
  const leadVenue = LEAD_VENUE[options.pair];
  const source = options.captureOnly ? "tape" : leadLag ? HELD_OUT_SOURCE : options.mode;

  const name = options.record;
  if (!name) throw new Error("Recording requires --record <name>");
  const recorder = new ScenarioRecorder({
    name,
    pair: options.pair,
    source,
    heldOut: options.heldOut,
    description: leadLag
      ? HELD_OUT_DESCRIPTION
      : (options.description ??
        `Direct public exchange observations and sniper tape for ${options.pair} (${
          options.heldOut ? "held-out" : "dev"
        })`),
    scenariosDir: options.scenariosDir,
  });
  await recorder.start();

  const feedCollector = new MarketFeedCollector({
    pair: options.pair,
    venues: leadLag
      ? (options.venues ?? DEFAULT_PAIR_VENUES[options.pair]).filter((v) => v !== leadVenue)
      : options.venues,
    pollIntervalMs: options.pollIntervalMs,
    recorder,
  });
  await feedCollector.start();

  return { recorder, feedCollector };
}

function createShutdownHandler(
  recorder: ScenarioRecorder | null,
  feedCollector: MarketFeedCollector | null,
): { isStopped: () => boolean; shutdown: () => Promise<void> } {
  let stopped = false;
  let stopping = false;

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    stopped = true;

    if (feedCollector) {
      feedCollector.stop();
    }

    if (recorder) {
      try {
        const summary = await recorder.stop();
        console.log(
          `\n[RECORDER] Scenario '${summary.name}' saved successfully: ${summary.counts.total} records ` +
            `(${summary.counts.books} books, ${summary.counts.trades} trades, ${summary.counts.takerRequests} taker requests).`,
        );
      } catch (err: unknown) {
        console.error(`\n[RECORDER ERROR] Failed to save scenario: ${(err as Error).message}`);
        process.exit(1);
      }
    }

    process.exit(0);
  };

  return {
    isStopped: () => stopped,
    shutdown,
  };
}

function createStopCondition(
  options: ParsedSniperOptions,
  recorder: ScenarioRecorder | null,
  isStopped: () => boolean,
): () => boolean {
  const startTime = Date.now();
  return (): boolean => {
    if (isStopped()) return true;
    if (options.durationSec && Date.now() - startTime >= options.durationSec * 1000) {
      return true;
    }
    if (recorder && options.maxRecords && recorder.counts.total >= options.maxRecords) {
      return true;
    }
    return false;
  };
}

async function main(): Promise<void> {
  const options = parseSniperOptions(process.argv.slice(2));

  const sdk = createZethos({
    engineUrl: process.env.ZETHOS_ENGINE_URL ?? "http://localhost:8787",
    chainId: options.chain,
    client: `sniper/${options.mode}`,
  });

  const initialStatus = await sdk.status();
  if (initialStatus.mode !== "shadow") {
    throw new Error("The sniper operates only against paper settlement");
  }

  const pairStatus = initialStatus.pairs.find((p) => p.pair === options.pair);
  if (!pairStatus) {
    throw new Error(`Market for ${options.pair} is not enabled`);
  }

  let recorder: ScenarioRecorder | null = null;
  let feedCollector: MarketFeedCollector | null = null;

  if (options.record) {
    const active = await setupRecorderAndFeeds(options);
    recorder = active.recorder;
    feedCollector = active.feedCollector;
  }

  const { isStopped, shutdown } = createShutdownHandler(recorder, feedCollector);

  process.on("SIGINT", () => {
    shutdown().catch(() => process.exit(1));
  });
  process.on("SIGTERM", () => {
    shutdown().catch(() => process.exit(1));
  });

  const shouldStop = createStopCondition(options, recorder, isStopped);

  if (options.captureOnly) {
    await runCaptureOnly(options, shouldStop, shutdown);
    return;
  }

  if (options.mode === "lead-lag") {
    await runHeldOutLeadLag(options, sdk, recorder, shouldStop, shutdown);
    return;
  }

  await runAttackerMode(options, sdk, pairStatus, recorder, shouldStop, isStopped, shutdown);
}

await main();
