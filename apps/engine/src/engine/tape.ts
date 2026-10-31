import { getAddress, keccak256, toBytes } from "viem";
import type { Pair } from "../config";
import type { Trade } from "../feeds/types";
import { toUnits, units } from "../tokens";
import { EngineError } from "./errors";
import { pairTokens } from "./market";
import { issueQuote } from "./quoting";
import type { EngineState } from "./state";
import { getTaker } from "./toxicity";
import type { Issued } from "./types";

// Replay exchange trades through the same quote and settlement paths.
export function ingestTrades(
  context: EngineState,
  pair: Pair,
  venue: string,
  trades: Trade[],
  now: number,
): Promise<void> {
  return context.exclusive(async () => {
    const { params } = context.deps;
    if (venue !== params.feeds.tapeSource[pair]) return;
    for (const trade of [...trades].sort((a, b) => a.ts - b.ts)) {
      const key = `${pair}:${venue}:${trade.id}`;
      if (context.seenTrades.has(key)) continue;
      context.seenTrades.set(key, now);
      if (
        Math.abs(now - trade.ts) > params.feeds.staleMs ||
        (context.deps.random ?? Math.random)() >= params.arena.tapeCaptureRate
      )
        continue;
      context.state.tape.attempts += 1;
      const taker = getAddress(
        `0x${keccak256(toBytes(`tape:${venue}:${context.state.tape.attempts % 50}`)).slice(-40)}`,
      );
      const { base, quote } = pairTokens(context, pair);
      const notional = Math.min(
        trade.price * trade.size * params.arena.tapeSizeScale,
        params.arena.tapeMaxNotionalUsd,
      );
      try {
        const result = await issueQuote(
          context,
          {
            taker,
            tokenIn: trade.side === "buy" ? quote.address : base.address,
            tokenOut: trade.side === "buy" ? base.address : quote.address,
            amountIn: toUnits(
              trade.side === "buy" ? notional : notional / trade.price,
              trade.side === "buy" ? quote.decimals : base.decimals,
            ).toString(),
          },
          "tape",
          now,
        );
        const signed = result.response.quote;
        const price =
          trade.side === "buy"
            ? units(BigInt(signed.amountIn), quote.decimals) /
              units(BigInt(signed.amountOut), base.decimals)
            : units(BigInt(signed.amountOut), quote.decimals) /
              units(BigInt(signed.amountIn), base.decimals);
        if (trade.side === "buy" ? price > trade.price : price < trade.price) {
          context.state.tape.lost += 1;
          continue;
        }
        const [min, max] = params.arena.tapeLatencyMs;
        const due = now + min + (context.deps.random ?? Math.random)() * (max - min);
        context.pendingTape.push({ due, quote: signed, signature: result.response.signature });
      } catch (error) {
        if (!(error instanceof EngineError)) throw error;
        context.state.tape.lost += 1;
      }
    }
    for (const [key, at] of context.seenTrades)
      if (now - at > 300000) context.seenTrades.delete(key);
  });
}

export function observeOutcome(
  context: EngineState,
  issued: Issued,
  filled: boolean,
  mid: number | null,
): void {
  if (mid === null) return;
  if (context.state.outcomes.includes(issued.id)) return;
  const favorable = (issued.side === "buy" ? 1 : -1) * (mid - issued.mid) > 0;
  const taker = getTaker(context, getAddress(issued.quote.taker), issued.record.ts);
  const bucket = favorable ? taker.favorable : taker.unfavorable;
  const decay = 0.5 ** (1 / context.deps.params.toxicity.halfLifeFills);
  for (const value of [taker.favorable, taker.unfavorable]) {
    value.quotes *= decay;
    value.fills *= decay;
  }
  bucket.quotes += 1;
  if (filled) bucket.fills += 1;
  context.state.outcomes.push(issued.id);
}
