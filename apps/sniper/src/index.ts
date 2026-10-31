import {
  createZethos,
  type Pair,
  type PaperQuote,
  type QuoteResponse,
  ZethosError,
} from "@zethos/sdk";
import { bytesToHex, formatUnits, getAddress } from "viem";
import { z } from "zod";
import { MarketFeedCollector } from "./feeds.js";
import { parseSniperOptions, resolveAmountIn } from "./options.js";
import { ScenarioRecorder } from "./recorder.js";

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
  const source = options.captureOnly ? "tape" : options.mode;
  recorder = new ScenarioRecorder({
    name: options.record,
    pair: options.pair,
    source,
    heldOut: options.heldOut,
    description:
      options.description ??
      `Direct public exchange observations and sniper tape for ${options.pair} (${
        options.heldOut ? "held-out" : "dev"
      })`,
    scenariosDir: options.scenariosDir,
  });
  await recorder.start();

  feedCollector = new MarketFeedCollector({
    pair: options.pair,
    venues: options.venues,
    pollIntervalMs: options.pollIntervalMs,
    recorder,
  });
  await feedCollector.start();
}

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

process.on("SIGINT", () => {
  shutdown().catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  shutdown().catch(() => process.exit(1));
});

const startTime = Date.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldStop = (): boolean => {
  if (stopped) return true;
  if (options.durationSec && Date.now() - startTime >= options.durationSec * 1000) {
    return true;
  }
  if (recorder && options.maxRecords && recorder.counts.total >= options.maxRecords) {
    return true;
  }
  return false;
};

// ==========================================
// CAPTURE-ONLY MODE
// ==========================================
if (options.captureOnly) {
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
  process.exit(0);
}

// ==========================================
// ATTACKER MODES (naive, sniper, latecomer, rotating)
// ==========================================
const identity = () => getAddress(bytesToHex(crypto.getRandomValues(new Uint8Array(20))));
let taker = identity();
const feedState: { fast: { mid: number; at: number } | null } = { fast: null };

let socket: WebSocket;
let attempt = 0;

const connect = () => {
  const hsk = options.pair === "HSK/USDT";
  socket = new WebSocket(
    hsk ? "wss://api.gateio.ws/ws/v4/" : "wss://data-stream.binance.vision/ws/ethusdt@bookTicker",
  );
  socket.onopen = () => {
    attempt = 0;
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
        feedState.fast = { mid: (book.a + book.b) / 2, at: Date.now() };
      }
    } catch {
      /* Subscription acknowledgements and non-book messages carry no price. */
    }
  };
  socket.onclose = () => {
    feedState.fast = null;
    if (!stopped) {
      setTimeout(connect, Math.min(30000, 500 * 2 ** attempt++));
    }
  };
};

connect();

let fills = 0;
let pnl = 0;

console.log(
  `Paper ${options.mode} · ${options.pair} · ${taker}. Public SDK only; no wallet or private key.`,
);
if (options.record) {
  console.log(
    `[RECORDER ACTIVE] Recording scenario '${options.record}' (mode: ${options.mode}, heldOut: ${options.heldOut})`,
  );
}

while (!shouldStop()) {
  try {
    if (options.maxFills && fills >= options.maxFills) {
      break;
    }

    if (!feedState.fast || Date.now() - feedState.fast.at > 5000) {
      await sleep(500);
      continue;
    }

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

    if (response?.route !== "paper") {
      await sleep(1000);
      continue;
    }

    const quote: PaperQuote = response;
    const market = (await sdk.market(options.pair))[0];
    if (!market) throw new Error("Market is not enabled");

    const out = Number(formatUnits(BigInt(quote.quote.amountOut), market.base.decimals));
    const input = Number(formatUnits(BigInt(quote.quote.amountIn), market.quote.decimals));
    const price = input / out;
    let filled = false;

    while (!stopped && Date.now() < Number(quote.quote.expiry) * 1000) {
      if (feedState.fast && Date.now() - feedState.fast.at <= 5000) {
        const edge = (feedState.fast.mid / price - 1) * 10000;
        const late = Date.now() >= (Number(quote.quote.expiry) - 1) * 1000;
        const acceptable =
          options.mode === "naive" ||
          (edge >= options.edge && (options.mode !== "latecomer" || late));

        if (acceptable) {
          const verified = await sdk.verifyQuote(quote, undefined, { minRemainingSec: 0 });
          if (!verified.ok) break;

          const fill = await sdk.paperFill(quote);
          fills++;
          pnl += (feedState.fast.mid - fill.price) * out;
          filled = true;

          console.log(
            JSON.stringify({
              paper: true,
              taker,
              fills,
              estimatedPnlAtFastMidUsd: pnl,
              fillId: fill.id,
              edgeBps: edge,
            }),
          );

          if (options.mode === "rotating" && fills % options.rotate === 0) {
            taker = identity();
            console.log(`New probation identity: ${taker}`);
          }
          break;
        }
      }
      await sleep(100);
    }

    // At most 30 requests/minute under steady fills, below the engine default of 60.
    if (filled) await sleep(2000);
    else await sleep(500);
  } catch (error) {
    console.error(
      error instanceof ZethosError ? `${error.code}: ${error.message}` : "Sniper request failed",
    );
    // Never retry a fill; only ask for a fresh quote after the backoff.
    await sleep(error instanceof ZethosError && error.code === "rate_limited" ? 60000 : 2000);
  }
}

await shutdown();
