import type { PairStatus, QuoteRequest, Side } from "@zethos/sdk";
import { parseUnits } from "viem";
import { ToolError } from "./errors.js";

export const usdUnits = (value: string) => parseUnits(value, 6);
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;

// Convert the decimal representation of a price to a rational. Token amounts never
// pass through Number; round the notional up so rounding cannot bypass a limit.
function priceRatio(value: number): [bigint, bigint] {
  const [mantissa = "", exp = "0"] = value.toString().toLowerCase().split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exp);
  const n = BigInt(whole + fraction);
  return scale >= 0 ? [n, 10n ** BigInt(scale)] : [n * 10n ** BigInt(-scale), 1n];
}

/** USDT is modelled as $1 for the paper spend budget. This is not an FX oracle. */
export function notional(
  request: QuoteRequest,
  side: Side,
  market: PairStatus,
  now: number,
): bigint {
  if (side === "buy")
    return ceil(BigInt(request.amountIn) * 1000000n, 10n ** BigInt(market.quote.decimals));
  if (
    market.mid === null ||
    market.mid <= 0 ||
    !Number.isFinite(market.mid) ||
    market.health === "down" ||
    market.updatedAt === null ||
    now - market.updatedAt > 10000 ||
    market.updatedAt > now + 1000
  )
    throw new ToolError(
      "stale_market",
      "A fresh reference price is required to value a base-token sale.",
    );
  const [n, d] = priceRatio(market.mid);
  return ceil(BigInt(request.amountIn) * n * 1000000n, d * 10n ** BigInt(market.base.decimals));
}

export function perSwap(value: bigint, maximum: string): void {
  if (value > usdUnits(maximum))
    throw new ToolError(
      "spend_limit",
      `This swap exceeds the configured $${maximum} notional limit.`,
    );
}
