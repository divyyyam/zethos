import { z } from "zod";
import { defaultParams, type Pair, type Params, type TierName, type VenueId } from "../config";
import { baseShare } from "../engine/valuation";
import { fuse, midOf, vwap, vwapForQuote } from "../feeds/fuse";
import type { Book, Level } from "../feeds/types";
import { Volatility } from "../feeds/vol";
import { spreadCapture } from "../markouts";
import { enforceExecution } from "../policy/execution";
import { defaultMandate, type Mandate } from "../policy/mandate";
import type {
  Policy,
  PolicyDecision,
  PolicyInventory,
  PolicyMarketState,
  PolicyRequest,
  VenueSample,
} from "../policy/types";
import { createV0 } from "../policy/v0";
import { type Inventory, PAIR_TOKENS, type Tokens, toUnits, units } from "../tokens";
import { hashPolicySpec } from "./canonical";
import { compile } from "./compile";
import {
  HeldOutAccessError,
  type LoadedScenario,
  type ScenarioBookRecord,
  type ScenarioTakerRequestRecord,
} from "./scenarios";
import type { PolicySpec } from "./schema";

export const DEFAULT_EVAL_TOKENS: Tokens = {
  USDT: {
    symbol: "USDT",
    address: "0x2222222222222222222222222222222222222222",
    decimals: 6,
  },
  WHSK: {
    symbol: "WHSK",
    address: "0x3333333333333333333333333333333333333333",
    decimals: 18,
  },
  WETH: {
    symbol: "WETH",
    address: "0x4444444444444444444444444444444444444444",
    decimals: 18,
  },
};

export const policyResultsSchema = z.strictObject({
  netUsd: z.number().finite(),
  spreadCaptureUsd: z.number().finite(),
  inventoryPnlUsd: z.number().finite(),
  maxDrawdownPct: z.number().finite().min(0).max(1),
  avgHalfSpreadBps: z.number().finite().nonnegative(),
  honestFillRate: z.number().finite().min(0).max(1),
  rejectRate: z.number().finite().min(0).max(1),
  attackerTakeUsd: z.number().finite().nonnegative(),
  fills: z.number().int().nonnegative(),
});

export type PolicyResults = z.infer<typeof policyResultsSchema>;

export const qualificationReasonSchema = z.strictObject({
  rule: z.string().min(1),
  passed: z.boolean(),
  candidate: z.union([z.number(), z.boolean(), z.string()]),
  incumbent: z.union([z.number(), z.boolean(), z.string()]),
  threshold: z.union([z.number(), z.boolean(), z.string()]),
  detail: z.string().optional(),
});

export type QualificationReason = z.infer<typeof qualificationReasonSchema>;

export const datasetSummarySchema = z.strictObject({
  name: z.string().min(1),
  kind: z.enum(["dev", "scenario", "heldout"]),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
});

export type DatasetSummary = z.infer<typeof datasetSummarySchema>;

export const evaluationReportSchema = z.strictObject({
  candidateId: z.string().min(1),
  incumbentId: z.string().min(1),
  specHash: z.string().min(1),
  codeRevision: z.string().min(1),
  rulesVersion: z.string().min(1),
  seed: z.number().int(),
  createdAt: z.number().int().nonnegative(),
  datasets: z.array(datasetSummarySchema),
  results: z.record(
    z.string(),
    z.strictObject({
      candidate: policyResultsSchema,
      incumbent: policyResultsSchema,
    }),
  ),
  verdict: z.strictObject({
    qualified: z.boolean(),
    reasons: z.array(qualificationReasonSchema),
  }),
});

export type EvaluationReport = z.infer<typeof evaluationReportSchema>;

/** Recording sources whose taker requests all come from an attacker bot (S9 `source`). */
export const ATTACKER_SOURCES: ReadonlySet<string> = new Set([
  "naive",
  "sniper",
  "latecomer",
  "rotating",
  "held-out",
]);

export interface SimulationOptions {
  mandate?: Mandate | undefined;
  params?: Params | undefined;
  tokens?: Tokens | undefined;
  modeledGasUsdPerFill?: number | undefined;
  seed?: number | undefined;
  /**
   * How late the engine sees each venue book. The live engine polls venues every
   * `feeds.pollMs`, so a book recorded at `ts` reaches the policy at the next poll boundary.
   * Defaults to `params.feeds.pollMs`; 0 makes every book visible immediately.
   */
  engineLagMs?: number | undefined;
}

export interface EvaluationInput {
  candidate: PolicySpec | Policy;
  incumbent?: (PolicySpec | Policy) | undefined;
  datasets: LoadedScenario[];
  role?: ("research" | "evaluator") | undefined;
  mandate?: Mandate | undefined;
  params?: Params | undefined;
  tokens?: Tokens | undefined;
  seed?: number | undefined;
  codeRevision?: string | undefined;
  rulesVersion?: string | undefined;
  createdAt?: number | undefined;
  modeledGasUsdPerFill?: number | undefined;
}

function round(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function calculateEquity(
  inventory: Inventory,
  mids: Partial<Record<Pair, number | null>>,
  tokens: Tokens,
): number {
  const usdtUnits = units(inventory.USDT ?? 0n, tokens.USDT.decimals);
  const whskUnits = units(inventory.WHSK ?? 0n, tokens.WHSK.decimals);
  const wethUnits = units(inventory.WETH ?? 0n, tokens.WETH.decimals);

  const hskMid = mids["HSK/USDT"] ?? 0;
  const ethMid = mids["ETH/USDT"] ?? 0;

  return usdtUnits + whskUnits * (hskMid ?? 0) + wethUnits * (ethMid ?? 0);
}

function depthSum(levels: Level[], maxLevels: number): number {
  return levels.slice(0, maxLevels).reduce((sum, [price, size]) => sum + price * size, 0);
}

interface SimFeedState {
  mids: Partial<Record<Pair, number | null>>;
  venueStates: Map<Pair, Map<VenueId, { venue: VenueId; book: Book; at: number }>>;
  venueHistory: Map<Pair, Map<VenueId, VenueSample[]>>;
  volatilities: Map<Pair, Volatility>;
}

function updateVenueBook(
  record: ScenarioBookRecord,
  feedState: SimFeedState,
  fuseOptions: { staleMs: number; maxDisagreement: number; minSources: number },
  bookLevels: number,
  visibleTs: number = record.ts,
): void {
  const pStates = feedState.venueStates.get(record.pair);
  if (!pStates) return;

  pStates.set(record.venue, {
    venue: record.venue,
    book: record.book,
    at: visibleTs,
  });

  const stateList = Array.from(pStates.values());
  const fused = fuse(stateList, visibleTs, fuseOptions);

  if (fused.mid !== null && Number.isFinite(fused.mid) && fused.mid > 0) {
    feedState.mids[record.pair] = fused.mid;
    const vol = feedState.volatilities.get(record.pair);
    vol?.update(fused.mid, visibleTs);

    const pHistory = feedState.venueHistory.get(record.pair);
    if (pHistory) {
      let vSamples = pHistory.get(record.venue);
      if (!vSamples) {
        vSamples = [];
        pHistory.set(record.venue, vSamples);
      }
      vSamples.push({
        t: visibleTs,
        mid: midOf(record.book) ?? fused.mid,
        bidDepthUsd: depthSum(record.book.bids, bookLevels),
        askDepthUsd: depthSum(record.book.asks, bookLevels),
      });
      // Keep last 60 seconds
      while (vSamples.length > 0 && vSamples[0] && vSamples[0].t < visibleTs - 60_000) {
        vSamples.shift();
      }
    }
  }
}

function buildCleanRequest(
  record: ScenarioTakerRequestRecord,
  isAttacker: boolean,
  currentMid: number,
  baseToken: { decimals: number },
  quoteToken: { decimals: number },
): {
  cleanRequest: PolicyRequest;
  notional: number;
  baseQty: number;
  cleanTier: Exclude<TierName, "blocked">;
} {
  const notional =
    record.side === "buy"
      ? units(BigInt(record.amountIn), quoteToken.decimals)
      : units(BigInt(record.amountIn), baseToken.decimals) * currentMid;
  const baseQty =
    record.side === "sell"
      ? units(BigInt(record.amountIn), baseToken.decimals)
      : notional / currentMid;

  const cleanTier: Exclude<TierName, "blocked"> =
    record.tier === "blocked" || !record.tier
      ? "normal"
      : (record.tier as Exclude<TierName, "blocked">);

  const cleanRequest: PolicyRequest = {
    pair: record.pair,
    side: record.side,
    amountIn: record.amountIn,
    baseQuantity: baseQty,
    notionalUsd: notional,
    tier: cleanTier,
    score: record.score ?? (isAttacker ? 0.75 : 0.1),
  };

  return { cleanRequest, notional, baseQty, cleanTier };
}

function buildSimMarketState(
  recordTs: number,
  recordPair: Pair,
  fused: ReturnType<typeof fuse> & { mid: number; book: Book },
  pStates: Map<VenueId, { venue: VenueId; book: Book; at: number }> | undefined,
  volatilities: Map<Pair, Volatility>,
  pHistory: Map<VenueId, VenueSample[]> | undefined,
  bookLevels: number,
): PolicyMarketState {
  const vol = volatilities.get(recordPair);
  const sigma1 = vol ? vol.sigma1 : 0.0002;

  const historyObj: Partial<Record<VenueId, VenueSample[]>> = {};
  if (pHistory) {
    for (const [v, samples] of pHistory) {
      historyObj[v] = [...samples];
    }
  }

  return {
    now: recordTs,
    pair: recordPair,
    fused: {
      mid: fused.mid,
      health: fused.health,
      sourceCount: fused.sources.filter((s) => s.status === "ok").length,
      sigma1,
    },
    venues: fused.sources.map((s) => {
      const vState = pStates?.get(s.venue);
      return {
        venue: s.venue,
        mid: vState?.book ? midOf(vState.book) : null,
        bidDepthUsd: vState?.book ? depthSum(vState.book.bids, bookLevels) : 0,
        askDepthUsd: vState?.book ? depthSum(vState.book.asks, bookLevels) : 0,
        receivedAt: vState?.at ?? 0,
        status: s.status,
      };
    }),
    history: historyObj,
    book: structuredClone(fused.book),
    tuner: 1.0,
  };
}

function checkTakerFill(
  isAttacker: boolean,
  side: "buy" | "sell",
  quotedPrice: number,
  currentMid: number,
  quotedSpreadBps: number,
  bookWalkPrice: number | null,
  notional: number,
  mandate: Mandate,
): boolean {
  if (isAttacker) {
    // Attackers fill only when the signed price is at or through the true mid: a quote
    // priced from a stale engine view is exactly what they look for.
    const edgeBps =
      (side === "buy" ? currentMid / quotedPrice - 1 : quotedPrice / currentMid - 1) * 10_000;
    return edgeBps >= 0;
  }

  // Honest taker fills if desk is competitive vs public order book
  if (bookWalkPrice !== null) {
    return side === "buy"
      ? quotedPrice <= bookWalkPrice * 1.01
      : quotedPrice >= bookWalkPrice * 0.99;
  }

  // If public book is thin, honest taker fills if spread is within mandate bucket
  const bucket = mandate.service.maxHalfSpreadBps.find((b) => notional <= b.maxNotionalUsd);
  return quotedSpreadBps <= (bucket?.maxBps ?? 300);
}

/**
 * Pure simulation replay of a policy over a scenario dataset.
 * Evaluates decisions through the production mandate/execution layer,
 * models realistic taker acceptance, and tracks exact portfolio P&L.
 */
export function simulatePolicyOnScenario(
  policy: Policy,
  scenario: LoadedScenario,
  options: SimulationOptions = {},
): PolicyResults {
  const mandate = options.mandate ?? defaultMandate;
  const params = options.params ?? defaultParams;
  const tokens = options.tokens ?? DEFAULT_EVAL_TOKENS;
  const modeledGasUsdPerFill = options.modeledGasUsdPerFill ?? 0.05;

  const activePair = scenario.manifest.pair;
  const evalParams: Params = {
    ...params,
    pairs: [activePair],
  };
  const evalMandate: Mandate = {
    ...mandate,
    pairs: [activePair],
  };

  const quoteToken = tokens.USDT;
  const pair = activePair;
  const baseSymbol = PAIR_TOKENS[pair].base;
  const baseToken = tokens[baseSymbol];

  // Seed inventory: 25k USD per side per pair matching Arena standard
  const initialUsdPerSide = params.arena.initialUsdPerSide;
  const inventory: Inventory = {
    USDT: toUnits(initialUsdPerSide * evalParams.pairs.length, quoteToken.decimals),
    WHSK: 0n,
    WETH: 0n,
  };

  const feedState: SimFeedState = {
    mids: {
      "HSK/USDT": null,
      "ETH/USDT": null,
    },
    venueStates: new Map(),
    venueHistory: new Map(),
    volatilities: new Map(),
  };

  for (const p of evalParams.pairs) {
    feedState.venueStates.set(p, new Map());
    feedState.venueHistory.set(p, new Map());
    feedState.volatilities.set(p, new Volatility());
  }

  // The true market: every recorded book as soon as it was observed. It marks inventory, judges
  // attacker edge and is the public book honest takers see. The policy never sees it directly.
  const trueFeed: SimFeedState = {
    mids: { "HSK/USDT": null, "ETH/USDT": null },
    venueStates: new Map(),
    venueHistory: new Map(),
    volatilities: new Map(),
  };
  for (const p of evalParams.pairs) {
    trueFeed.venueStates.set(p, new Map());
    trueFeed.venueHistory.set(p, new Map());
    trueFeed.volatilities.set(p, new Volatility());
  }
  const engineLagMs = Math.max(0, options.engineLagMs ?? params.feeds.pollMs);
  const visibleAt = (ts: number) =>
    engineLagMs > 0 ? Math.ceil(ts / engineLagMs) * engineLagMs : ts;
  const pendingBooks: ScenarioBookRecord[] = [];

  const uniqueVenues = new Set(
    scenario.records.filter((r): r is ScenarioBookRecord => r.type === "book").map((r) => r.venue),
  );

  const fuseOptions = {
    staleMs: params.feeds.staleMs,
    maxDisagreement: params.feeds.maxDisagreement,
    minSources: Math.min(params.feeds.minSources, Math.max(1, uniqueVenues.size)),
  };

  let initialEquity = 0;
  let inventorySeeded = false;
  let peakEquity = 0;
  let maxDrawdown = 0;

  let totalRequests = 0;
  let honestRequests = 0;
  let honestFills = 0;
  let totalRejects = 0;
  let totalFills = 0;

  let spreadCaptureUsd = 0;
  let totalGasUsd = 0;
  let attackerTakeUsd = 0;

  const halfSpreads: number[] = [];

  // Process scenario records in timestamp order
  // Applies a book to the engine's view at the time the engine would have polled it.
  const applyEngineBook = (record: ScenarioBookRecord, at: number) => {
    updateVenueBook(record, feedState, fuseOptions, params.feeds.bookLevels, at);

    // Initial inventory allocation once mid is known
    if (!inventorySeeded && feedState.mids[pair] !== null && feedState.mids[pair] !== undefined) {
      const pairMid = feedState.mids[pair] as number;
      inventory[baseSymbol] = toUnits(initialUsdPerSide / pairMid, baseToken.decimals);
      initialEquity = calculateEquity(inventory, trueFeed.mids, tokens);
      peakEquity = initialEquity;
      inventorySeeded = true;
    }
  };

  for (const record of scenario.records) {
    while (pendingBooks.length > 0 && visibleAt(pendingBooks[0]?.ts ?? 0) <= record.ts) {
      const next = pendingBooks.shift();
      if (next) applyEngineBook(next, visibleAt(next.ts));
    }
    if (record.type === "book") {
      updateVenueBook(record, trueFeed, fuseOptions, params.feeds.bookLevels);
      if (engineLagMs === 0) applyEngineBook(record, record.ts);
      else pendingBooks.push(record);
    } else if (record.type === "taker_request") {
      totalRequests++;

      // Evaluator internal classification - NEVER passed to policy!
      // Requests in an attacker recording are attacker flow whatever tier the engine gave the
      // (often fresh) identity; tape requests are honest unless the engine flagged them toxic.
      const isAttacker =
        record.tier === "toxic" ||
        (ATTACKER_SOURCES.has(scenario.manifest.source) && record.tier !== "internal") ||
        (scenario.manifest.source !== "tape" &&
          record.tier !== "normal" &&
          record.tier !== "internal");

      if (!isAttacker) {
        honestRequests++;
      }

      const currentMid = feedState.mids[record.pair];
      const trueMid = trueFeed.mids[record.pair] ?? currentMid ?? null;
      const trueStates = trueFeed.venueStates.get(record.pair);
      const trueBook = trueStates
        ? fuse(Array.from(trueStates.values()), record.ts, fuseOptions).book
        : null;
      const pStates = feedState.venueStates.get(record.pair);
      const stateList = pStates ? Array.from(pStates.values()) : [];
      const fused = fuse(stateList, record.ts, fuseOptions);

      if (
        !inventorySeeded ||
        currentMid === null ||
        currentMid === undefined ||
        !fused.book ||
        fused.mid === null
      ) {
        totalRejects++;
        continue;
      }

      const { cleanRequest, notional, baseQty, cleanTier } = buildCleanRequest(
        record,
        isAttacker,
        currentMid,
        baseToken,
        quoteToken,
      );

      const policyMarket = buildSimMarketState(
        record.ts,
        record.pair,
        fused as ReturnType<typeof fuse> & { mid: number; book: Book },
        pStates,
        feedState.volatilities,
        feedState.venueHistory.get(record.pair),
        params.feeds.bookLevels,
      );

      const baseVal = units(inventory[baseSymbol], baseToken.decimals) * currentMid;
      const quoteVal = units(inventory.USDT, quoteToken.decimals) / evalParams.pairs.length;
      const currentBaseShare = baseShare(
        currentMid,
        inventory,
        { base: baseToken, quote: quoteToken },
        evalParams.pairs.length,
      );

      const policyInv: PolicyInventory = {
        base: { raw: inventory[baseSymbol].toString(), usd: baseVal },
        quote: { raw: inventory.USDT.toString(), usd: quoteVal },
        baseShare: currentBaseShare,
        targetShare: params.inventory.targetShare,
      };

      let decision: PolicyDecision;
      try {
        decision = policy.decide(policyMarket, policyInv, cleanRequest);
      } catch {
        totalRejects++;
        continue;
      }

      if (decision.kind === "reject") {
        totalRejects++;
        continue;
      }

      // Enforce production mandate and execution authority
      let execResult: ReturnType<typeof enforceExecution>;
      try {
        execResult = enforceExecution(
          {
            pair: record.pair,
            side: record.side,
            amountIn: record.amountIn,
            tier: cleanTier,
            params: evalParams,
            mandate: evalMandate,
            tokens,
            inventory,
            mids: feedState.mids,
            book: fused.book,
            sourceMids: fused.sources.filter((s) => s.status === "ok").map((s) => s.mid),
          },
          decision,
        );
      } catch {
        totalRejects++;
        continue;
      }

      const quotedPrice = execResult.quote.price;
      const quotedSpreadBps =
        (record.side === "buy" ? quotedPrice / currentMid - 1 : 1 - quotedPrice / currentMid) *
        10000;
      halfSpreads.push(Math.max(0, quotedSpreadBps));

      // Taker Execution Model
      // Honest takers compare against the public book as it really is, not the engine's view.
      const publicBook = trueBook ?? fused.book;
      const bookWalkPrice =
        record.side === "buy"
          ? vwapForQuote(publicBook.asks, notional)
          : vwap(publicBook.bids, baseQty);

      const takerFills = checkTakerFill(
        isAttacker,
        record.side,
        quotedPrice,
        trueMid ?? currentMid,
        quotedSpreadBps,
        bookWalkPrice,
        notional,
        mandate,
      );

      if (takerFills) {
        totalFills++;
        if (!isAttacker) honestFills++;

        // Update inventory
        Object.assign(inventory, execResult.inventory);
        totalGasUsd += modeledGasUsdPerFill;

        const fillQty =
          record.side === "buy"
            ? units(BigInt(execResult.amountOut), baseToken.decimals)
            : units(BigInt(record.amountIn), baseToken.decimals);

        const sc = spreadCapture(
          {
            id: `sim-fill-${totalFills}`,
            quoteId: `sim-quote-${totalFills}`,
            policyId: policy.id,
            ts: record.ts,
            taker: record.taker as `0x${string}`,
            pair: record.pair,
            side: record.side,
            tokenIn: record.side === "buy" ? quoteToken.address : baseToken.address,
            tokenOut: record.side === "buy" ? baseToken.address : quoteToken.address,
            amountIn: record.amountIn,
            amountOut: execResult.amountOut,
            price: quotedPrice,
            midAtFill: trueMid ?? currentMid,
            flow: isAttacker ? "attacker" : "user",
            paper: true,
            txHash: null,
          },
          fillQty,
        );
        spreadCaptureUsd += sc;

        if (isAttacker) {
          attackerTakeUsd += Math.max(0, -sc);
        }

        // Drawdown tracking
        const currentEquity = calculateEquity(inventory, trueFeed.mids, tokens);
        const netEquity = currentEquity - totalGasUsd;
        if (netEquity > peakEquity) peakEquity = netEquity;
        const dd = peakEquity > 0 ? (peakEquity - netEquity) / peakEquity : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
    }
  }

  const finalEquity = calculateEquity(inventory, trueFeed.mids, tokens);
  const totalPnlBeforeGas = finalEquity - initialEquity;
  const netUsd = totalPnlBeforeGas - totalGasUsd;
  const inventoryPnlUsd = totalPnlBeforeGas - spreadCaptureUsd;
  const avgHalfSpreadBps =
    halfSpreads.length > 0 ? halfSpreads.reduce((a, b) => a + b, 0) / halfSpreads.length : 0;
  const honestFillRate = honestRequests > 0 ? honestFills / honestRequests : 1.0;
  const rejectRate = totalRequests > 0 ? totalRejects / totalRequests : 0.0;

  return {
    netUsd: round(netUsd, 2),
    spreadCaptureUsd: round(spreadCaptureUsd, 2),
    inventoryPnlUsd: round(inventoryPnlUsd, 2),
    maxDrawdownPct: round(maxDrawdown, 4),
    avgHalfSpreadBps: round(avgHalfSpreadBps, 2),
    honestFillRate: round(honestFillRate, 4),
    rejectRate: round(rejectRate, 4),
    attackerTakeUsd: round(attackerTakeUsd, 2),
    fills: totalFills,
  };
}

function checkHeldOutRule(
  candidateResults: Record<string, PolicyResults>,
  incumbentResults: Record<string, PolicyResults>,
  heldOutDatasets: DatasetSummary[],
): QualificationReason {
  if (heldOutDatasets.length > 0) {
    let candHeldOutNet = 0;
    let incHeldOutNet = 0;
    for (const d of heldOutDatasets) {
      candHeldOutNet += candidateResults[d.name]?.netUsd ?? 0;
      incHeldOutNet += incumbentResults[d.name]?.netUsd ?? 0;
    }
    const passed = candHeldOutNet >= incHeldOutNet;
    return {
      rule: "must_beat_held_out",
      passed,
      candidate: round(candHeldOutNet, 2),
      incumbent: round(incHeldOutNet, 2),
      threshold: round(incHeldOutNet, 2),
      detail: passed
        ? "Candidate beat or matched incumbent on held-out datasets"
        : "Candidate net P&L was lower than incumbent on held-out datasets",
    };
  }
  return {
    rule: "must_beat_held_out",
    passed: true,
    candidate: true,
    incumbent: true,
    threshold: true,
    detail: "No held-out datasets included in evaluation",
  };
}

function checkDrawdownRule(
  candidateResults: Record<string, PolicyResults>,
  incumbentResults: Record<string, PolicyResults>,
  datasets: DatasetSummary[],
  mandate: Mandate,
): QualificationReason {
  const candMaxDD = Math.max(
    0,
    ...datasets.map((d) => candidateResults[d.name]?.maxDrawdownPct ?? 0),
  );
  const incMaxDD = Math.max(
    0,
    ...datasets.map((d) => incumbentResults[d.name]?.maxDrawdownPct ?? 0),
  );
  const ddDelta = candMaxDD - incMaxDD;
  const ddPassed = ddDelta <= mandate.qualification.maxDrawdownDeltaPct;
  return {
    rule: "max_drawdown_delta",
    passed: ddPassed,
    candidate: round(candMaxDD, 4),
    incumbent: round(incMaxDD, 4),
    threshold: round(mandate.qualification.maxDrawdownDeltaPct, 4),
    detail: `Drawdown delta: ${round(ddDelta, 4)} (limit: ${mandate.qualification.maxDrawdownDeltaPct})`,
  };
}

function checkHonestFillToleranceRule(
  candFillRateAvg: number,
  incFillRateAvg: number,
  mandate: Mandate,
): QualificationReason {
  const fillDrop = incFillRateAvg - candFillRateAvg;
  const fillDropPassed = fillDrop <= mandate.qualification.honestFillTolerance;
  return {
    rule: "honest_fill_tolerance",
    passed: fillDropPassed,
    candidate: round(candFillRateAvg, 4),
    incumbent: round(incFillRateAvg, 4),
    threshold: round(mandate.qualification.honestFillTolerance, 4),
    detail: `Honest fill rate drop: ${round(fillDrop, 4)} (limit: ${mandate.qualification.honestFillTolerance})`,
  };
}

function checkMinHonestFillRateRule(
  candFillRateAvg: number,
  incFillRateAvg: number,
  mandate: Mandate,
): QualificationReason {
  const minFillPassed = candFillRateAvg >= mandate.qualification.minHonestFillRate;
  return {
    rule: "min_honest_fill_rate",
    passed: minFillPassed,
    candidate: round(candFillRateAvg, 4),
    incumbent: round(incFillRateAvg, 4),
    threshold: round(mandate.qualification.minHonestFillRate, 4),
    detail: `Honest fill rate: ${round(candFillRateAvg, 4)} (min required: ${mandate.qualification.minHonestFillRate})`,
  };
}

function checkMaxRejectRateRule(
  candRejectAvg: number,
  incRejectAvg: number,
  mandate: Mandate,
): QualificationReason {
  const rejectPassed = candRejectAvg <= mandate.qualification.maxRejectRate;
  return {
    rule: "max_reject_rate",
    passed: rejectPassed,
    candidate: round(candRejectAvg, 4),
    incumbent: round(incRejectAvg, 4),
    threshold: round(mandate.qualification.maxRejectRate, 4),
    detail: `Reject rate: ${round(candRejectAvg, 4)} (max allowed: ${mandate.qualification.maxRejectRate})`,
  };
}

/**
 * Pure evaluation of qualification rules comparing candidate to incumbent.
 */
export function evaluateQualification(
  candidateResults: Record<string, PolicyResults>,
  incumbentResults: Record<string, PolicyResults>,
  datasets: DatasetSummary[],
  mandate: Mandate,
): { qualified: boolean; reasons: QualificationReason[] } {
  const heldOutDatasets = datasets.filter((d) => d.kind === "heldout");

  const candFillRateAvg =
    datasets.length > 0
      ? datasets.reduce((sum, d) => sum + (candidateResults[d.name]?.honestFillRate ?? 0), 0) /
        datasets.length
      : 1;
  const incFillRateAvg =
    datasets.length > 0
      ? datasets.reduce((sum, d) => sum + (incumbentResults[d.name]?.honestFillRate ?? 0), 0) /
        datasets.length
      : 1;

  const candRejectAvg =
    datasets.length > 0
      ? datasets.reduce((sum, d) => sum + (candidateResults[d.name]?.rejectRate ?? 0), 0) /
        datasets.length
      : 0;
  const incRejectAvg =
    datasets.length > 0
      ? datasets.reduce((sum, d) => sum + (incumbentResults[d.name]?.rejectRate ?? 0), 0) /
        datasets.length
      : 0;

  const reasons: QualificationReason[] = [
    checkHeldOutRule(candidateResults, incumbentResults, heldOutDatasets),
    checkDrawdownRule(candidateResults, incumbentResults, datasets, mandate),
    checkHonestFillToleranceRule(candFillRateAvg, incFillRateAvg, mandate),
    checkMinHonestFillRateRule(candFillRateAvg, incFillRateAvg, mandate),
    checkMaxRejectRateRule(candRejectAvg, incRejectAvg, mandate),
  ];

  const qualified = reasons.every((r) => r.passed);
  return { qualified, reasons };
}

/**
 * Pure deterministic evaluator comparing a candidate policy against incumbent
 * across dev and scenario datasets, and optionally held-out datasets with evaluator authorization.
 */
export async function evaluatePolicies(input: EvaluationInput): Promise<EvaluationReport> {
  const mandate = input.mandate ?? defaultMandate;
  const params = input.params ?? defaultParams;
  const tokens = input.tokens ?? DEFAULT_EVAL_TOKENS;
  const role = input.role ?? "research";
  const seed = input.seed ?? 42;
  const createdAt = input.createdAt ?? Date.now();
  const codeRevision = input.codeRevision ?? "head";
  const rulesVersion = input.rulesVersion ?? "1.0.0";

  // Check held-out authorization across all datasets
  for (const ds of input.datasets) {
    if ((ds.manifest.heldOut || ds.split === "held-out") && role !== "evaluator") {
      throw new HeldOutAccessError(ds.manifest.name);
    }
  }

  // Resolve candidate policy and metadata
  let candidatePolicy: Policy;
  let candidateId: string;
  let specHash: string;

  if ("decide" in input.candidate) {
    candidatePolicy = input.candidate;
    candidateId = input.candidate.id;
    specHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
  } else {
    candidatePolicy = compile(input.candidate, { mandate, params });
    candidateId = input.candidate.id;
    specHash = hashPolicySpec(input.candidate);
  }

  // Resolve incumbent policy
  let incumbentPolicy: Policy;
  let incumbentId: string;

  if (input.incumbent) {
    if ("decide" in input.incumbent) {
      incumbentPolicy = input.incumbent;
      incumbentId = input.incumbent.id;
    } else {
      incumbentPolicy = compile(input.incumbent, { mandate, params });
      incumbentId = input.incumbent.id;
    }
  } else {
    incumbentPolicy = createV0(params);
    incumbentId = "v0";
  }

  const simOptions: SimulationOptions = {
    mandate,
    params,
    tokens,
    modeledGasUsdPerFill: input.modeledGasUsdPerFill,
    seed,
  };

  const datasetSummaries: DatasetSummary[] = [];
  const results: Record<string, { candidate: PolicyResults; incumbent: PolicyResults }> = {};
  const candidateResults: Record<string, PolicyResults> = {};
  const incumbentResults: Record<string, PolicyResults> = {};

  for (const ds of input.datasets) {
    const dsName = ds.manifest.name;
    const kind =
      ds.manifest.heldOut || ds.split === "held-out"
        ? "heldout"
        : ds.manifest.source === "tape"
          ? "dev"
          : "scenario";

    const fromTs = ds.timeRange?.fromTs ?? ds.records[0]?.ts ?? 0;
    const toTs = ds.timeRange?.toTs ?? ds.records.at(-1)?.ts ?? 0;

    const requests = ds.recordCounts.takerRequests;

    datasetSummaries.push({
      name: dsName,
      kind,
      from: fromTs,
      to: toTs,
      requests,
    });

    const candRes = simulatePolicyOnScenario(candidatePolicy, ds, simOptions);
    const incRes = simulatePolicyOnScenario(incumbentPolicy, ds, simOptions);

    candidateResults[dsName] = candRes;
    incumbentResults[dsName] = incRes;
    results[dsName] = { candidate: candRes, incumbent: incRes };
  }

  const verdict = evaluateQualification(
    candidateResults,
    incumbentResults,
    datasetSummaries,
    mandate,
  );

  const report: EvaluationReport = {
    candidateId,
    incumbentId,
    specHash,
    codeRevision,
    rulesVersion,
    seed,
    createdAt,
    datasets: datasetSummaries,
    results,
    verdict,
  };

  // Ensure output conforms strictly to S4 report schema
  return evaluationReportSchema.parse(report);
}
