import type { Fill, PairStatus, PriceBreakdown, Status, Zethos } from "@zethos/sdk";
import type { Address } from "viem";
import type { Trigger } from "../intent";
import type { MARKOUT_HORIZONS, STAGES } from "./constants";

export type Pair = PairStatus["pair"];

export type Stage = (typeof STAGES)[number];

export type StageState = "idle" | "active" | "done" | "failed" | "skipped";

export type MissionStatus =
  | "draft"
  | "armed"
  | "running"
  | "holding"
  | "measuring"
  | "done"
  | "stopped"
  | "failed";

export interface Plan {
  pair: Pair;
  side: "buy" | "sell";
  soldSymbol: string;
  boughtSymbol: string;
  soldDecimals: number;
  boughtDecimals: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  /** True when the user sized the other token, so the input is a conversion at the live price. */
  approximate: boolean;
  sliceAmounts: string[];
  intervalMs: number;
  estOut: number | null;
  estUsd: number | null;
  maxCostBps: number;
  holdMs: number;
  trigger: Trigger | null;
  triggerMs: number;
  notes: string[];
}

export interface SliceRun {
  index: number;
  amountIn: string;
  state: "pending" | "active" | "filled" | "failed" | "skipped";
  fill: Fill | null;
  paid: number | null;
  received: number | null;
  price: number | null;
  vsMidBps: number | null;
  markouts: Partial<Record<(typeof MARKOUT_HORIZONS)[number], number>>;
}

export interface TriggerRun {
  label: string;
  targetPrice: number;
  direction: "below" | "above";
  referenceMid: number;
  currentMid: number;
  expiresAt: number;
  firedAt: number | null;
}

export interface LogLine {
  t: number;
  text: string;
  tone: "info" | "good" | "warn" | "bad";
}

export type Report =
  | { type: "market"; pairs: PairStatus[]; equityUsd: number | null; riskState: string }
  | {
      type: "explain";
      pair: Pair;
      usd: number;
      vsMidBps: number;
      ttlSec: number;
      breakdown: PriceBreakdown;
    }
  | {
      type: "ladder";
      pair: Pair;
      rungs: { usd: number; costBps: number | null; ttlSec: number | null; note: string | null }[];
    }
  | {
      type: "position";
      rows: {
        pair: Pair;
        baseSymbol: string;
        net: number;
        quoteFlow: number;
        mid: number | null;
        pnlUsd: number | null;
        fills: number;
      }[];
      truncated: boolean;
    }
  | { type: "help" }
  | { type: "notice"; title: string; detail: string };

export interface Mission {
  id: string;
  text: string;
  createdAt: number;
  taker: Address;
  status: MissionStatus;
  plan: Plan | null;
  dryRun: boolean;
  report: Report | null;
  stages: Record<Stage, { state: StageState; detail: string | null }>;
  slices: SliceRun[];
  trigger: TriggerRun | null;
  log: LogLine[];
  /** The most recent priced quote, for "why this price". */
  quote: {
    vsMidBps: number;
    ttlSec: number;
    expiresAt: number;
    out: number;
    breakdown: PriceBreakdown;
    signature: string;
    nonce: string;
    id: string;
  } | null;
  arrivalMid: number | null;
  nextSliceAt: number | null;
  error: string | null;
}

export type Connection = "unconfigured" | "connecting" | "live" | "polling" | "offline";

export interface MarketState {
  connection: Connection;
  status: Status | null;
  /** Failure of the most recent status read, shown as a failure while the stale numbers grey out. */
  error: string | null;
  updatedAt: number;
  history: Partial<Record<Pair, { t: number; mid: number }[]>>;
  venues: Partial<Record<Pair, Record<string, { t: number; bps: number }[]>>>;
  tape: Fill[];
}

export type AgentSdk = Pick<
  Zethos,
  "status" | "quote" | "verifyQuote" | "paperFill" | "fills" | "stats" | "stream"
>;

export interface AgentDeps {
  sdk: AgentSdk | null;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollMs?: number;
}

export interface Submitted {
  /** Why the sentence was refused, when it was. */
  refusal: string | null;
  missions: Mission[];
}

export interface MissionTotals {
  filled: number;
  paid: number;
  received: number;
  avgPrice: number | null;
  costBps: number | null;
}
