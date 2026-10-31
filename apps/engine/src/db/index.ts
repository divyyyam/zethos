import type { Address, Hex } from "viem";
import type { AgentState } from "../agent/types";
import type { Pair, Side } from "../config";
import type { PolicyRecord } from "../policy";
import type { SignedQuote } from "../quotes";
import type { Inventory } from "../tokens";

export type { PolicyRecord } from "../policy";
export { createDb, type Database } from "./db";

export type Flow = "tape" | "user" | "agent" | "attacker";

export interface Fill {
  id: string;
  quoteId: string;
  policyId: string;
  ts: number;
  taker: Address;
  pair: Pair;
  side: Side;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  amountOut: string;
  price: number;
  midAtFill: number | null;
  flow: Flow;
  paper: true;
  txHash: Hex | null;
  markouts?: Record<string, number>;
  gasUsd?: number;
  epoch?: number;
}

export interface QuoteRecord {
  id: string;
  policyId: string;
  ts: number;
  epoch: number;
  pair: Pair;
  side: Side;
  client: string;
  quote: SignedQuote;
  signature: Hex;
  breakdown: unknown;
  status?: "issued" | "filled" | "expired";
}

export interface ArenaState {
  epoch: number;
  startedAt: number;
  inventory: Inventory;
}

export interface Store {
  loadArena(): Promise<ArenaState | null>;
  startArena(startedAt: number, inventory: Inventory): Promise<ArenaState>;
  saveQuote(record: QuoteRecord): Promise<void>;
  loadQuotes(epoch: number): Promise<QuoteRecord[]>;
  expireQuotes(nowSec: number): Promise<void>;
  nonceUsed(taker: string, nonce: string): Promise<boolean>;
  loadState(epoch?: number): Promise<AgentState | null>;
  saveState(state: AgentState): Promise<void>;
  // Atomic: the fill, its nonce and the new inventory are written together or not at all.
  saveFill(fill: Fill, nonce: string, epoch: number, inventory: Inventory): Promise<void>;
  fills(query: { taker?: Address; limit: number; epoch?: number }): Promise<Fill[]>;
  savePolicy(record: PolicyRecord): Promise<void>;
  getPolicy(id: string): Promise<PolicyRecord | null>;
  listPolicies(): Promise<PolicyRecord[]>;
}
