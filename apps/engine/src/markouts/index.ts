import type { Fill } from "../db";

export function markoutBps(fill: Pick<Fill, "side" | "price">, mid: number): number {
  return (((fill.side === "sell" ? 1 : -1) * (mid - fill.price)) / fill.price) * 10000;
}

export function baseQuantity(fill: Fill, baseDecimals: number): number {
  return Number(BigInt(fill.side === "buy" ? fill.amountOut : fill.amountIn)) / 10 ** baseDecimals;
}

export function spreadCapture(fill: Fill, quantity: number): number {
  if (fill.midAtFill === null) return 0;
  return (
    (fill.side === "buy" ? fill.price - fill.midAtFill : fill.midAtFill - fill.price) * quantity
  );
}
