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
    // Window check
    if (fill.ts < window.fromTs || fill.ts > window.toTs) {
      continue;
    }

    if (!Number.isFinite(fill.ts) || !Number.isFinite(fill.price) || fill.price <= 0) {
      excludedFills.push({
        fillId: fill.id,
        reason: "Non-finite or non-positive fill price/timestamp",
      });
      continue;
    }

    // Valuation check - NEVER fall back to 6 decimals silently
    const pairConfig = PAIR_TOKENS[fill.pair];
    if (!pairConfig) {
      excludedFills.push({
        fillId: fill.id,
        reason: `Unsupported pair '${fill.pair}'`,
      });
      continue;
    }

    const quoteToken = tokens?.[pairConfig.quote];
    const baseToken = tokens?.[pairConfig.base];
    if (
      !quoteToken ||
      !baseToken ||
      typeof quoteToken.decimals !== "number" ||
      typeof baseToken.decimals !== "number"
    ) {
      excludedFills.push({
        fillId: fill.id,
        reason: `Missing runtime token metadata for pair '${fill.pair}' valuation`,
      });
      continue;
    }

    const quoteDecimals = quoteToken.decimals;

    let notionalUsd: number;
    try {
      const rawIn = BigInt(fill.amountIn);
      const rawOut = BigInt(fill.amountOut);
      if (rawIn <= 0n || rawOut <= 0n || rawIn > UINT256_MAX || rawOut > UINT256_MAX) {
        throw new Error("Out of uint256 range");
      }
      if (fill.side === "buy") {
        notionalUsd = units(rawIn, quoteDecimals);
      } else {
        notionalUsd = units(rawOut, quoteDecimals);
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
    // Select lead samples strictly AT OR BEFORE fill time within freshness limits. Future samples cannot establish stale reference!
    const configuredLeads = input.leadVenues?.[fill.pair] ?? DEFAULT_LEAD_VENUES[fill.pair] ?? [];
    const pairLeads = leadPricesByPair.get(fill.pair) ?? [];
    const candidateLead = pairLeads
      .filter(
        (p) =>
          configuredLeads.includes(p.venue) &&
          p.ts <= fill.ts && // MUST BE AT OR BEFORE FILL TIME!
          fill.ts - p.ts <= staleMs && // Within freshness limit
          Number.isFinite(p.mid) &&
          p.mid > 0 &&
          (p.status === undefined || p.status === "ok"),
      )
      .sort((a, b) => fill.ts - a.ts - (fill.ts - b.ts))[0]; // Most recent past observation

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
      const rawExpiry =
        typeof matchedQuote.expiry === "string" ? Number(matchedQuote.expiry) : matchedQuote.expiry;
      // Inclusive expiry-second semantics: if expiry is in seconds (< 1e11), valid through the end of the second
      const expiryMs = rawExpiry < 1e11 ? rawExpiry * 1000 + 999 : rawExpiry;
      const ttlMs = expiryMs - issuedAtMs;

      // Fill must arrive during quote validity
      if (ttlMs > 0 && fill.ts >= issuedAtMs && fill.ts <= expiryMs) {
        const lateness = (fill.ts - issuedAtMs) / ttlMs;
        if (lateness >= selectiveLatenessRatio) {
          // MUST use genuine quote-time market evidence: ref or midAtQuote. NEVER fall back to fill.price!
          const refPrice = matchedQuote.ref ?? matchedQuote.midAtQuote;
          if (
            fusedMidAtFill &&
            refPrice !== undefined &&
            Number.isFinite(refPrice) &&
            refPrice > 0
          ) {
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
    // Must require actual inventory evidence
    const hasInventoryEvidence =
      snapshot !== undefined &&
      Number.isFinite(snapshot.baseShare) &&
      Number.isFinite(snapshot.targetShare);

    const isInventoryAdverse =
      hasInventoryEvidence &&
      ((fill.side === "sell" && snapshot.baseShare > snapshot.targetShare) ||
        (fill.side === "buy" && snapshot.baseShare < snapshot.targetShare));

    // Must require both relevant markouts
    const hasBothMarkouts =
      bps5 !== undefined &&
      bps300 !== undefined &&
      Number.isFinite(bps5) &&
      Number.isFinite(bps300);

    // 5s markout must be truly benign (bps5 >= -inventoryMax5sLossBps).
    // A large immediate loss cannot become benign merely because later loss is larger!
    const is5sBenign = hasBothMarkouts && bps5 >= -inventoryMax5sLossBps;

    const is300sLosing =
      hasBothMarkouts && bps300 < -inventoryMin300sLossBps && (loss300Usd ?? 0) > (loss5Usd ?? 0);

    if (isInventoryAdverse && is5sBenign && is300sLosing) {
      matchedCauses.push("inventory_imbalance");
      evidence.inventoryImbalance = {
        bps5,
        bps300,
        loss5Usd,
        loss300Usd,
        baseShare: snapshot.baseShare,
        targetShare: snapshot.targetShare,
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
