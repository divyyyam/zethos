import type { Address } from "viem";
import type { Taker } from "../agent/types";
import type { Params, TierName } from "../config";

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const tiers: TierName[] = ["normal", "watch", "toxic", "blocked"];

export function newTaker(address: Address, now: number, prior: number): Taker {
  return {
    address,
    label: null,
    tier: "probation",
    score: prior,
    signals: { markout: 0, adverse: 0, lateness: 0, selectivity: 0 },
    fills: 0,
    quotes: 0,
    firstFillAt: null,
    updatedAt: now,
    tierChangedAt: 0,
    pnlUsd: 0,
    detectedAfter: null,
    override: null,
    observations: [],
    adverseSamples: 0,
    markoutSamples: 0,
    favorable: { quotes: 0, fills: 0 },
    unfavorable: { quotes: 0, fills: 0 },
    preDetectionLossUsd: 0,
    postDetectionLossUsd: 0,
    postDetectionAttempts: 0,
    postDetectionFills: 0,
  };
}

export function observeFill(
  taker: Taker,
  evidence: { adverse: boolean | null; lateness: number; ts: number },
  params: Params["toxicity"],
): void {
  const alpha = 1 - 0.5 ** (1 / params.halfLifeFills);
  const adverse = evidence.adverse === null ? null : evidence.adverse ? 1 : 0;
  taker.adverseSamples ??= 0;
  if (adverse !== null) {
    taker.signals.adverse =
      taker.adverseSamples === 0 ? adverse : (1 - alpha) * taker.signals.adverse + alpha * adverse;
    taker.adverseSamples++;
  }
  taker.observations.push({ adverse, lateness: clamp01(evidence.lateness) });
  taker.observations = taker.observations.slice(-Math.ceil(params.halfLifeFills * 4));
  const times = taker.observations.map((o) => o.lateness).sort((a, b) => a - b);
  const center = Math.floor(times.length / 2);
  taker.signals.lateness =
    times.length % 2 ? (times[center] ?? 0) : ((times[center - 1] ?? 0) + (times[center] ?? 0)) / 2;
  taker.fills += 1;
  taker.firstFillAt ??= evidence.ts;
  taker.updatedAt = evidence.ts;
}

export function observeMarkout(taker: Taker, bps: number, params: Params["toxicity"]): void {
  // A 30 bps adverse 5-second move saturates the markout signal.
  const value = clamp01(-bps / 30);
  const alpha = 1 - 0.5 ** (1 / params.halfLifeFills);
  taker.signals.markout =
    taker.markoutSamples === 0 ? value : (1 - alpha) * taker.signals.markout + alpha * value;
  taker.markoutSamples += 1;
}

export function scoreTaker(taker: Taker, params: Params["toxicity"]): number {
  const rate = (s: { quotes: number; fills: number }) => (s.quotes > 0 ? s.fills / s.quotes : 0);
  taker.signals.selectivity = clamp01(rate(taker.favorable) - rate(taker.unfavorable));
  const raw = (Object.keys(params.weights) as (keyof typeof params.weights)[]).reduce(
    (sum, key) => sum + params.weights[key] * taker.signals[key],
    0,
  );
  taker.score =
    (taker.fills * raw + params.minFills * params.priorScore) / (taker.fills + params.minFills);
  return taker.score;
}

export function nextTier(
  taker: Taker,
  params: Params["toxicity"],
  now: number,
  cooldown: number,
): TierName {
  if (taker.override) return taker.override;
  if (taker.fills < params.minFills) return "probation";
  if (now - taker.tierChangedAt < cooldown) return taker.tier;
  if (taker.tier === "probation") return "normal";
  const index = tiers.indexOf(taker.tier);
  const higher = tiers[index + 1];
  if (
    higher &&
    higher !== "normal" &&
    higher !== "probation" &&
    taker.score >= params.tiers[higher].enter
  )
    return higher;
  if (taker.tier !== "normal" && taker.score < params.tiers[taker.tier].exit)
    return tiers[index - 1] ?? "normal";
  return taker.tier;
}
