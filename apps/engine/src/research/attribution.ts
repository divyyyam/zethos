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

export interface AnalysisWindow {
  /** Inclusive lower Unix timestamp (ms). */
  fromTs: number;
  /** Inclusive upper Unix timestamp (ms). */
  toTs: number;
}

export interface AttributionThresholds {
  /**
   * Adverse divergence in basis points between lead venue and fused mid at fill time
   * required to classify as stale_reference. Default: 5.0 bps.
   */
  staleReferenceBps?: number;
  /**
   * Fraction of quote TTL (0..1) that must have elapsed before fill to be considered late.
   * Default: 0.60 (60% into quote lifetime).
   */
  selectiveLatenessRatio?: number;
  /**
   * Adverse market move in basis points during quote lifetime required for selective execution.
   * Default: 2.0 bps.
   */
  selectiveFavorableMoveBps?: number;
  /**
   * Notional USD threshold at or above which a fill is considered adverse size.
   * Default: 10,000 USD.
   */
  adverseSizeUsd?: number;
  /**
   * Maximum 5-second markout loss in basis points for an inventory imbalance diagnosis.
   * A loss that comes from residual inventory, not the 5s markout, must have a benign
   * or small 5s markout loss. Default: 3.0 bps.
   */
  inventoryMax5sLossBps?: number;
  /**
   * Minimum 300-second markout loss in basis points for inventory imbalance diagnosis.
   * Default: 5.0 bps.
   */
  inventoryMin300sLossBps?: number;
  /**
   * Maximum acceptable age/lead-time in milliseconds for venue prices around fill.
   * Default: 5,000 ms.
   */
  staleMs?: number;
  /**
   * Minimum fill loss in USD to be attributed. Smaller losses or profitable fills are ignored.
   * Default: 0.01 USD.
   */
  minLossUsd?: number;
  /**
   * Strategy for dividing loss when multiple causes are diagnosed:
   * - 'proportional': split fill loss equally among all matching causes (default).
   * - 'priority': attribute 100% of fill loss to the highest priority cause.
   */
  overlapStrategy?: "proportional" | "priority";
  /**
   * Priority ordering when overlapStrategy is 'priority'.
   * Default: ['stale_reference', 'selective_execution', 'adverse_size', 'inventory_imbalance'].
   */
  causePriority?: readonly LossCause[];
}

export interface AttributionQuote {
  id: string;
  issuedAt: string | number;
  expiry: string | number;
  ref?: number;
  midAtQuote?: number;
}

export interface AttributionLeadPrice {
  venue: VenueId | string;
  pair: Pair;
  ts: number;
  mid: number;
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
  quotes?: readonly AttributionQuote[] | Record<string, AttributionQuote>;
  /** Lead venue price observations around fill times for stale reference checks. */
  leadPrices?: readonly AttributionLeadPrice[];
  /** Configured lead venues per pair. Defaults to HashKey Global for HSK/USDT, Binance for ETH/USDT. */
  leadVenues?: Partial<Record<Pair, readonly string[]>>;
  /** Inventory snapshots per fill ID, if available. */
  inventorySnapshots?: Record<string, AttributionInventorySnapshot>;
  /** Runtime token decimals for exact raw amount conversion. */
  tokens?: Tokens;
  /** Configurable diagnosis thresholds. */
  thresholds?: AttributionThresholds;
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
  // If in seconds (e.g. Unix seconds < 1e11), convert to ms
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

/**
 * Pure, deterministic loss attribution function.
 * Evaluates losing fills against the four frozen S6 evidence criteria without double-counting.
 */
export function attributeLosses(input: LossAttributionInput): LossAttributionResult {
  const { window, fills, inventorySnapshots = {}, tokens, thresholds = {} } = input;

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
    // Window check
    if (fill.ts < window.fromTs || fill.ts > window.toTs) {
      continue;
    }

    // Valuation check
    const pairConfig = PAIR_TOKENS[fill.pair];
    const quoteDecimals = tokens ? tokens[pairConfig.quote].decimals : 6;

    let notionalUsd: number;
    try {
      if (fill.side === "buy") {
        notionalUsd = units(BigInt(fill.amountIn), quoteDecimals);
      } else {
        notionalUsd = units(BigInt(fill.amountOut), quoteDecimals);
      }
    } catch {
      excludedFills.push({
        fillId: fill.id,
        reason: "Invalid raw token amounts",
      });
      continue;
    }

    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
      excludedFills.push({
        fillId: fill.id,
        reason: "Non-positive or non-finite notional USD",
      });
      continue;
    }

    // Determine markouts
    const markouts = fill.markouts ?? {};
    const bps5 = markouts["5"] ?? (markouts[5 as unknown as string] as number | undefined);
    const bps300 = markouts["300"] ?? (markouts[300 as unknown as string] as number | undefined);

    if (bps5 === undefined && bps300 === undefined) {
      excludedFills.push({
        fillId: fill.id,
        reason: "Missing markout observations (both 5s and 300s missing)",
      });
      continue;
    }

    // Compute maker loss on each available horizon
    // Negative markout bps = maker loss (bps < 0 => -bps > 0)
    const loss5Usd = bps5 !== undefined ? Math.max(0, (-bps5 / 10000) * notionalUsd) : undefined;
    const loss300Usd =
      bps300 !== undefined ? Math.max(0, (-bps300 / 10000) * notionalUsd) : undefined;

    // Effective loss for attribution
    const fillLossUsd = Math.max(loss5Usd ?? 0, loss300Usd ?? 0);

    // If fill was profitable or loss is below threshold, skip attribution
    if (fillLossUsd < minLossUsd) {
      continue;
    }

    totalLossUsd += fillLossUsd;
    analyzedLossUsd += fillLossUsd;

    const matchedCauses: LossCause[] = [];
    const evidence: FillLossAttributionDetail["evidence"] = {};

    // 1. Evidence: stale_reference
    // Check if lead venue had moved beyond fused mid at fill time
    const configuredLeads = input.leadVenues?.[fill.pair] ?? DEFAULT_LEAD_VENUES[fill.pair] ?? [];
    const pairLeads = leadPricesByPair.get(fill.pair) ?? [];
    const candidateLead = pairLeads
      .filter(
        (p) =>
          configuredLeads.includes(p.venue) &&
          Math.abs(p.ts - fill.ts) <= staleMs &&
          Number.isFinite(p.mid) &&
          p.mid > 0,
      )
      .sort((a, b) => Math.abs(a.ts - fill.ts) - Math.abs(b.ts - fill.ts))[0];

    const fusedMidAtFill = fill.midAtFill;
    if (candidateLead && fusedMidAtFill && fusedMidAtFill > 0) {
      // Adverse movement:
      // For buy: taker bought base. Adverse to maker if lead price was higher than fused mid.
      // For sell: taker sold base. Adverse to maker if lead price was lower than fused mid.
      const divergenceBps =
        fill.side === "buy"
          ? ((candidateLead.mid - fusedMidAtFill) / fusedMidAtFill) * 10000
          : ((fusedMidAtFill - candidateLead.mid) / fusedMidAtFill) * 10000;

      if (divergenceBps >= staleReferenceBps) {
        matchedCauses.push("stale_reference");
        evidence.staleReference = {
          divergenceBps,
          leadVenue: candidateLead.venue,
          leadMid: candidateLead.mid,
          fusedMid: fusedMidAtFill,
        };
      }
    }

    // 2. Evidence: selective_execution
    // Check if fill came late in quote's life right after a favourable move
    const matchedQuote = quotesMap.get(fill.quoteId);
    if (matchedQuote) {
      const issuedAtMs = normalizeTimestampMs(matchedQuote.issuedAt);
      const expiryMs = normalizeTimestampMs(matchedQuote.expiry);
      const ttlMs = expiryMs - issuedAtMs;

      if (ttlMs > 0) {
        const lateness = (fill.ts - issuedAtMs) / ttlMs;
        if (lateness >= selectiveLatenessRatio) {
          // Check for favourable move to taker (adverse to maker) between quote and fill
          const refPrice = matchedQuote.ref ?? matchedQuote.midAtQuote ?? fill.price;
          if (fusedMidAtFill && refPrice > 0) {
            const favorableMoveBps =
              fill.side === "buy"
                ? ((fusedMidAtFill - refPrice) / refPrice) * 10000
                : ((refPrice - fusedMidAtFill) / refPrice) * 10000;

            if (favorableMoveBps >= selectiveFavorableMoveBps) {
              matchedCauses.push("selective_execution");
              evidence.selectiveExecution = {
                lateness,
                quoteIssuedAt: String(matchedQuote.issuedAt),
                quoteExpiry: String(matchedQuote.expiry),
                favorableMoveBps,
              };
            }
          }
        }
      }
    }

    // 3. Evidence: adverse_size
    // Check if fill notional exceeds the large-size threshold
    if (notionalUsd >= adverseSizeUsd) {
      matchedCauses.push("adverse_size");
      evidence.adverseSize = {
        notionalUsd,
        thresholdUsd: adverseSizeUsd,
      };
    }

    // 4. Evidence: inventory_imbalance
    // "the loss comes from residual inventory, not the 5 s markout."
    const snapshot = inventorySnapshots[fill.id];
    const isInventoryAdverse = snapshot
      ? (fill.side === "sell" && snapshot.baseShare > snapshot.targetShare) ||
        (fill.side === "buy" && snapshot.baseShare < snapshot.targetShare)
      : true; // If snapshot is absent, infer from markout structure

    const is5sBenign =
      bps5 === undefined ||
      bps5 >= -inventoryMax5sLossBps ||
      (loss5Usd !== undefined && loss300Usd !== undefined && loss5Usd <= 0.5 * loss300Usd);

    const is300sLosing =
      bps300 !== undefined &&
      bps300 < -inventoryMin300sLossBps &&
      (loss300Usd ?? 0) > (loss5Usd ?? 0);

    if (isInventoryAdverse && is5sBenign && is300sLosing) {
      matchedCauses.push("inventory_imbalance");
      evidence.inventoryImbalance = {
        bps5,
        bps300,
        loss5Usd,
        loss300Usd,
        baseShare: snapshot?.baseShare,
        targetShare: snapshot?.targetShare,
      };
    }

    // Allocate fill loss among causes without double-counting
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
        unclassified.exampleFillIds.push(fill.id);
      }
    } else if (overlapStrategy === "proportional") {
      const sharePerCause = fillLossUsd / matchedCauses.length;
      for (const cause of matchedCauses) {
        attributedUsd[cause] = sharePerCause;
        causes[cause].usd += sharePerCause;
        causes[cause].fillCount += 1;
        if (
          !causes[cause].exampleFillIds.includes(fill.id) &&
          causes[cause].exampleFillIds.length < 10
        ) {
          causes[cause].exampleFillIds.push(fill.id);
        }
      }
    } else {
      // Priority strategy: attribute 100% to the highest-priority matching cause
      const primaryCause: LossCause =
        causePriority.find((c) => matchedCauses.includes(c)) ??
        matchedCauses[0] ??
        "stale_reference";
      attributedUsd[primaryCause] = fillLossUsd;
      causes[primaryCause].usd += fillLossUsd;
      causes[primaryCause].fillCount += 1;
      if (
        !causes[primaryCause].exampleFillIds.includes(fill.id) &&
        causes[primaryCause].exampleFillIds.length < 10
      ) {
        causes[primaryCause].exampleFillIds.push(fill.id);
      }
    }

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
