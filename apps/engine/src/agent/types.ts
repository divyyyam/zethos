import type { Address } from "viem";
import type { Pair, TierName } from "../config";
import type { Flow } from "../db";

export interface Decision {
  id: string;
  ts: number;
  type: string;
  pair: Pair | null;
  taker: Address | null;
  reason: string;
  inputs: Record<string, number | string>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  narration: string | null;
}

export const HORIZONS = [1, 5, 30, 300] as const;
export type Horizon = (typeof HORIZONS)[number];
export interface Markout {
  fillId: string;
  horizon: Horizon;
  ts: number;
  mid: number;
  bps: number;
}

export interface Signals {
  markout: number;
  adverse: number;
  lateness: number;
  selectivity: number;
}

export interface Taker {
  address: Address;
  label: string | null;
  tier: TierName;
  score: number;
  signals: Signals;
  fills: number;
  quotes: number;
  firstFillAt: number | null;
  updatedAt: number;
  tierChangedAt: number;
  pnlUsd: number;
  detectedAfter: { fills: number; seconds: number } | null;
  override: TierName | null;
  observations: { adverse: number | null; lateness: number }[];
  adverseSamples: number;
  markoutSamples: number;
  favorable: { quotes: number; fills: number };
  unfavorable: { quotes: number; fills: number };
  preDetectionLossUsd: number;
  postDetectionLossUsd: number;
  postDetectionAttempts: number;
  postDetectionFills: number;
}

export type ByFlow = Record<Flow, number>;
export const emptyFlow = (): ByFlow => ({ tape: 0, user: 0, agent: 0, attacker: 0 });
export interface EquityPoint {
  t: number;
  equity: number;
  byFlow: ByFlow;
}

export interface AgentState {
  epoch: number;
  initialEquity: number;
  peakEquity: number;
  paused: boolean;
  halts: Partial<Record<Pair, boolean>>;
  downSince: Partial<Record<Pair, number>>;
  healthySince: Partial<Record<Pair, number>>;
  health: Partial<Record<Pair, string>>;
  tuner: Partial<Record<Pair, number>>;
  tunedThrough: Partial<Record<Pair, string>>;
  alarmAt: Partial<Record<Pair, number>>;
  inventoryLimited: Partial<Record<Pair, string>>;
  decisions: Decision[];
  takers: Record<string, Taker>;
  markouts: Markout[];
  points: EquityPoint[];
  tape: { attempts: number; wins: number; lost: number };
  gasUsd: number;
  processedFills: string[];
  observedQuotes: string[];
  outcomes: string[];
  prices: Partial<Record<Pair, { t: number; mid: number; sources?: Record<string, number> }[]>>;
  strategy: unknown;
}

export function initialState(epoch: number, equity: number): AgentState {
  return {
    epoch,
    initialEquity: equity,
    peakEquity: equity,
    paused: false,
    halts: {},
    downSince: {},
    healthySince: {},
    health: {},
    tuner: {},
    tunedThrough: {},
    alarmAt: {},
    inventoryLimited: {},
    decisions: [],
    takers: {},
    markouts: [],
    points: [],
    tape: { attempts: 0, wins: 0, lost: 0 },
    gasUsd: 0,
    processedFills: [],
    observedQuotes: [],
    outcomes: [],
    prices: {},
    strategy: null,
  };
}
