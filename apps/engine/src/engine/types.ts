import type { Address, Hex, LocalAccount } from "viem";
import type { Decision } from "../agent/types";
import type { Pair, Params, Side, TierName, VenueId } from "../config";
import type { Fill, QuoteRecord, Store } from "../db";
import type { Engine } from "../engine";
import type { Fused, VenueState } from "../feeds/fuse";
import type { Health, Source } from "../feeds/types";
import type { Volatility } from "../feeds/vol";
<<<<<<< HEAD
import type { Policy, PolicySummary, VenueSample } from "../policy";
||||||| 94d6717
=======
import type { LiveVault } from "../live";
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3
import type { SignedQuote } from "../quotes";
import type { LossAttributionResult } from "../research";
import type { Tokens } from "../tokens";

export interface PriceBreakdown {
  mid: number;
  ref: number;
  sources: Source[];
  base: number;
  vol: number;
  inventory: number;
  toxicity: number;
  degraded: number;
  tuner: number;
  half: number;
  sigmaT: number;
  ttlSec: number;
  tier: TierName;
}

export interface PaperQuote {
  route: "paper";
  id: string;
  policyId: string;
  quote: SignedQuote;
  signature: Hex;
  paperOut: string;
  poolOut: string | null;
  poolVenue: string | null;
  spotOut: string;
  savingVsPoolPct: number | null;
  vsMidBps: number;
  expiresAt: number;
  breakdown: PriceBreakdown;
}

/** Settles on the vault. No on-chain pool is configured, so there is no pool comparison to report. */
export interface LiveQuote {
  route: "conduit";
  id: string;
  quote: SignedQuote;
  signature: Hex;
  conduitOut: string;
  hskswapOut: null;
  spotOut: string;
  savingPct: null;
  vsMidBps: number;
  expiresAt: number;
  breakdown: PriceBreakdown;
}

export type Frame =
  | { type: "price"; pair: Pair; mid: number | null; health: Health; ts: number }
  | { type: "fill"; fill: Fill }
  | { type: "decision"; decision: Decision }
  | { type: "risk"; paused: boolean; riskState: "paused" | "degraded" | "normal"; halted: Pair[] }
  | { type: "takerTier"; address: Address; tier: TierName; score: number }
  | { type: "params"; ts: number; changed: string[] }
  | { type: "arena"; arena: Omit<ReturnType<Engine["arenaView"]>, "series"> }
  | { type: "diagnosis"; diagnosis: LossAttributionResult }
  | { type: "policies"; policies: PolicySummary[] }
  | {
      type: "policy_stats";
      policyId: string;
      observedFills: number;
      observedPnlUsd: number;
      counterfactualFills: number;
      counterfactualPnlUsd: number;
      drawdownPct: number;
      fillRateDrop: number;
    };

export interface EngineDeps {
  chainId: 177 | 133;
  params: Params;
  tokens: Tokens;
  store: Store;
  signer: LocalAccount;
  emit?: (frame: Frame) => void;
  random?: () => number;
  onDecision?: (decision: Decision) => void;
  operator?: Address | null;
  dataSource?: "live" | "replay";
<<<<<<< HEAD
  policy?: Policy;
  mandate?: unknown;
||||||| 94d6717
=======
  live?: LiveVault;
  /** Why ENGINE_MODE=live was refused. The engine runs in shadow and reports these. */
  liveBlocked?: string[];
>>>>>>> a6cc28d17a97636cf089a066d80f0999d06993b3
}

export interface Market {
  venues: Map<string, VenueState>;
  fused: Fused;
  vol: Volatility;
  updatedAt: number | null;
  history: { t: number; mid: number; sources?: Record<string, number> }[];
  venueHistory: Partial<Record<VenueId, VenueSample[]>>;
}

export interface Issued {
  id: string;
  policyId: string;
  pair: Pair;
  side: Side;
  quote: SignedQuote;
  mid: number;
  expiresAtMs: number;
  record: QuoteRecord;
}
