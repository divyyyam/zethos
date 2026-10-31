import type { Pair, Side, VenueId } from "../config";
import type { Fill } from "../db";
import { PAIR_TOKENS, type Tokens, units } from "../tokens";

export const LOSS_CAUSES = [
  "stale_reference",
  "inventory_imbalance",
  "selective_execution",
  "adverse_size",
] as const;

export type LossCause = (typeof LOSS_CAUSES)[number];

const UINT256_MAX = 2n ** 256n - 1n;

export interface AnalysisWindow {
  /** Inclusive lower Unix timestamp (ms). */
  fromTs: number;
  /** Inclusive upper Unix timestamp (ms). */
  toTs: number;
}

export interface AttributionThresholds {
  staleReferenceBps?: number | undefined;
  selectiveLatenessRatio?: number | undefined;
  selectiveFavorableMoveBps?: number | undefined;
  adverseSizeUsd?: number | undefined;
  inventoryMax5sLossBps?: number | undefined;
  inventoryMin300sLossBps?: number | undefined;
  staleMs?: number | undefined;
  minLossUsd?: number | undefined;
  overlapStrategy?: ("proportional" | "priority") | undefined;
  causePriority?: readonly LossCause[] | undefined;
}

export interface AttributionQuote {
  id: string;
  issuedAt: string | number;
  expiry: string | number;
  ref?: number | undefined;
  midAtQuote?: number | undefined;
}

export interface AttributionLeadPrice {
  venue: VenueId | string;
  pair: Pair;
  ts: number;
  mid: number;
  status?: ("ok" | "degraded" | "down" | "stale") | undefined;
}

export interface AttributionInventorySnapshot {
  baseShare: number;
  targetShare: number;
}

export interface LossAttributionInput {
  /** Explicit analysis window (inclusive ms). */
  window: AnalysisWindow;
  /** Fills to analyze. */
  fills: readonly Fill[];
  /** Matched quote records or timings for selective execution checks. */
  quotes?: readonly AttributionQuote[] | Record<string, AttributionQuote> | undefined;
  /** Lead venue price observations at or before fill times for stale reference checks. */
  leadPrices?: readonly AttributionLeadPrice[] | undefined;
  /** Configured lead venues per pair. Defaults to HashKey Global for HSK/USDT, Binance for ETH/USDT. */
  leadVenues?: Partial<Record<Pair, readonly string[]>> | undefined;
  /** Inventory snapshots per fill ID, required for inventory_imbalance diagnosis. */
  inventorySnapshots?: Record<string, AttributionInventorySnapshot> | undefined;
  /** Runtime token decimals required for valuation. Fills without metadata are excluded. */
  tokens?: Tokens | undefined;
  /** Configurable diagnosis thresholds. */
  thresholds?: AttributionThresholds | undefined;
}

export interface CauseAttribution {
  usd: number;
  share: number;
  fillCount: number;
  exampleFillIds: string[];
}

export interface ExcludedFillRecord {
  fillId: string;
  reason: string;
}

export interface FillLossAttributionDetail {
  fillId: string;
  quoteId: string;
  ts: number;
  pair: Pair;
  side: Side;
  notionalUsd: number;
  lossUsd: number;
  rawAmountIn: string;
  rawAmountOut: string;
  matchedCauses: LossCause[];
  attributedUsd: Record<LossCause, number>;
  unclassifiedUsd: number;
  evidence: {
    staleReference?:
      | {
          divergenceBps: number;
          leadVenue: string;
          leadMid: number;
          fusedMid: number;
        }
      | undefined;
    inventoryImbalance?:
      | {
          bps5?: number | undefined;
          bps300?: number | undefined;
          loss5Usd?: number | undefined;
          loss300Usd?: number | undefined;
          baseShare?: number | undefined;
          targetShare?: number | undefined;
        }
      | undefined;
    selectiveExecution?:
      | {
          lateness: number;
          quoteIssuedAt: string;
          quoteExpiry: string;
          favorableMoveBps: number;
        }
      | undefined;
    adverseSize?:
      | {
          notionalUsd: number;
          thresholdUsd: number;
        }
      | undefined;
  };
  explanation?: string | undefined;
}

export interface LossAttributionResult {
  window: AnalysisWindow;
  totalLossUsd: number;
  analyzedLossUsd: number;
  unclassifiedLossUsd: number;
  causes: Record<LossCause, CauseAttribution>;
  unclassified: CauseAttribution;
  excludedFills: ExcludedFillRecord[];
  breakdown: FillLossAttributionDetail[];
}

const DEFAULT_LEAD_VENUES: Record<Pair, readonly string[]> = {
  "HSK/USDT": ["hashkey-global"],
  "ETH/USDT": ["binance", "okx"],
};

const DEFAULT_PRIORITY: readonly LossCause[] = [
  "stale_reference",
  "selective_execution",
  "adverse_size",
  "inventory_imbalance",
];

function normalizeTimestampMs(val: string | number): number {
  const n = typeof val === "string" ? Number(val) : val;
  if (!Number.isFinite(n)) return 0;
  // If in seconds (< 1e11), convert to ms
  return n < 1e11 ? n * 1000 : n;
}

function emptyCauseRecord(): Record<LossCause, CauseAttribution> {
  return {
    stale_reference: { usd: 0, share: 0, fillCount: 0, exampleFillIds: [] },
    inventory_imbalance: { usd: 0, share: 0, fillCount: 0, exampleFillIds: [] },
    selective_execution: { usd: 0, share: 0, fillCount: 0, exampleFillIds: [] },
    adverse_size: { usd: 0, share: 0, fillCount: 0, exampleFillIds: [] },
  };
}

export function validateAttributionThresholds(thresholds: AttributionThresholds): void {
  const checkPositive = (val: number | undefined, name: string) => {
    if (val !== undefined && (!Number.isFinite(val) || val <= 0)) {
      throw new Error(`Threshold ${name} must be a positive finite number`);
    }
  };
  const checkNonNegative = (val: number | undefined, name: string) => {
    if (val !== undefined && (!Number.isFinite(val) || val < 0)) {
      throw new Error(`Threshold ${name} must be a non-negative finite number`);
    }
  };
  checkPositive(thresholds.staleReferenceBps, "staleReferenceBps");
  checkPositive(thresholds.selectiveFavorableMoveBps, "selectiveFavorableMoveBps");
  checkPositive(thresholds.adverseSizeUsd, "adverseSizeUsd");
  checkNonNegative(thresholds.inventoryMax5sLossBps, "inventoryMax5sLossBps");
  checkPositive(thresholds.inventoryMin300sLossBps, "inventoryMin300sLossBps");
  checkPositive(thresholds.staleMs, "staleMs");
  checkNonNegative(thresholds.minLossUsd, "minLossUsd");
  if (
    thresholds.selectiveLatenessRatio !== undefined &&
    (!Number.isFinite(thresholds.selectiveLatenessRatio) ||
      thresholds.selectiveLatenessRatio < 0 ||
      thresholds.selectiveLatenessRatio > 1)
  ) {
    throw new Error("Threshold selectiveLatenessRatio must be between 0 and 1 inclusive");
  }
}

interface FillValidationSuccess {
  notionalUsd: number;
  fillLossUsd: number;
  loss5Usd: number | undefined;
  loss300Usd: number | undefined;
  bps5: number | undefined;
  bps300: number | undefined;
}

type FillValidationResult =
  | { status: "skip" }
  | { status: "excluded"; reason: string }
  | { status: "valid"; data: FillValidationSuccess };

function evaluateFillEligibility(
  fill: Fill,
  window: AnalysisWindow,
  tokens: Tokens | undefined,
  minLossUsd: number,
): FillValidationResult {
  if (fill.ts < window.fromTs || fill.ts > window.toTs) {
    return { status: "skip" };
  }

  if (!Number.isFinite(fill.ts) || !Number.isFinite(fill.price) || fill.price <= 0) {
    return {
      status: "excluded",
      reason: "Non-finite or non-positive fill price/timestamp",
    };
  }

  const pairConfig = PAIR_TOKENS[fill.pair];
  if (!pairConfig) {
    return {
      status: "excluded",
      reason: `Unsupported pair '${fill.pair}'`,
    };
  }

  const quoteToken = tokens?.[pairConfig.quote];
  const baseToken = tokens?.[pairConfig.base];
  if (
    !quoteToken ||
    !baseToken ||
    typeof quoteToken.decimals !== "number" ||
    typeof baseToken.decimals !== "number"
  ) {
    return {
      status: "excluded",
      reason: `Missing runtime token metadata for pair '${fill.pair}' valuation`,
    };
  }

  let notionalUsd: number;
  try {
    const rawIn = BigInt(fill.amountIn);
    const rawOut = BigInt(fill.amountOut);
    if (rawIn <= 0n || rawOut <= 0n || rawIn > UINT256_MAX || rawOut > UINT256_MAX) {
      throw new Error("Out of uint256 range");
    }
    if (fill.side === "buy") {
      notionalUsd = units(rawIn, quoteToken.decimals);
    } else {
      notionalUsd = units(rawOut, quoteToken.decimals);
    }
  } catch {
    return {
      status: "excluded",
      reason: "Invalid raw token amounts",
    };
  }

  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    return {
      status: "excluded",
      reason: "Non-positive or non-finite notional USD",
    };
  }

  const markouts = fill.markouts ?? {};
  const bps5 = markouts["5"] ?? (markouts[5 as unknown as string] as number | undefined);
  const bps300 = markouts["300"] ?? (markouts[300 as unknown as string] as number | undefined);

  if (bps5 === undefined && bps300 === undefined) {
    return {
      status: "excluded",
      reason: "Missing markout observations (both 5s and 300s missing)",
    };
  }

  const loss5Usd = bps5 !== undefined ? Math.max(0, (-bps5 / 10000) * notionalUsd) : undefined;
  const loss300Usd =
    bps300 !== undefined ? Math.max(0, (-bps300 / 10000) * notionalUsd) : undefined;

  const fillLossUsd = Math.max(loss5Usd ?? 0, loss300Usd ?? 0);
  if (fillLossUsd < minLossUsd) {
    return { status: "skip" };
  }

  return {
    status: "valid",
    data: {
      notionalUsd,
      fillLossUsd,
      loss5Usd,
      loss300Usd,
      bps5,
      bps300,
    },
  };
}

function checkStaleReferenceCause(
  fill: Fill,
  leadPrices: AttributionLeadPrice[],
  configuredLeads: readonly string[],
  staleMs: number,
  staleReferenceBps: number,
): FillLossAttributionDetail["evidence"]["staleReference"] | undefined {
  const candidateLead = leadPrices
    .filter(
      (p) =>
        configuredLeads.includes(p.venue) &&
        p.ts <= fill.ts &&
        fill.ts - p.ts <= staleMs &&
        Number.isFinite(p.mid) &&
        p.mid > 0 &&
        (p.status === undefined || p.status === "ok"),
    )
    .sort((a, b) => fill.ts - a.ts - (fill.ts - b.ts))[0];

  const fusedMidAtFill = fill.midAtFill;
  if (!candidateLead || !fusedMidAtFill || fusedMidAtFill <= 0) return undefined;

  const divergenceBps =
    fill.side === "buy"
      ? ((candidateLead.mid - fusedMidAtFill) / fusedMidAtFill) * 10000
      : ((fusedMidAtFill - candidateLead.mid) / fusedMidAtFill) * 10000;

  if (divergenceBps >= staleReferenceBps) {
    return {
      divergenceBps,
      leadVenue: candidateLead.venue,
      leadMid: candidateLead.mid,
      fusedMid: fusedMidAtFill,
    };
  }
  return undefined;
}

function checkSelectiveExecutionCause(
  fill: Fill,
  matchedQuote: AttributionQuote | undefined,
  selectiveLatenessRatio: number,
  selectiveFavorableMoveBps: number,
): FillLossAttributionDetail["evidence"]["selectiveExecution"] | undefined {
  if (!matchedQuote) return undefined;

  const issuedAtMs = normalizeTimestampMs(matchedQuote.issuedAt);
  const rawExpiry =
    typeof matchedQuote.expiry === "string" ? Number(matchedQuote.expiry) : matchedQuote.expiry;
  const expiryMs = rawExpiry < 1e11 ? rawExpiry * 1000 + 999 : rawExpiry;
  const ttlMs = expiryMs - issuedAtMs;

  if (ttlMs <= 0 || fill.ts < issuedAtMs || fill.ts > expiryMs) return undefined;

  const lateness = (fill.ts - issuedAtMs) / ttlMs;
  if (lateness < selectiveLatenessRatio) return undefined;

  const refPrice = matchedQuote.ref ?? matchedQuote.midAtQuote;
  const fusedMidAtFill = fill.midAtFill;
  if (!fusedMidAtFill || refPrice === undefined || !Number.isFinite(refPrice) || refPrice <= 0) {
    return undefined;
  }

  const favorableMoveBps =
    fill.side === "buy"
      ? ((fusedMidAtFill - refPrice) / refPrice) * 10000
      : ((refPrice - fusedMidAtFill) / refPrice) * 10000;

  if (favorableMoveBps >= selectiveFavorableMoveBps) {
    return {
      lateness,
      quoteIssuedAt: String(matchedQuote.issuedAt),
      quoteExpiry: String(matchedQuote.expiry),
      favorableMoveBps,
    };
  }
  return undefined;
}

function checkInventoryImbalanceCause(
  fill: Fill,
  snapshot: AttributionInventorySnapshot | undefined,
  bps5: number | undefined,
  bps300: number | undefined,
  loss5Usd: number | undefined,
  loss300Usd: number | undefined,
  inventoryMax5sLossBps: number,
  inventoryMin300sLossBps: number,
): FillLossAttributionDetail["evidence"]["inventoryImbalance"] | undefined {
  const hasInventoryEvidence =
    snapshot !== undefined &&
    Number.isFinite(snapshot.baseShare) &&
    Number.isFinite(snapshot.targetShare);

  const isInventoryAdverse =
    hasInventoryEvidence &&
    ((fill.side === "sell" && snapshot.baseShare > snapshot.targetShare) ||
      (fill.side === "buy" && snapshot.baseShare < snapshot.targetShare));

  const hasBothMarkouts =
    bps5 !== undefined && bps300 !== undefined && Number.isFinite(bps5) && Number.isFinite(bps300);

  const is5sBenign = hasBothMarkouts && bps5 >= -inventoryMax5sLossBps;
  const is300sLosing =
    hasBothMarkouts && bps300 < -inventoryMin300sLossBps && (loss300Usd ?? 0) > (loss5Usd ?? 0);

  if (isInventoryAdverse && is5sBenign && is300sLosing) {
    return {
      bps5,
      bps300,
      loss5Usd,
      loss300Usd,
      baseShare: snapshot.baseShare,
      targetShare: snapshot.targetShare,
    };
  }
  return undefined;
}

function allocateLossBetweenCauses(
  fillId: string,
  fillLossUsd: number,
  matchedCauses: LossCause[],
  overlapStrategy: "proportional" | "priority",
  causePriority: readonly LossCause[],
  causes: Record<LossCause, CauseAttribution>,
  unclassified: CauseAttribution,
): { attributedUsd: Record<LossCause, number>; unclassifiedFillUsd: number } {
  const attributedUsd: Record<LossCause, number> = {
    stale_reference: 0,
    inventory_imbalance: 0,
    selective_execution: 0,
    adverse_size: 0,
  };
  let unclassifiedFillUsd = 0;

  if (matchedCauses.length === 0) {
    unclassifiedFillUsd = fillLossUsd;
    unclassified.usd += fillLossUsd;
    unclassified.fillCount += 1;
    if (unclassified.exampleFillIds.length < 10) {
      unclassified.exampleFillIds.push(fillId);
    }
  } else if (overlapStrategy === "proportional") {
    const sharePerCause = fillLossUsd / matchedCauses.length;
    for (const cause of matchedCauses) {
      attributedUsd[cause] = sharePerCause;
      causes[cause].usd += sharePerCause;
      causes[cause].fillCount += 1;
      if (
        !causes[cause].exampleFillIds.includes(fillId) &&
        causes[cause].exampleFillIds.length < 10
      ) {
        causes[cause].exampleFillIds.push(fillId);
      }
    }
  } else {
    const primaryCause: LossCause =
      causePriority.find((c) => matchedCauses.includes(c)) ?? matchedCauses[0] ?? "stale_reference";
    attributedUsd[primaryCause] = fillLossUsd;
    causes[primaryCause].usd += fillLossUsd;
    causes[primaryCause].fillCount += 1;
    if (
      !causes[primaryCause].exampleFillIds.includes(fillId) &&
      causes[primaryCause].exampleFillIds.length < 10
    ) {
      causes[primaryCause].exampleFillIds.push(fillId);
    }
  }

  return { attributedUsd, unclassifiedFillUsd };
}

/**
 * Pure, deterministic loss attribution function.
 * Evaluates losing fills against the four frozen S6 evidence criteria without double-counting.
 *
 * NOTE: Diagnosed USD measures markout loss against fused mid at analytical horizons (5s / 300s),
 * NOT realized desk operating P&L (which includes earned spread capture, inventory drift, and gas costs).
 * Do not conflate analytical markout diagnosis with desk operating P&L.
 */
export function attributeLosses(input: LossAttributionInput): LossAttributionResult {
  const { window, fills, inventorySnapshots = {}, tokens, thresholds = {} } = input;

  validateAttributionThresholds(thresholds);

  const staleReferenceBps = thresholds.staleReferenceBps ?? 5.0;
  const selectiveLatenessRatio = thresholds.selectiveLatenessRatio ?? 0.6;
  const selectiveFavorableMoveBps = thresholds.selectiveFavorableMoveBps ?? 2.0;
  const adverseSizeUsd = thresholds.adverseSizeUsd ?? 10000;
  const inventoryMax5sLossBps = thresholds.inventoryMax5sLossBps ?? 3.0;
  const inventoryMin300sLossBps = thresholds.inventoryMin300sLossBps ?? 5.0;
  const staleMs = thresholds.staleMs ?? 5000;
  const minLossUsd = thresholds.minLossUsd ?? 0.01;
  const overlapStrategy = thresholds.overlapStrategy ?? "proportional";
  const causePriority = thresholds.causePriority ?? DEFAULT_PRIORITY;

  // Build quotes map
  const quotesMap = new Map<string, AttributionQuote>();
  if (Array.isArray(input.quotes)) {
    for (const q of input.quotes) quotesMap.set(q.id, q);
  } else if (input.quotes) {
    for (const [id, q] of Object.entries(input.quotes)) quotesMap.set(id, q);
  }

  // Group lead prices by pair
  const leadPricesByPair = new Map<Pair, AttributionLeadPrice[]>();
  for (const lp of input.leadPrices ?? []) {
    const list = leadPricesByPair.get(lp.pair) ?? [];
    list.push(lp);
    leadPricesByPair.set(lp.pair, list);
  }

  const causes = emptyCauseRecord();
  const unclassified: CauseAttribution = {
    usd: 0,
    share: 0,
    fillCount: 0,
    exampleFillIds: [],
  };
  const excludedFills: ExcludedFillRecord[] = [];
  const breakdown: FillLossAttributionDetail[] = [];

  let totalLossUsd = 0;
  let analyzedLossUsd = 0;

  for (const fill of fills) {
    const eligibility = evaluateFillEligibility(fill, window, tokens, minLossUsd);
    if (eligibility.status === "skip") continue;
    if (eligibility.status === "excluded") {
      excludedFills.push({ fillId: fill.id, reason: eligibility.reason });
      continue;
    }

    const { notionalUsd, fillLossUsd, loss5Usd, loss300Usd, bps5, bps300 } = eligibility.data;

    totalLossUsd += fillLossUsd;
    analyzedLossUsd += fillLossUsd;

    const matchedCauses: LossCause[] = [];
    const evidence: FillLossAttributionDetail["evidence"] = {};

    // 1. Evidence: stale_reference
    const configuredLeads = input.leadVenues?.[fill.pair] ?? DEFAULT_LEAD_VENUES[fill.pair] ?? [];
    const pairLeads = leadPricesByPair.get(fill.pair) ?? [];
    const staleRef = checkStaleReferenceCause(
      fill,
      pairLeads,
      configuredLeads,
      staleMs,
      staleReferenceBps,
    );
    if (staleRef) {
      matchedCauses.push("stale_reference");
      evidence.staleReference = staleRef;
    }

    // 2. Evidence: selective_execution
    const selectiveExec = checkSelectiveExecutionCause(
      fill,
      quotesMap.get(fill.quoteId),
      selectiveLatenessRatio,
      selectiveFavorableMoveBps,
    );
    if (selectiveExec) {
      matchedCauses.push("selective_execution");
      evidence.selectiveExecution = selectiveExec;
    }

    // 3. Evidence: adverse_size
    if (notionalUsd >= adverseSizeUsd) {
      matchedCauses.push("adverse_size");
      evidence.adverseSize = {
        notionalUsd,
        thresholdUsd: adverseSizeUsd,
      };
    }

    // 4. Evidence: inventory_imbalance
    const inventoryImb = checkInventoryImbalanceCause(
      fill,
      inventorySnapshots[fill.id],
      bps5,
      bps300,
      loss5Usd,
      loss300Usd,
      inventoryMax5sLossBps,
      inventoryMin300sLossBps,
    );
    if (inventoryImb) {
      matchedCauses.push("inventory_imbalance");
      evidence.inventoryImbalance = inventoryImb;
    }

    // Allocate fill loss among causes without double-counting
    const { attributedUsd, unclassifiedFillUsd } = allocateLossBetweenCauses(
      fill.id,
      fillLossUsd,
      matchedCauses,
      overlapStrategy,
      causePriority,
      causes,
      unclassified,
    );

    breakdown.push({
      fillId: fill.id,
      quoteId: fill.quoteId,
      ts: fill.ts,
      pair: fill.pair,
      side: fill.side,
      notionalUsd,
      lossUsd: fillLossUsd,
      rawAmountIn: fill.amountIn,
      rawAmountOut: fill.amountOut,
      matchedCauses,
      attributedUsd,
      unclassifiedUsd: unclassifiedFillUsd,
      evidence,
      explanation:
        matchedCauses.length === 0
          ? "No matching cause criteria met based on available observations"
          : undefined,
    });
  }

  // Calculate shares using totalAnalyzedLossUsd as denominator
  if (analyzedLossUsd > 0) {
    for (const cause of LOSS_CAUSES) {
      causes[cause].share = causes[cause].usd / analyzedLossUsd;
    }
    unclassified.share = unclassified.usd / analyzedLossUsd;
  }

  return {
    window,
    totalLossUsd,
    analyzedLossUsd,
    unclassifiedLossUsd: unclassified.usd,
    causes,
    unclassified,
    excludedFills,
    breakdown,
  };
}
