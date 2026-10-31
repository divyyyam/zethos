import { z } from "zod";
import { sampleDiagnosis, samplePolicyDetails } from "../../content/research.mock";
import { platformConfig } from "../platform-config";
import { engineRequest } from "./client";
import { POLICY_STATUSES } from "./policies";

const finiteNumber = z.number().finite();
const boundedNumber = (min: number, max: number) => finiteNumber.min(min).max(max);

export const policyReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("median"),
    params: z.strictObject({}).optional().default({}),
  }),
  z.strictObject({
    kind: z.literal("depthWeighted"),
    params: z.strictObject({}).optional().default({}),
  }),
  z.strictObject({
    kind: z.literal("leadWeighted"),
    params: z.strictObject({
      leadVenues: z.array(z.string()).min(1),
      leadWeight: boundedNumber(0, 0.9),
      lookbackSec: boundedNumber(1, 60),
    }),
  }),
]);

export type PolicyReference = z.infer<typeof policyReferenceSchema>;

export const policyTermSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("base"),
    params: z.strictObject({
      bps: z.record(z.string(), boundedNumber(1, 100)),
    }),
  }),
  z.strictObject({
    kind: z.literal("vol"),
    params: z.strictObject({ k: boundedNumber(0, 5) }),
  }),
  z.strictObject({
    kind: z.literal("inventory"),
    params: z.strictObject({ k: boundedNumber(0, 0.01) }),
  }),
  z.strictObject({
    kind: z.literal("toxicity"),
    params: z.strictObject({ scale: boundedNumber(0, 2) }),
  }),
  z.strictObject({
    kind: z.literal("depthWithdrawal"),
    params: z.strictObject({
      dropPct: boundedNumber(0.1, 0.9),
      windowSec: boundedNumber(1, 30),
      addBps: boundedNumber(0, 100),
    }),
  }),
  z.strictObject({
    kind: z.literal("leadMove"),
    params: z.strictObject({
      thresholdBps: boundedNumber(1, 100),
      windowSec: boundedNumber(1, 30),
      addBps: boundedNumber(0, 100),
    }),
  }),
  z.strictObject({
    kind: z.literal("restoreCost"),
    params: z.strictObject({ k: boundedNumber(0, 2) }),
  }),
  z.strictObject({
    kind: z.literal("sizeCurve"),
    params: z.strictObject({
      exponent: boundedNumber(0.5, 2),
      kBps: boundedNumber(0, 50),
    }),
  }),
  z.strictObject({
    kind: z.literal("tuner"),
    params: z.strictObject({}).optional().default({}),
  }),
  z.strictObject({
    kind: z.literal("reservationFee"),
    params: z.strictObject({
      optionK: boundedNumber(0, 2),
      adverseK: boundedNumber(0, 2),
      utilK: boundedNumber(0, 5),
      floorBps: boundedNumber(1, 200),
    }),
  }),
]);

export type PolicyTerm = z.infer<typeof policyTermSchema>;

export const policySpecSchema = z.strictObject({
  id: z.string(),
  parent: z.string(),
  hypothesis: z.string().max(500),
  pairs: z.array(z.string()).min(1),
  reference: policyReferenceSchema,
  terms: z.array(policyTermSchema).min(1),
  clamp: z.strictObject({
    minBps: finiteNumber.positive(),
    maxBps: finiteNumber.positive(),
  }),
  ttl: z.strictObject({
    kind: z.literal("volScaled"),
    ttlVolK: finiteNumber.positive(),
    minSec: boundedNumber(1, 120).int(),
    maxSec: boundedNumber(1, 120).int(),
  }),
  rejectIf: z
    .strictObject({
      maxSigma1: finiteNumber.nonnegative().optional(),
      minSources: boundedNumber(1, 6).int().optional(),
      leadDivergenceBps: finiteNumber.positive().optional(),
    })
    .optional(),
});

export type PolicySpec = z.infer<typeof policySpecSchema>;

export const datasetResultSchema = z.strictObject({
  netUsd: finiteNumber,
  spreadCaptureUsd: finiteNumber.optional(),
  inventoryPnlUsd: finiteNumber.optional(),
  maxDrawdownPct: finiteNumber,
  avgHalfSpreadBps: finiteNumber,
  honestFillRate: finiteNumber,
  rejectRate: finiteNumber,
  attackerTakeUsd: finiteNumber.optional(),
  fills: finiteNumber,
});

export type DatasetResult = z.infer<typeof datasetResultSchema>;

export const verdictReasonSchema = z.strictObject({
  rule: z.string(),
  passed: z.boolean(),
  candidate: z.union([finiteNumber, z.string(), z.boolean()]),
  incumbent: z.union([finiteNumber, z.string(), z.boolean()]).optional(),
  threshold: z.union([finiteNumber, z.string(), z.boolean()]),
});

export type VerdictReason = z.infer<typeof verdictReasonSchema>;

export const evaluationReportSchema = z.strictObject({
  candidateId: z.string(),
  incumbentId: z.string(),
  specHash: z.string(),
  codeRevision: z.string().optional(),
  rulesVersion: z.string().optional(),
  seed: z.number().int().optional(),
  createdAt: z.union([z.number(), z.string()]),
  datasets: z.array(
    z.strictObject({
      name: z.string(),
      kind: z.enum(["dev", "scenario", "heldout"]),
      from: z.number().optional(),
      to: z.number().optional(),
      requests: z.number().optional(),
    }),
  ),
  results: z.record(z.string(), z.record(z.string(), datasetResultSchema)),
  verdict: z.strictObject({
    qualified: z.boolean(),
    reasons: z.array(verdictReasonSchema),
  }),
});

export type EvaluationReport = z.infer<typeof evaluationReportSchema>;

export const canaryCounterfactualSchema = z
  .strictObject({
    observedFills: finiteNumber,
    counterfactualFills: finiteNumber.optional(),
    observedPnlUsd: finiteNumber,
    counterfactualPnlUsd: finiteNumber.optional(),
    fillRateDrop: finiteNumber.optional(),
    drawdownPct: finiteNumber.optional(),
  })
  .optional();

export type CanaryCounterfactual = z.infer<typeof canaryCounterfactualSchema>;

export const policyDetailSchema = z.strictObject({
  id: z.string(),
  status: z.enum(POLICY_STATUSES),
  spec: policySpecSchema,
  report: evaluationReportSchema.nullable().optional(),
  canaryStats: canaryCounterfactualSchema.nullable().optional(),
});

export type PolicyDetail = z.infer<typeof policyDetailSchema>;

export const causeAttributionSchema = z.strictObject({
  usd: finiteNumber,
  share: finiteNumber,
  fillCount: finiteNumber,
  exampleFillIds: z.array(z.string()),
});

export type CauseAttribution = z.infer<typeof causeAttributionSchema>;

export const diagnosisResponseSchema = z.strictObject({
  window: z
    .strictObject({
      fromTs: finiteNumber,
      toTs: finiteNumber,
    })
    .optional(),
  totalLossUsd: finiteNumber,
  analyzedLossUsd: finiteNumber.optional(),
  unclassifiedLossUsd: finiteNumber.optional(),
  causes: z.record(z.string(), causeAttributionSchema),
  unclassified: causeAttributionSchema.optional(),
  excludedFills: z
    .array(
      z.strictObject({
        fillId: z.string(),
        reason: z.string(),
      }),
    )
    .optional(),
  breakdown: z
    .array(
      z.strictObject({
        fillId: z.string(),
        quoteId: z.string(),
        ts: finiteNumber,
        pair: z.string(),
        side: z.string(),
        notionalUsd: finiteNumber,
        lossUsd: finiteNumber,
        matchedCauses: z.array(z.string()),
        attributedUsd: z.record(z.string(), finiteNumber).optional(),
        evidence: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

export type DiagnosisResponse = z.infer<typeof diagnosisResponseSchema>;

/** Formats a policy reference into human-readable text. */
export function describeReference(ref: PolicyReference): string {
  switch (ref.kind) {
    case "median":
      return "Median reference across all active healthy venues";
    case "depthWeighted":
      return "Depth-weighted reference walk across merged order books (incumbent)";
    case "leadWeighted": {
      const venues = ref.params.leadVenues.join(", ");
      const weight = (ref.params.leadWeight * 100).toFixed(0);
      return `Lead-weighted reference (${venues}) with ${weight}% weight, ${ref.params.lookbackSec}s lookback`;
    }
  }
}

/** Formats a policy term into one readable line with its parameters. */
export function describeTerm(term: PolicyTerm): string {
  switch (term.kind) {
    case "base": {
      const pairs = Object.entries(term.params.bps)
        .map(([pair, bps]) => `${pair}: ${bps} bps`)
        .join(", ");
      return `Base spread: ${pairs}`;
    }
    case "vol":
      return `Volatility scaling: k = ${term.params.k} (volatility-adjusted half-spread)`;
    case "inventory":
      return `Inventory skew: k = ${term.params.k} (skews prices toward target share)`;
    case "toxicity":
      return `Taker toxicity: scale = ${term.params.scale} (widens on toxic-tier takers)`;
    case "depthWithdrawal":
      return `Depth withdrawal defense: widen +${term.params.addBps} bps if top depth drops ${(term.params.dropPct * 100).toFixed(0)}% within ${term.params.windowSec}s`;
    case "leadMove":
      return `Lead move defense: widen +${term.params.addBps} bps when lead moves > ${term.params.thresholdBps} bps in ${term.params.windowSec}s`;
    case "restoreCost":
      return `Inventory restore cost: k = ${term.params.k} (compensates expected rebalancing cost)`;
    case "sizeCurve":
      return `Size curve: kBps = ${term.params.kBps} bps, exponent = ${term.params.exponent} (widens with trade notional)`;
    case "tuner":
      return "Live tuner: dynamic multiplier tuned from fill markout feedback";
    case "reservationFee":
      return `Reservation fee: optionK=${term.params.optionK}, adverseK=${term.params.adverseK}, utilK=${term.params.utilK}, floor=${term.params.floorBps} bps`;
  }
}

/** Formats TTL config into a readable line. */
export function describeTtl(ttl: PolicySpec["ttl"]): string {
  return `Volatility-scaled TTL (k = ${ttl.ttlVolK}, window ${ttl.minSec}s – ${ttl.maxSec}s)`;
}

/** Formats clamp bounds into a readable line. */
export function describeClamp(clamp: PolicySpec["clamp"]): string {
  const minPct = (clamp.minBps / 100).toFixed(2);
  const maxPct = (clamp.maxBps / 100).toFixed(2);
  return `Min ${clamp.minBps} bps (${minPct}%) – Max ${clamp.maxBps} bps (${maxPct}%)`;
}

/**
 * Fetches full policy details from /policies/:id.
 * When NEXT_PUBLIC_ENGINE_URL is unconfigured, returns local sample fixture.
 * When configured, fetches from engine and throws on failure.
 */
export async function fetchPolicyDetail(id: string): Promise<PolicyDetail> {
  if (!platformConfig.engineUrl) {
    const fixture = samplePolicyDetails[id] ?? samplePolicyDetails["p-20261031-v0"];
    if (!fixture) throw new Error(`Policy ${id} not found in sample fixtures`);
    return policyDetailSchema.parse(fixture);
  }

  const rawData = await engineRequest(`/policies/${encodeURIComponent(id)}`);
  return policyDetailSchema.parse(rawData);
}

/**
 * Fetches loss attribution diagnosis from /diagnosis?pair&window.
 * When NEXT_PUBLIC_ENGINE_URL is unconfigured, returns local sample diagnosis.
 * When configured, fetches from engine and throws on failure.
 */
export async function fetchDiagnosis(options?: {
  pair?: string;
  window?: string;
}): Promise<DiagnosisResponse> {
  if (!platformConfig.engineUrl) {
    return diagnosisResponseSchema.parse(sampleDiagnosis);
  }

  const searchParams = new URLSearchParams();
  if (options?.pair) searchParams.set("pair", options.pair);
  if (options?.window) searchParams.set("window", options.window);
  const query = searchParams.toString();
  const path = query ? `/diagnosis?${query}` : "/diagnosis";

  const rawData = await engineRequest(path);
  return diagnosisResponseSchema.parse(rawData);
}
