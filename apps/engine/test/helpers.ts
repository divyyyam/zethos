import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defaultParams, type Pair, type Params } from "../src/config";
import type { Store } from "../src/db";
import { memoryStore } from "../src/db/memory";
import { Engine, type Frame, type LiveQuote, type PaperQuote } from "../src/engine";
import type { Book } from "../src/feeds/types";
import type { LiveVault } from "../src/live";
import type { Tokens } from "../src/tokens";

export const SIGNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const TAKER: Address = "0x1111111111111111111111111111111111111111";

export const tokens: Tokens = {
  USDT: { symbol: "USDT", address: "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029", decimals: 6 },
  WHSK: { symbol: "WHSK", address: "0xB210D2120d57b758EE163cFfb43e73728c471Cf1", decimals: 18 },
  WETH: { symbol: "WETH", address: "0xefd4bC9afD210517803f293ABABd701CaeeCdfd0", decimals: 18 },
};

export function paperOf(response: PaperQuote | LiveQuote): PaperQuote {
  if (response.route !== "paper") throw new Error("expected a paper quote");
  return response;
}

// A symmetric book around `mid`: 10 levels each side, 1 bp apart, `size` base units per level.
export function bookAround(mid: number, size = 100_000): Book {
  const levels = Array.from({ length: 10 }, (_, index) => index + 1);
  return {
    bids: levels.map((step) => [mid * (1 - step * 0.0001), size] as const),
    asks: levels.map((step) => [mid * (1 + step * 0.0001), size] as const),
  };
}

export const MIDS: Record<Pair, number> = { "HSK/USDT": 0.1, "ETH/USDT": 3000 };

export async function readyEngine(
  options: {
    params?: Params;
    store?: Store;
    now?: number;
    live?: LiveVault;
    liveBlocked?: string[];
    mandate?: unknown;
  } = {},
): Promise<{ engine: Engine; frames: Frame[]; store: Store; now: number }> {
  const params = options.params ?? defaultParams;
  const store = options.store ?? memoryStore();
  const now = options.now ?? 1_800_000_000_000;
  const frames: Frame[] = [];
  const engine = new Engine({
    chainId: 177,
    params,
    tokens,
    store,
    signer: privateKeyToAccount(SIGNER_KEY),
    ...(options.live ? { live: options.live } : {}),
    ...(options.mandate ? { mandate: options.mandate } : {}),
    ...(options.liveBlocked ? { liveBlocked: options.liveBlocked } : {}),
    emit: (frame) => frames.push(frame),
  });
  await engine.init();
  for (const pair of params.pairs) {
    const sizes = pair === "ETH/USDT" ? 50 : 1_000_000;
    engine.ingest(
      pair,
      params.feeds.sources[pair].map((venue) => ({
        venue,
        book: bookAround(MIDS[pair], sizes),
        error: null,
      })),
      now,
    );
  }
  await engine.ensureArena(now);
  return { engine, frames, store, now };
}

export const usdt = (amount: number) => BigInt(Math.round(amount * 1e6)).toString();
export const whsk = (amount: number) => (BigInt(Math.round(amount * 1e6)) * 10n ** 12n).toString();
