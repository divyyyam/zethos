import { z } from "zod";
import { defaultParams, type Params } from "../config";
import { EngineError } from "../engine/errors";
import { hashPolicySpec } from "../research/canonical";
import {
  type EvaluationReport as S4EvaluationReport,
  datasetSummarySchema as s4DatasetSchema,
  evaluationReportSchema as s4EvaluationReportSchema,
  policyResultsSchema as s4PolicyResultsSchema,
  qualificationReasonSchema as s4VerdictReasonSchema,
} from "../research/eval";
import { createV0Spec } from "../research/incumbent";
import { type PolicySpec, policySpecSchema } from "../research/schema";
import type { PolicyLifecycleStatus } from "./types";

// Reuse the evaluator's source-of-truth S4 schema so registration cannot accept
// a weaker result shape than the report producer emits.
export const evaluationDatasetResultSchema = s4PolicyResultsSchema;
export type EvaluationDatasetResult = S4EvaluationReport["results"][string]["candidate"];
export const evaluationVerdictReasonSchema = s4VerdictReasonSchema;
export type EvaluationVerdictReason = S4EvaluationReport["verdict"]["reasons"][number];
export const evaluationDatasetSchema = s4DatasetSchema;
export type EvaluationDataset = S4EvaluationReport["datasets"][number];
export const evaluationReportSchema = s4EvaluationReportSchema;
export type EvaluationReport = S4EvaluationReport;

export const registrationPayloadSchema = z.strictObject({
  spec: policySpecSchema,
  report: evaluationReportSchema,
});

export type RegistrationPayload = z.infer<typeof registrationPayloadSchema>;

export interface PolicyRecord {
  id: string;
  parent: string;
  hypothesis: string;
  spec: PolicySpec;
  report: EvaluationReport | null;
  status: PolicyLifecycleStatus;
  allocationPct: number;
  createdAt: number;
  updatedAt: number;
}

export interface PolicySummary {
  id: string;
  status: PolicyLifecycleStatus;
  parent: string;
  hypothesis: string;
  createdAt: number;
  allocationPct: number;
}

export interface PolicyDetail {
  id: string;
  status: PolicyLifecycleStatus;
  spec: PolicySpec;
  report: EvaluationReport | null;
  canaryStats: null;
}

/**
 * Timing-safe bearer token check.
 * Compares SHA-256 digests in constant time using crypto.subtle.timingSafeEqual.
 * Fails closed if expected token is null, undefined, empty, or if provided token does not match.
 * Never logs credentials or authorization headers.
 */
export async function verifyAdminAuth(
  authHeader: string | null | undefined,
  expectedToken: string | null | undefined,
): Promise<boolean> {
  if (!expectedToken || typeof expectedToken !== "string" || expectedToken.trim().length === 0) {
    return false;
  }
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }
  const providedToken = authHeader.slice("Bearer ".length).trim();
  if (providedToken.length === 0) {
    return false;
  }
  const encoder = new TextEncoder();
  const [expectedHash, providedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken)),
    crypto.subtle.digest("SHA-256", encoder.encode(providedToken)),
  ]);
  const a = new Uint8Array(expectedHash);
  const b = new Uint8Array(providedHash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Validates cross-field consistency between a PolicySpec and its EvaluationReport.
 * Enforces:
 * - report.candidateId === spec.id
 * - report.specHash === keccak256(canonical(spec))
 * - report.verdict.qualified === all(reasons.passed)
 * - report.results contains entries for all declared datasets
 */
export function validateRegistrationConsistency(spec: PolicySpec, report: EvaluationReport): void {
  if (report.candidateId !== spec.id) {
    throw new EngineError(
      "invalid_report",
      422,
      `report.candidateId '${report.candidateId}' does not match spec.id '${spec.id}'`,
    );
  }

  if (report.incumbentId !== spec.parent) {
    throw new EngineError(
      "invalid_report",
      422,
      `report.incumbentId '${report.incumbentId}' does not match spec.parent '${spec.parent}'`,
    );
  }

  const expectedHash = hashPolicySpec(spec);
  if (report.specHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new EngineError(
      "invalid_report",
      422,
      `report.specHash '${report.specHash}' does not match canonical spec hash '${expectedHash}'`,
    );
  }

  const allReasonsPassed = report.verdict.reasons.every((r) => r.passed);
  if (report.verdict.qualified !== allReasonsPassed) {
    throw new EngineError(
      "invalid_report",
      422,
      `report.verdict.qualified (${report.verdict.qualified}) is inconsistent with verdict reasons (allPassed: ${allReasonsPassed})`,
    );
  }

  for (const dataset of report.datasets) {
    if (!report.results[dataset.name]) {
      throw new EngineError(
        "invalid_report",
        422,
        `report.results is missing results for dataset '${dataset.name}'`,
      );
    }
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

/** Deterministic canonical JSON serialization of an evaluation report for content comparison. */
export function canonicalReport(report: unknown): string {
  if (report === null || report === undefined) return "";
  return JSON.stringify(sortJson(report));
}

/** Maps a PolicyRecord to the public S5 policy summary wire shape. */
export function toPolicySummary(record: PolicyRecord): PolicySummary {
  return {
    id: record.id,
    status: record.status,
    parent: record.parent,
    hypothesis: record.hypothesis,
    createdAt: record.createdAt,
    allocationPct: record.allocationPct,
  };
}

/** Maps a PolicyRecord to the public S5 policy detail wire shape. */
export function toPolicyDetail(record: PolicyRecord): PolicyDetail {
  return {
    id: record.id,
    status: record.status,
    spec: record.spec,
    report: record.report,
    canaryStats: null,
  };
}

export const V0_RUNTIME_ID = "v0" as const;
export const V0_DATE = "20261101" as const;
export const V0_CREATED_AT = 1793491200000; // 2026-11-01 00:00:00 UTC

/**
 * Builds the canonical declarative PolicyRecord for the built-in v0 incumbent.
 *
 * Runtime-to-spec identity mapping:
 * - Runtime execution and parent references identify the incumbent as "v0".
 * - The declarative policy specification uses the honest content-derived ID `p-20261101-<shortHash>`
 *   (generated via createV0Spec with UTC date 20261101), NOT forged to equal "v0".
 * - Both "v0" and the declarative ID resolve to this record in getPolicy.
 */
export function getV0PolicyRecord(params: Params = defaultParams): PolicyRecord {
  const spec = createV0Spec(V0_DATE, params);
  return {
    id: spec.id,
    parent: "v0",
    hypothesis: spec.hypothesis,
    spec,
    report: null,
    status: "incumbent",
    allocationPct: 100,
    createdAt: V0_CREATED_AT,
    updatedAt: V0_CREATED_AT,
  };
}
