import { decision } from "./journal";
import type { EngineState } from "./state";
import { getTaker } from "./toxicity";

// Adjust spreads from completed fill markouts.
export function tune(context: EngineState, now: number): void {
  const { params } = context.deps;
  for (const pair of params.pairs) {
    const fills = context.ledger.filter(
      (f) =>
        f.pair === pair && !["toxic", "blocked"].includes(getTaker(context, f.taker, f.ts).tier),
    );
    const samples = fills
      .map((f) => ({
        fill: f,
        mark: context.state.markouts.find((m) => m.fillId === f.id && m.horizon === 30),
      }))
      .filter((s) => s.mark)
      .slice(-params.tuner.windowFills);
    if (samples.length < params.tuner.windowFills) continue;
    const through = samples.at(-1)?.fill.id;
    if (!through || context.state.tunedThrough[pair] === through) continue;
    const last = context.state.decisions.findLast(
      (d) => d.pair === pair && (d.type === "spread_widen" || d.type === "spread_narrow"),
    );
    if (last && now - last.ts < params.agent.cooldownMs) continue;
    const mean = samples.reduce((s, x) => s + (x.mark?.bps ?? 0) / 10000, 0) / samples.length;
    const before = context.state.tuner[pair] ?? 1;
    const delta = mean < params.tuner.widenBelow ? 1 : mean > params.tuner.narrowAbove ? -1 : 0;
    const after = Math.max(
      0.5,
      Math.min(3, before + (delta * params.tuner.step) / params.spread.base[pair]),
    );
    context.state.tunedThrough[pair] = through;
    if (before === after) continue;
    context.state.tuner[pair] = after;
    decision(
      context,
      delta > 0 ? "spread_widen" : "spread_narrow",
      now,
      `${pair} mean 30s markout ${(mean * 10000).toFixed(1)} bps over ${samples.length} fills; multiplier ${before.toFixed(2)} → ${after.toFixed(2)}`,
      { meanBps: mean * 10000, fills: samples.length },
      pair,
      null,
      { multiplier: before },
      { multiplier: after },
    );
  }
}
