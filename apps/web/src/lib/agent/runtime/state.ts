import { STATUS_POLL_MS } from "./constants";
import { abortableSleep } from "./helpers";
import type { AgentDeps, AgentSdk, MarketState, Mission } from "./types";

/** One browser-tab state shared by feed, mission and execution collaborators. */
export class RuntimeState {
  missions: Mission[] = [];
  market: MarketState;
  readonly listeners = new Set<() => void>();
  readonly controllers = new Map<string, AbortController>();
  readonly sdk: AgentSdk | null;
  readonly settleLive: AgentDeps["settleLive"];
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly pollMs: number;
  retained = 0;
  disconnect: (() => void) | null = null;
  counter = 0;
  constructor(deps: AgentDeps) {
    this.sdk = deps.sdk;
    this.settleLive = deps.settleLive;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? abortableSleep;
    this.pollMs = deps.pollMs ?? STATUS_POLL_MS;
    this.market = {
      connection: deps.sdk ? "connecting" : "unconfigured",
      status: null,
      error: null,
      updatedAt: 0,
      history: {},
      venues: {},
      tape: [],
    };
  }
}
