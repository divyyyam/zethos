import type { Pair, Side, TierName, VenueId } from "../config";
import type { Health, Level, SourceStatus } from "../feeds/types";

export interface VenueSample {
  t: number;
  mid: number;
  bidDepthUsd: number;
  askDepthUsd: number;
}

export interface PolicyMarketState {
  now: number;
  pair: Pair;
  fused: { mid: number; health: Health; sourceCount: number; sigma1: number };
  venues: {
    venue: VenueId;
    mid: number | null;
    bidDepthUsd: number;
    askDepthUsd: number;
    receivedAt: number;
    status: SourceStatus;
  }[];
  history: Partial<Record<VenueId, VenueSample[]>>;
  book: { bids: Level[]; asks: Level[] };
  tuner: number;
}

export interface PolicyInventory {
  base: { raw: string; usd: number };
  quote: { raw: string; usd: number };
  baseShare: number;
  targetShare: number;
  reserved?: { base: string; quote: string };
  available?: { base: string; quote: string };
  utilization?: number;
}

export interface PolicyRequest {
  pair: Pair;
  side: Side;
  amountIn: string;
  baseQuantity: number;
  notionalUsd: number;
  tier: Exclude<TierName, "blocked">;
  score: number;
}

export const POLICY_REJECTIONS = [
  "halted",
  "degraded_reject",
  "lead_divergence",
  "size",
  "inventory",
  "policy_rule",
  "insufficient_reference_depth",
] as const;

export interface PolicyQuote {
  kind: "quote";
  price: number;
  ref: number;
  halfSpread: number;
  sigmaT: number;
  ttlSec: number;
  terms: Record<string, number>;
  feeBps?: number;
}

export type PolicyDecision =
  | PolicyQuote
  | { kind: "reject"; reason: (typeof POLICY_REJECTIONS)[number] };

export interface Policy {
  readonly id: string;
  decide(
    market: PolicyMarketState,
    inventory: PolicyInventory,
    request: PolicyRequest,
  ): PolicyDecision;
}
