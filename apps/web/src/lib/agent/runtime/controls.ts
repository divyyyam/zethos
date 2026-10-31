// Draft submission, explicit authorization and cancellation; no draft executes itself.
import type { Address } from "viem";
import { type Intent, parseIntent } from "../intent";
import { isActive, isStoppable } from "./helpers";
import { addDraft, addPendingReport, addReport, emit, findMission } from "./missions";
import { compilePlan } from "./planning";
import { runRead } from "./reports";
import { runSwap } from "./schedule";
import { connect, pairStatus, releaseFeedIfIdle } from "./sense";
import type { RuntimeState } from "./state";
import type { Submitted } from "./types";

export function submit(context: RuntimeState, text: string, taker: Address): Submitted {
  const { intent } = parseIntent(text);
  return submitIntent(context, text, taker, intent);
}

export function submitIntent(
  context: RuntimeState,
  text: string,
  taker: Address,
  intent: Intent,
): Submitted {
  if (intent.kind === "unknown") return { refusal: intent.reason, missions: [] };
  if (!context.sdk)
    return { refusal: "The engine isn’t connected, so I can’t act on this yet.", missions: [] };
  if (intent.kind === "stop") {
    const stopped = stopAll(context);
    return {
      refusal: null,
      missions: [
        addReport(context, text, taker, {
          type: "notice",
          title: stopped
            ? `Stopped ${stopped} mission${stopped === 1 ? "" : "s"}`
            : "Nothing running",
          detail: stopped
            ? "Fills that already settled stay settled. Nothing new will be priced for them."
            : "No armed or running missions to stop.",
        }),
      ],
    };
  }
  if (intent.kind === "help") {
    return { refusal: null, missions: [addReport(context, text, taker, { type: "help" })] };
  }
  if (intent.kind === "swap") {
    const pair = pairStatus(context, intent.pair);
    if (!pair)
      return {
        refusal: "Waiting for the first market read. Try again in a moment.",
        missions: [],
      };
    const plan = compilePlan(intent, pair);
    if (typeof plan === "string") return { refusal: plan, missions: [] };
    return { refusal: null, missions: [addDraft(context, text, taker, plan, intent.dryRun)] };
  }
  const mission = addPendingReport(context, text, taker);
  void runRead(context, mission.id, intent, taker);
  return { refusal: null, missions: [mission] };
}

export function authorize(context: RuntimeState, id: string): void {
  const mission = findMission(context, id);
  if (mission?.status !== "draft" || !mission.plan || !context.sdk) return;
  const controller = new AbortController();
  context.controllers.set(id, controller);
  connect(context);
  void runSwap(context, id, mission.plan, mission.dryRun, controller.signal).finally(() => {
    context.controllers.delete(id);
    releaseFeedIfIdle(context);
  });
}

export function discard(context: RuntimeState, id: string): void {
  context.missions = context.missions.filter(
    (mission) => mission.id !== id || mission.status !== "draft",
  );
  emit(context);
}

export function dismiss(context: RuntimeState, id: string): void {
  context.missions = context.missions.filter(
    (mission) => mission.id !== id || isActive(mission.status),
  );
  emit(context);
}

export function stop(context: RuntimeState, id: string): void {
  const mission = findMission(context, id);
  if (!mission || !isStoppable(mission.status)) return;
  context.controllers.get(id)?.abort();
}

export function stopAll(context: RuntimeState): number {
  const running = context.missions.filter((mission) => isStoppable(mission.status));
  for (const mission of running) stop(context, mission.id);
  return running.length;
}
