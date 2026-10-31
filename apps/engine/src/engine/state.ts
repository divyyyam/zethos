import type { Address, Hex } from "viem";
import { type AgentState, initialState } from "../agent/types";
import type { Pair } from "../config";
import type { Fill } from "../db";
import { Volatility } from "../feeds/vol";
import type { SignedQuote } from "../quotes";
import type { Inventory } from "../tokens";
import type { EngineDeps, Issued, Market } from "./types";

/** Shared by every collaborator; the queue remains the only write serialization boundary. */
export class EngineState {
  readonly markets = new Map<Pair, Market>();
  readonly issued = new Map<string, Issued>();
  readonly usedNonces = new Set<string>();
  readonly requests = new Map<string, number[]>();
  arena: { epoch: number; startedAt: number } | null = null;
  inventory: Inventory | null = null;
  paused = false;
  state: AgentState = initialState(0, 0);
  ledger: Fill[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  lastTick = 0;
  readonly pendingTape: { due: number; quote: SignedQuote; signature: Hex }[] = [];
  readonly seenTrades = new Map<string, number>();
  readonly cooldowns = new Map<string, number>();
  modeledGasUsd = 0;
  constructor(readonly deps: EngineDeps) {
    for (const pair of deps.params.pairs) {
      this.markets.set(pair, {
        venues: new Map(),
        fused: { mid: null, health: "down", sources: [], book: null },
        vol: new Volatility(),
        updatedAt: null,
        history: [],
      });
    }
  }
  get signerAddress(): Address {
    return this.deps.signer.address;
  }
  // Durable Object requests interleave at awaits. Keep the original queue and rejection recovery.
  exclusive<T>(action: () => Promise<T>): Promise<T> {
    const work = this.queue.then(action);
    this.queue = work.catch(() => {});
    return work;
  }
}
