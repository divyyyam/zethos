import { createZethos, type Pair, type PaperQuote, ZethosError } from "@zethos/sdk";
import { bytesToHex, formatUnits, getAddress } from "viem";
import { z } from "zod";

const flags = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg?.startsWith("--") && arg !== "--") flags.set(arg.slice(2), process.argv[++i] ?? "");
}
const options = z
  .object({
    mode: z.enum(["naive", "sniper", "latecomer", "rotating"]),
    pair: z.enum(["HSK/USDT", "ETH/USDT"]),
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    edge: z.coerce.number().nonnegative(),
    rotate: z.coerce.number().int().positive(),
    chain: z.coerce.number().pipe(z.union([z.literal(177), z.literal(133)])),
  })
  .parse({
    mode: flags.get("mode") ?? "sniper",
    pair: flags.get("pair") ?? "ETH/USDT",
    amount: flags.get("amount") ?? "100",
    edge: flags.get("edge-bps") ?? 1,
    rotate: flags.get("rotate") ?? 3,
    chain: process.env.ZETHOS_CHAIN_ID ?? "177",
  });
const sdk = createZethos({
  engineUrl: process.env.ZETHOS_ENGINE_URL ?? "http://localhost:8787",
  chainId: options.chain,
  client: `sniper/${options.mode}`,
});
if ((await sdk.status()).mode !== "shadow")
  throw new Error("The sniper operates only against paper settlement");
const identity = () => getAddress(bytesToHex(crypto.getRandomValues(new Uint8Array(20))));
let taker = identity();
const feedState: { fast: { mid: number; at: number } | null } = { fast: null };
let stopped = false;
let socket: WebSocket;
let attempt = 0;
const connect = () => {
  const hsk = options.pair === "HSK/USDT";
  socket = new WebSocket(
    hsk ? "wss://api.gateio.ws/ws/v4/" : "wss://data-stream.binance.vision/ws/ethusdt@bookTicker",
  );
  socket.onopen = () => {
    attempt = 0;
    if (hsk)
      socket.send(
        JSON.stringify({
          time: Math.floor(Date.now() / 1000),
          channel: "spot.book_ticker",
          event: "subscribe",
          payload: ["HSK_USDT"],
        }),
      );
  };
  socket.onmessage = (event) => {
    try {
      const json: unknown = JSON.parse(String(event.data));
      const wrapper = z.object({ result: z.unknown().optional() }).passthrough().parse(json);
      const book = z
        .object({ b: z.coerce.number().positive(), a: z.coerce.number().positive() })
        .parse(hsk ? wrapper.result : json);
      if (book.a >= book.b) feedState.fast = { mid: (book.a + book.b) / 2, at: Date.now() };
    } catch {
      /* Subscription acknowledgements and non-book messages carry no price. */
    }
  };
  socket.onclose = () => {
    feedState.fast = null;
    if (!stopped) setTimeout(connect, Math.min(30000, 500 * 2 ** attempt++));
  };
};
connect();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
process.on("SIGINT", () => {
  stopped = true;
  socket.close();
});
let fills = 0;
let pnl = 0;
console.log(
  `Paper ${options.mode} · ${options.pair} · ${taker}. Public SDK only; no wallet or private key.`,
);
while (!stopped) {
  try {
    if (!feedState.fast || Date.now() - feedState.fast.at > 5000) {
      await sleep(500);
      continue;
    }
    const response = await sdk.quote({
      taker,
      pair: options.pair as Pair,
      side: "buy",
      amount: options.amount,
    });
    if (response.route !== "paper") {
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
