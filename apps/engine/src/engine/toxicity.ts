import { type Address, getAddress } from "viem";
import type { TierName } from "../config";
import type { Fill, QuoteRecord } from "../db";
import { newTaker, nextTier, observeFill, scoreTaker } from "../toxicity";
import { decision } from "./journal";
import type { EngineState } from "./state";
import { observeOutcome } from "./tape";
import type { PriceBreakdown } from "./types";

// Behavioural taker observations and tier changes, independent of flow labels.
export function getTaker(context: EngineState, address: Address, now: number) {
  const key = address.toLowerCase();
  context.state.takers[key] ??= newTaker(address, now, context.deps.params.toxicity.priorScore);
  return context.state.takers[key];
}

export function observeQuote(context: EngineState, record: QuoteRecord): void {
  if (context.state.observedQuotes.includes(record.id)) return;
  getTaker(context, getAddress(record.quote.taker), record.ts).quotes += 1;
  context.state.observedQuotes.push(record.id);
}

export function accountFill(context: EngineState, fill: Fill): void {
  if (context.state.processedFills.includes(fill.id)) return;
  const taker = getTaker(context, fill.taker, fill.ts);
  const issued = [...context.issued.values()].find((q) => q.id === fill.quoteId);
  if (!issued) return;
  const breakdown = issued.record.breakdown as PriceBreakdown;
  const moved =
    fill.midAtFill === null
      ? null
      : ((fill.side === "buy" ? 1 : -1) * (fill.midAtFill - issued.mid)) / issued.mid;
  observeFill(
    taker,
    {
      adverse: moved === null ? null : moved > breakdown.half,
      lateness:
        (fill.ts / 1000 - Number(issued.quote.issuedAt)) /
        (Number(issued.quote.expiry) - Number(issued.quote.issuedAt)),
      ts: fill.ts,
    },
    context.deps.params.toxicity,
  );
  observeOutcome(context, issued, true, fill.midAtFill);
  context.state.processedFills.push(fill.id);
  context.state.gasUsd += fill.gasUsd ?? 0;
  if (taker.detectedAfter) taker.postDetectionFills += 1;
}

export function takers(context: EngineState, limit = 100) {
  return Object.values(context.state.takers)
    .sort((a, b) => b.fills - a.fills)
    .slice(0, limit)
    .map(
      ({
        address,
        label,
        tier,
        score,
        signals,
        fills,
        pnlUsd,
        detectedAfter,
        preDetectionLossUsd,
        postDetectionLossUsd,
        postDetectionAttempts,
        postDetectionFills,
      }) => ({
        address,
        label,
        tier,
        score,
        signals,
        fills,
        pnlUsd,
        detectedAfter,
        preDetectionLossPerFillUsd: detectedAfter
          ? preDetectionLossUsd / detectedAfter.fills
          : null,
        postDetectionLossPerFillUsd: postDetectionFills
          ? postDetectionLossUsd / postDetectionFills
          : null,
        estimatedLossAvoidedUsd: detectedAfter
          ? (preDetectionLossUsd / detectedAfter.fills) * postDetectionAttempts
          : 0,
        postDetectionAttempts,
      }),
    );
}

export function rescore(context: EngineState, now: number): void {
  const { params } = context.deps;
  for (const taker of Object.values(context.state.takers)) {
    scoreTaker(taker, params.toxicity);
    const tier = nextTier(taker, params.toxicity, now, params.agent.cooldownMs);
    if (tier === taker.tier) continue;
    const before = taker.tier;
    taker.tier = tier;
    taker.tierChangedAt = now;
    if ((tier === "toxic" || tier === "blocked") && !taker.detectedAfter)
      taker.detectedAfter = {
        fills: taker.fills,
        seconds: (now - (taker.firstFillAt ?? now)) / 1000,
      };
    const ttl = (name: TierName) => (name === "blocked" ? 0 : params.toxicity.tiers[name].ttlSec);
    decision(
      context,
      "taker_tier_change",
      now,
      `${taker.address} ${before} → ${tier}; score ${taker.score.toFixed(3)}, ${taker.fills} fills, adverse ${(taker.signals.adverse * 100).toFixed(0)}%, 5s markout signal ${taker.signals.markout.toFixed(2)}, TTL ${ttl(before)}s → ${ttl(tier)}s`,
      {
        score: taker.score,
        fills: taker.fills,
        adverse: taker.signals.adverse,
        markout: taker.signals.markout,
        lateness: taker.signals.lateness,
        selectivity: taker.signals.selectivity,
      },
      null,
      taker.address,
      { tier: before, ttlSec: ttl(before) },
      { tier, ttlSec: ttl(tier) },
    );
    context.deps.emit?.({ type: "takerTier", address: taker.address, tier, score: taker.score });
  }
}
