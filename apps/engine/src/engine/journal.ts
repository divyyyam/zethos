import type { Address } from "viem";
import type { Decision } from "../agent/types";
import type { Pair } from "../config";
import { checkpoint } from "./persistence";
import type { EngineState } from "./state";

// Decision recording, retrieval and optional narration.
export function decision(
  context: EngineState,
  type: string,
  now: number,
  reason: string,
  inputs: Decision["inputs"],
  pair: Pair | null = null,
  taker: Address | null = null,
  before: Decision["before"] = null,
  after: Decision["after"] = null,
): Decision | null {
  const key = `${type}:${pair}:${taker}:${reason}`;
  const last = context.cooldowns.get(key);
  if (last !== undefined && now - last < context.deps.params.agent.cooldownMs) return null;
  const decision: Decision = {
    id: `d_${crypto.randomUUID()}`,
    ts: now,
    type,
    pair,
    taker,
    reason,
    inputs,
    before,
    after,
    narration: null,
  };
  context.state.decisions.push(decision);
  context.cooldowns.set(key, now);
  context.deps.emit?.({ type: "decision", decision });
  context.deps.onDecision?.(decision);
  return decision;
}

export function decisions(context: EngineState, limit = 20, type?: string): Decision[] {
  return context.state.decisions
    .filter((d) => !type || d.type === type)
    .slice(-limit)
    .reverse();
}

export function narrate(context: EngineState, id: string, narration: string): Promise<void> {
  return context.exclusive(async () => {
    const decision = context.state.decisions.find((d) => d.id === id);
    if (!decision) return;
    decision.narration = narration.trim().split(/\s+/).slice(0, 25).join(" ");
    await checkpoint(context);
    context.deps.emit?.({ type: "decision", decision });
  });
}
