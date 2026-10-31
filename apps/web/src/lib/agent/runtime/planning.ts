// Compile a validated intent into the same bounded plan and exact integer slices.
import type { PairStatus } from "@zethos/sdk";
import { formatUnits, parseUnits } from "viem";
import type { SwapIntent } from "../intent";
import {
  DEFAULT_HOLD_MS,
  DEFAULT_MAX_COST_BPS,
  DEFAULT_TRIGGER_MS,
  MIN_SLICE_USD,
} from "./constants";
import { decimalString } from "./helpers";
import type { Plan } from "./types";

/** Sizes a swap intent against live market data. Returns a refusal string if it can't be run. */
export function compilePlan(intent: SwapIntent, pair: PairStatus): Plan | string {
  const { base, quote, mid, halfSpread } = pair;
  if (mid === null || pair.halted)
    return `${pair.pair} isn’t priced right now, so I can’t size it.`;
  const buy = intent.side === "buy";
  const [sold, bought] = buy ? [quote, base] : [base, quote];
  const ask = mid * (1 + (halfSpread?.buy ?? 0));
  const bid = mid * (1 - (halfSpread?.sell ?? 0));
  const sizedInSold = buy ? intent.amountIn === "quote" : intent.amountIn === "base";
  const stated = Number(intent.amount);
  const human = sizedInSold
    ? intent.amount
    : decimalString(buy ? stated * ask : stated / bid, sold.decimals);
  let total: bigint;
  try {
    total = parseUnits(human, sold.decimals);
  } catch {
    return `That ${sold.symbol} amount has too many decimal places.`;
  }
  if (total <= 0n) return "That amount rounds to nothing.";
  const amount = Number(formatUnits(total, sold.decimals));
  const estOut = buy ? amount / ask : amount * bid;
  const estUsd = buy ? amount : amount * mid;
  const notes: string[] = [];
  let count = intent.slices?.count ?? 1;
  if (count > 1 && estUsd / count < MIN_SLICE_USD) {
    const fitted = Math.floor(estUsd / MIN_SLICE_USD);
    if (fitted < 2) return `$${estUsd.toFixed(2)} is too small to slice. Run it as one swap.`;
    notes.push(`Reduced to ${fitted} slices so each one clears the $5 minimum.`);
    count = fitted;
  }
  if (estUsd < 5) return `Minimum swap is $5. This is about $${estUsd.toFixed(2)}.`;
  const each = total / BigInt(count);
  const sliceAmounts = Array.from({ length: count }, (_, index) =>
    (index === count - 1 ? total - each * BigInt(count - 1) : each).toString(),
  );
  if (!sizedInSold)
    notes.push(`You sized the ${bought.symbol} side, so ${sold.symbol} in is a live conversion.`);
  return {
    pair: pair.pair,
    side: intent.side,
    soldSymbol: sold.symbol,
    boughtSymbol: bought.symbol,
    soldDecimals: sold.decimals,
    boughtDecimals: bought.decimals,
    tokenIn: sold.address,
    tokenOut: bought.address,
    amountIn: total.toString(),
    approximate: !sizedInSold,
    sliceAmounts,
    intervalMs: count > 1 ? (intent.slices?.durationMs ?? 0) / (count - 1) : 0,
    estOut,
    estUsd,
    maxCostBps: intent.maxCostBps ?? DEFAULT_MAX_COST_BPS,
    holdMs: intent.expiresInMs ?? DEFAULT_HOLD_MS,
    trigger: intent.trigger,
    triggerMs: intent.expiresInMs ?? DEFAULT_TRIGGER_MS,
    notes,
  };
}
