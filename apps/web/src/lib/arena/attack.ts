import type { Pair, PaperQuote, Zethos } from "@zethos/sdk";
import { type Address, formatUnits } from "viem";

export type AttackMode = "naive" | "sniper" | "rotating";
export type Attempt = {
  index: number;
  address: Address;
  price: number | null;
  edge: number | null;
  outcome: "quoted" | "filled" | "declined" | "refused";
  reason: string;
};
type Engine = Pick<Zethos, "status" | "arenaQuote" | "arenaFill">;
export function localIdentity(): Address {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export function shouldFill(
  mode: AttackMode,
  side: "buy" | "sell",
  price: number,
  quotedMid: number,
  currentMid: number | null,
) {
  if (mode !== "sniper") return true;
  if (currentMid === null) return false;
  return side === "buy"
    ? currentMid > quotedMid && currentMid > price
    : currentMid < quotedMid && currentMid < price;
}
export function rotateIdentity(mode: AttackMode, fills: number) {
  return mode === "rotating" && fills > 0 && fills % 3 === 0;
}
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });

/** Paper requests only; the engine's SDK verifies locally before every Arena fill. */
export async function runAttack(options: {
  engine: Engine;
  pair: Pair;
  mode: AttackMode;
  signal: AbortSignal;
  onAttempt: (attempt: Attempt) => void;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  identity?: () => Address;
}) {
  const { engine, pair, mode, signal, onAttempt } = options;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? sleep;
  const identity = options.identity ?? localIdentity;
  const deadline = now() + 60_000;
  let address = identity();
  let fills = 0;
  let nextQuote = now();
  for (let index = 1; index <= 30 && now() < deadline && !signal.aborted; index++) {
    if (now() < nextQuote) await wait(Math.min(nextQuote, deadline) - now(), signal);
    if (signal.aborted || now() >= deadline) break;
    nextQuote = now() + 2_000;
    const attempt: Attempt = {
      index,
      address,
      price: null,
      edge: null,
      outcome: "refused",
      reason: "",
    };
    let quote: PaperQuote | undefined;
    try {
      const current = await engine.status();
      if (signal.aborted) break;
      const market = current.pairs.find((p) => p.pair === pair);
      if (!market || market.mid === null || market.mid <= 0 || market.halted)
        throw new Error("Pair has no tradable live mid.");
      const side = index % 2 ? "buy" : "sell";
      quote = await engine.arenaQuote({
        taker: address,
        pair,
        side,
        amount:
          side === "buy" ? "25" : (25 / market.mid).toFixed(Math.min(market.base.decimals, 6)),
      });
      const input = Number(
        formatUnits(
          BigInt(quote.quote.amountIn),
          side === "buy" ? market.quote.decimals : market.base.decimals,
        ),
      );
      const output = Number(
        formatUnits(
          BigInt(quote.quote.amountOut),
          side === "buy" ? market.base.decimals : market.quote.decimals,
        ),
      );
      const price = side === "buy" ? input / output : output / input;
      attempt.price = price;
      attempt.outcome = "quoted";
      attempt.reason = "Paper quote received";
      onAttempt({ ...attempt });
      let mid = quote.breakdown.mid;
      const edge = () => (side === "buy" ? mid / price - 1 : price / mid - 1);
      const expiry = Math.min(Number(quote.quote.expiry) * 1000 - 250, deadline);
      while (
        mode === "sniper" &&
        !signal.aborted &&
        now() < expiry &&
        !shouldFill(mode, side, price, quote.breakdown.mid, mid)
      ) {
        await wait(Math.min(500, expiry - now()), signal);
        if (signal.aborted || now() >= expiry) break;
        const latest = (await engine.status()).pairs.find((p) => p.pair === pair);
        mid = latest?.mid && !latest.halted ? latest.mid : 0;
      }
      attempt.edge = mid > 0 ? edge() : null;
      if (
        signal.aborted ||
        now() >= expiry ||
        !shouldFill(mode, side, price, quote.breakdown.mid, mid || null)
      ) {
        attempt.outcome = "declined";
        attempt.reason = signal.aborted
          ? "Stopped before filling"
          : "No favourable market edge before expiry";
      } else {
        await engine.arenaFill(quote);
        attempt.outcome = "filled";
        attempt.reason = "Paper fill; no tokens moved";
        fills++;
        if (rotateIdentity(mode, fills)) address = identity();
      }
    } catch (error) {
      attempt.outcome = "refused";
      attempt.reason = error instanceof Error ? error.message : "Request failed";
    }
    onAttempt({ ...attempt });
  }
  if (!signal.aborted && now() < deadline) await wait(deadline - now(), signal);
}
