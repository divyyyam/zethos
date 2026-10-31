import type { Address, Hex, LocalAccount } from "viem";
import type { Decision } from "../agent/types";
import type { Pair, Params, Side, TierName } from "../config";
import type { Fill, QuoteRecord, Store } from "../db";
import type { Engine } from "../engine";
import type { Fused, VenueState } from "../feeds/fuse";
import type { Health, Source } from "../feeds/types";
import type { Volatility } from "../feeds/vol";
import type { SignedQuote } from "../quotes";
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

export type Frame =
  | { type: "price"; pair: Pair; mid: number | null; health: Health; ts: number }
  | { type: "fill"; fill: Fill }
  | { type: "decision"; decision: Decision }
  | { type: "risk"; paused: boolean; riskState: "paused" | "degraded" | "normal"; halted: Pair[] }
  | { type: "takerTier"; address: Address; tier: TierName; score: number }
  | { type: "params"; ts: number; changed: string[] }
  | { type: "arena"; arena: Omit<ReturnType<Engine["arenaView"]>, "series"> };

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
}

export interface Market {
  venues: Map<string, VenueState>;
  fused: Fused;
  vol: Volatility;
  updatedAt: number | null;
  history: { t: number; mid: number; sources?: Record<string, number> }[];
}

export interface Issued {
  id: string;
  pair: Pair;
  side: Side;
  quote: SignedQuote;
  mid: number;
  expiresAtMs: number;
  record: QuoteRecord;
}
