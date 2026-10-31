import type { Address, Hex } from "viem";
import { type AgentState, initialState } from "../agent/types";
import type { Pair } from "../config";
import type { Fill } from "../db";
import { Volatility } from "../feeds/vol";
import { createV0, type Policy, type PolicyRecord } from "../policy";
import { defaultMandate, loadMandate, type Mandate } from "../policy/mandate";
import type { SignedQuote } from "../quotes";
import type { Inventory } from "../tokens";
import type { EngineDeps, Issued, Market } from "./types";

/** Shared by every collaborator; the queue remains the only write serialization boundary. */
export class EngineState {
  readonly mandate: Mandate;
  readonly markets = new Map<Pair, Market>();
  readonly issued = new Map<string, Issued>();
  readonly usedNonces = new Set<string>();
  readonly requests = new Map<string, number[]>();
  arena: { epoch: number; startedAt: number } | null = null;
  inventory: Inventory | null = null;
  activePolicy: { record: PolicyRecord; policy: Policy } | null = null;
  canary: { record: PolicyRecord; policy: Policy } | null = null;
  paused = false;
  operatingLossStopped = false;
  state: AgentState = initialState(0, 0);
  ledger: Fill[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  lastTick = 0;
  readonly pendingTape: { due: number; quote: SignedQuote; signature: Hex }[] = [];
  readonly seenTrades = new Map<string, number>();
  readonly cooldowns = new Map<string, number>();
  modeledGasUsd = 0;
  constructor(readonly deps: EngineDeps) {
    this.mandate = loadMandate(deps.mandate ?? defaultMandate);
    if (this.mandate.pairs.some((pair) => !deps.params.pairs.includes(pair)))
      throw new Error("Every mandate pair must be enabled in engine params");
    for (const pair of deps.params.pairs) {
      this.markets.set(pair, {
        venues: new Map(),
        fused: { mid: null, health: "down", sources: [], book: null },
        vol: new Volatility(),
        updatedAt: null,
        history: [],
        venueHistory: {},
      });
    }
  }
  get signerAddress(): Address {
    return this.deps.signer.address;
  }
  get policy(): Policy {
    // Parameter reloads must take effect for v0 without retaining stale configuration.
    return this.activePolicy?.policy ?? this.deps.policy ?? createV0(this.deps.params);
  }
  get policyId(): string {
    return this.activePolicy?.record.id ?? this.deps.policy?.id ?? "v0";
  }
  // Durable Object requests interleave at awaits. Keep the original queue and rejection recovery.
  exclusive<T>(action: () => Promise<T>): Promise<T> {
    const work = this.queue.then(action);
    this.queue = work.catch(() => {});
    return work;
  }
}
