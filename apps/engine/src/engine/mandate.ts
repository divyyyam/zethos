import type { Pair } from "../config";
import { type MandateBreach, operatingLossUsd } from "../policy/execution";
import { EngineError } from "./errors";
import { decision } from "./journal";
import { equityUsdFor } from "./market";
import { checkpoint } from "./persistence";
import type { EngineState } from "./state";

export async function recordMandateBreach(
  context: EngineState,
  breach: MandateBreach,
  now: number,
): Promise<void> {
  decision(
    context,
    "mandate_breach",
    now,
    breach.message,
    {
      rule: breach.rule,
      actual: breach.actual,
      limit: breach.limit,
    },
    breach.pair,
  );
  // Rejected quotes do not reach normal quote persistence or the next heartbeat.
  await checkpoint(context);
}

export async function checkOperatingLoss(
  context: EngineState,
  now: number,
  pair: Pair | null = null,
): Promise<boolean> {
  if (!context.inventory) return false;
  const equity = equityUsdFor(context, context.inventory);
  if (equity === null) return false;
  const loss = operatingLossUsd(context.state.initialEquity, equity, context.state.gasUsd);
  const limit = context.mandate.loss.maxOperatingLossUsd;
  if (loss <= limit) {
    context.operatingLossStopped = false;
    return false;
  }
  if (context.operatingLossStopped && context.paused) return true;
  context.paused = context.state.paused = true;
  decision(
    context,
    "mandate_breach",
    now,
    `Operating loss $${loss.toFixed(2)} exceeds mandate $${limit.toFixed(2)}`,
    {
      rule: "operating_loss",
      actual: loss,
      limit,
      equity,
      gasUsd: context.state.gasUsd,
    },
    pair,
  );
  await checkpoint(context);
  context.operatingLossStopped = true;
  context.deps.emit?.({
    type: "risk",
    paused: true,
    riskState: "paused",
    halted: context.deps.params.pairs.filter((p) => context.state.halts[p]),
  });
  return true;
}

export async function requireOperatingCapacity(
  context: EngineState,
  now: number,
  pair: Pair,
): Promise<void> {
  if (await checkOperatingLoss(context, now, pair))
    throw new EngineError("paused", 503, "Desk operating-loss mandate reached");
}
