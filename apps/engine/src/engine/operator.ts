import type { Address } from "viem";
import { paramsSchema, type TierName } from "../config";
import { nextTier } from "../toxicity";
import { EngineError } from "./errors";
import { decision } from "./journal";
import { equityUsdFor } from "./market";
import { checkpoint } from "./persistence";
import type { EngineState } from "./state";
import { getTaker } from "./toxicity";
import { parse } from "./validation";

// Serialized operator controls and strategy reloads.
export function pause(
  context: EngineState,
  operator: Address,
  paused: boolean,
  now: number,
): Promise<void> {
  return context.exclusive(async () => {
    context.paused = context.state.paused = paused;
    // Resume acknowledges the old drawdown; a fresh drawdown trips the gate again.
    if (!paused)
      context.state.peakEquity = context.inventory
        ? (equityUsdFor(context, context.inventory) ?? context.state.peakEquity)
        : context.state.peakEquity;
    decision(
      context,
      paused ? "pause" : "resume",
      now,
      `Operator ${operator} ${paused ? "paused" : "resumed"} paper market making`,
      { operator },
    );
    await checkpoint(context);
  });
}

export function setTaker(
  context: EngineState,
  operator: Address,
  address: Address,
  input: { tier?: TierName | null; label?: string },
  now: number,
): Promise<void> {
  return context.exclusive(async () => {
    const taker = getTaker(context, address, now);
    if (input.label !== undefined) taker.label = input.label;
    if (input.tier !== undefined) {
      const before = taker.tier;
      taker.override = input.tier;
      taker.tier =
        input.tier ?? nextTier({ ...taker, override: null }, context.deps.params.toxicity, now, 0);
      taker.tierChangedAt = now;
      decision(
        context,
        "taker_tier_change",
        now,
        `Operator ${operator} changed ${address} tier override to ${input.tier ?? "automatic"}`,
        { operator },
        null,
        address,
        { tier: before },
        { tier: taker.tier },
      );
      context.deps.emit?.({ type: "takerTier", address, tier: taker.tier, score: taker.score });
    }
    await checkpoint(context);
  });
}

export function reloadParams(context: EngineState, input: unknown, now: number): Promise<void> {
  return context.exclusive(async () => {
    const next = parse(paramsSchema, input);
    if (JSON.stringify(next.pairs) !== JSON.stringify(context.deps.params.pairs))
      throw new EngineError(
        "invalid_request",
        400,
        "Changing enabled pairs requires an engine restart",
      );
    const changed = Object.keys(next).filter(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(context.deps.params[key]),
    );
    if (!changed.length) return;
    context.deps.params = next;
    decision(context, "param_reload", now, `Strategy updated: ${changed.join(", ")}`, {
      changed: changed.join(", "),
    });
    context.deps.emit?.({ type: "params", ts: now, changed });
    await checkpoint(context);
  });
}
