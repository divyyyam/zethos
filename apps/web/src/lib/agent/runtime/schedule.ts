// Trigger watching and slice scheduling around the existing execution loop.
import type { Trigger } from "../intent";
import { TRIGGER_TICK_MS } from "./constants";
import { runSlice } from "./execution";
import { formatPrice, targetOf, triggerLabel } from "./helpers";
import { finish, logMission, markRemaining, patchMission, setStage, stopped } from "./missions";
import { latestMid } from "./sense";
import type { RuntimeState } from "./state";
import type { Plan } from "./types";

export async function runSwap(
  context: RuntimeState,
  id: string,
  plan: Plan,
  dryRun: boolean,
  signal: AbortSignal,
): Promise<void> {
  if (plan.trigger) {
    patchMission(context, id, () => ({ status: "armed" }));
    const fired = await watchTrigger(context, id, plan, plan.trigger, signal);
    if (!fired) return;
  }
  patchMission(context, id, () => ({
    status: "running",
    arrivalMid: latestMid(context, plan.pair),
  }));
  const measures: Promise<void>[] = [];
  for (let index = 0; index < plan.sliceAmounts.length; index += 1) {
    if (signal.aborted) return stopped(context, id);
    const outcome = await runSlice(context, id, plan, index, dryRun, signal, measures);
    if (outcome !== "filled") {
      markRemaining(context, id, index);
      if (outcome === "aborted") return stopped(context, id);
      if (outcome === "previewed") {
        logMission(context, id, "Dry run: priced and verified. Nothing was filled.", "good");
        return finish(context, id, "done");
      }
      return; // runSlice already recorded the failure.
    }
    if (index < plan.sliceAmounts.length - 1) {
      const at = context.now() + plan.intervalMs;
      patchMission(context, id, () => ({ nextSliceAt: at, status: "running" }));
      await context.sleep(plan.intervalMs, signal);
      patchMission(context, id, () => ({ nextSliceAt: null }));
      if (signal.aborted) {
        markRemaining(context, id, index + 1);
        return stopped(context, id);
      }
    }
  }
  patchMission(context, id, () => ({ status: "measuring" }));
  setStage(context, id, "measure", "active");
  await Promise.all(measures);
  setStage(context, id, "measure", "done");
  logMission(context, id, "Measured price after the fill at 1 s, 5 s and 30 s.", "good");
  finish(context, id, "done");
}

export async function watchTrigger(
  context: RuntimeState,
  id: string,
  plan: Plan,
  trigger: Trigger,
  signal: AbortSignal,
): Promise<boolean> {
  let reference = latestMid(context, plan.pair);
  while (reference === null) {
    if (signal.aborted) {
      stopped(context, id);
      return false;
    }
    await context.sleep(TRIGGER_TICK_MS, signal);
    reference = latestMid(context, plan.pair);
  }
  const { price, direction } = targetOf(trigger, reference);
  const expiresAt = context.now() + plan.triggerMs;
  const label = triggerLabel(trigger, price);
  patchMission(context, id, () => ({
    trigger: {
      label,
      targetPrice: price,
      direction,
      referenceMid: reference as number,
      currentMid: reference as number,
      expiresAt,
      firedAt: null,
    },
  }));
  logMission(context, id, `Armed: acts when ${label}. Reference mid ${formatPrice(reference)}.`);
  while (true) {
    if (signal.aborted) {
      stopped(context, id);
      return false;
    }
    if (context.now() >= expiresAt) {
      logMission(context, id, "The trigger expired without firing. Nothing was filled.", "warn");
      finish(context, id, "stopped");
      return false;
    }
    // A stale feed reads as null: it can't fire a trigger, and it can't clear one either.
    const mid = latestMid(context, plan.pair);
    if (mid !== null) {
      patchMission(context, id, (mission) =>
        mission.trigger ? { trigger: { ...mission.trigger, currentMid: mid } } : {},
      );
      if (direction === "below" ? mid <= price : mid >= price) {
        patchMission(context, id, (mission) =>
          mission.trigger ? { trigger: { ...mission.trigger, firedAt: context.now() } } : {},
        );
        logMission(context, id, `Trigger fired at mid ${formatPrice(mid)}.`, "good");
        return true;
      }
    }
    await context.sleep(TRIGGER_TICK_MS, signal);
  }
}
