import type { Address } from "viem";
import type { Intent } from "../intent";
import { authorize, discard, dismiss, stop, stopAll, submit, submitIntent } from "./controls";
import { retain } from "./sense";
import { RuntimeState } from "./state";
import type { AgentDeps, Submitted } from "./types";

export {
  DEFAULT_HOLD_MS,
  DEFAULT_MAX_COST_BPS,
  DEFAULT_TRIGGER_MS,
  MARKOUT_HORIZONS,
  STAGES,
} from "./constants";
export { formatBps, formatPrice, formatToken, isActive, isStoppable } from "./helpers";
export { compilePlan } from "./planning";
export { missionTotals } from "./totals";
export type {
  AgentDeps,
  AgentSdk,
  Connection,
  LogLine,
  MarketState,
  Mission,
  MissionStatus,
  MissionTotals,
  Plan,
  Report,
  SliceRun,
  Stage,
  StageState,
  Submitted,
  TriggerRun,
} from "./types";

/** Public browser agent facade. Authorization, cancellation and retries keep their original order. */
export class AgentRuntime {
  private readonly context: RuntimeState;
  constructor(deps: AgentDeps) {
    this.context = new RuntimeState(deps);
  }
  subscribe = (listener: () => void) => {
    this.context.listeners.add(listener);
    return () => this.context.listeners.delete(listener);
  };
  getMissions = () => this.context.missions;
  getMarket = () => this.context.market;
  retain(): () => void {
    return retain(this.context);
  }

  submit(text: string, taker: Address): Submitted {
    return submit(this.context, text, taker);
  }

  submitIntent(text: string, taker: Address, intent: Intent): Submitted {
    return submitIntent(this.context, text, taker, intent);
  }

  authorize(id: string): void {
    authorize(this.context, id);
  }

  discard(id: string): void {
    discard(this.context, id);
  }

  dismiss(id: string): void {
    dismiss(this.context, id);
  }

  stop(id: string): void {
    stop(this.context, id);
  }

  stopAll(): number {
    return stopAll(this.context);
  }
}
