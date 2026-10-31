// Mission state transitions and subscriber notifications shared by the agent stages.
import type { Address } from "viem";
import { STAGES } from "./constants";
import type { RuntimeState } from "./state";
import type { LogLine, Mission, Plan, Report, SliceRun, Stage, StageState } from "./types";

export function emit(context: RuntimeState): void {
  for (const listener of context.listeners) listener();
}

export function findMission(context: RuntimeState, id: string): Mission | undefined {
  return context.missions.find((mission) => mission.id === id);
}

export function patchMission(
  context: RuntimeState,
  id: string,
  change: (mission: Mission) => Partial<Mission>,
): void {
  context.missions = context.missions.map((mission) =>
    mission.id === id ? { ...mission, ...change(mission) } : mission,
  );
  emit(context);
}

export function setStage(
  context: RuntimeState,
  id: string,
  stage: Stage,
  state: StageState,
  detail?: string,
): void {
  patchMission(context, id, (mission) => ({
    stages: {
      ...mission.stages,
      [stage]: { state, detail: detail ?? mission.stages[stage].detail },
    },
  }));
}

export function logMission(
  context: RuntimeState,
  id: string,
  text: string,
  tone: LogLine["tone"] = "info",
): void {
  const line = { t: context.now(), text, tone };
  patchMission(context, id, (mission) => ({ log: [...mission.log, line] }));
}

export function blank(context: RuntimeState, text: string, taker: Address): Mission {
  return {
    id: `m${++context.counter}_${context.now().toString(36)}`,
    text,
    createdAt: context.now(),
    taker,
    status: "running",
    plan: null,
    dryRun: false,
    report: null,
    stages: Object.fromEntries(
      STAGES.map((stage) => [stage, { state: "idle", detail: null }]),
    ) as Mission["stages"],
    slices: [],
    trigger: null,
    log: [],
    quote: null,
    arrivalMid: null,
    nextSliceAt: null,
    error: null,
  };
}

export function add(context: RuntimeState, mission: Mission): Mission {
  context.missions = [mission, ...context.missions].slice(0, 30);
  emit(context);
  return mission;
}

export function addDraft(
  context: RuntimeState,
  text: string,
  taker: Address,
  plan: Plan,
  dryRun: boolean,
): Mission {
  return add(context, {
    ...blank(context, text, taker),
    status: "draft",
    plan,
    dryRun,
    slices: plan.sliceAmounts.map((amountIn, index) => ({
      index,
      amountIn,
      state: "pending",
      fill: null,
      paid: null,
      received: null,
      price: null,
      vsMidBps: null,
      markouts: {},
    })),
  });
}

export function addReport(
  context: RuntimeState,
  text: string,
  taker: Address,
  report: Report,
): Mission {
  return add(context, { ...blank(context, text, taker), status: "done", report });
}

export function addPendingReport(context: RuntimeState, text: string, taker: Address): Mission {
  return add(context, blank(context, text, taker));
}

export function finish(
  context: RuntimeState,
  id: string,
  status: "done" | "stopped" | "failed",
  error: string | null = null,
): void {
  patchMission(context, id, (mission) => ({
    status,
    error,
    nextSliceAt: null,
    stages: Object.fromEntries(
      STAGES.map((stage) => {
        const current = mission.stages[stage];
        return [
          stage,
          current.state === "active"
            ? { ...current, state: status === "failed" ? "failed" : "skipped" }
            : current,
        ];
      }),
    ) as Mission["stages"],
  }));
}

export function stopped(context: RuntimeState, id: string): void {
  logMission(context, id, "Stopped by you. Anything already filled stays filled.", "warn");
  finish(context, id, "stopped");
}

export function markRemaining(context: RuntimeState, id: string, from: number): void {
  patchMission(context, id, (mission) => ({
    slices: mission.slices.map((slice) =>
      slice.index >= from && (slice.state === "pending" || slice.state === "active")
        ? { ...slice, state: "skipped" }
        : slice,
    ),
  }));
}

export function setSlice(
  context: RuntimeState,
  id: string,
  index: number,
  change: Partial<SliceRun>,
): void {
  patchMission(context, id, (mission) => ({
    slices: mission.slices.map((slice) =>
      slice.index === index ? { ...slice, ...change } : slice,
    ),
  }));
}
