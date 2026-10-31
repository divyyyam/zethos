import { z } from "zod";
import { sampleDeskPolicies } from "../../content/desk.mock";
import { platformConfig } from "../platform-config";
import { engineRequest } from "./client";

export const POLICY_STATUSES = [
  "draft",
  "qualified",
  "rejected",
  "canary",
  "incumbent",
  "retired",
] as const;

export type PolicyLifecycleStatus = (typeof POLICY_STATUSES)[number];

export const policySummarySchema = z.strictObject({
  id: z.string(),
  status: z.enum(POLICY_STATUSES),
  parent: z.string(),
  hypothesis: z.string().max(500),
  createdAt: z.number(),
  allocationPct: z.number().min(0).max(100).optional(),
  liveStats: z
    .strictObject({
      fills: z.number().optional(),
      volumeUsd: z.number().optional(),
      drawdownPct: z.number().optional(),
      fillRate: z.number().optional(),
    })
    .optional(),
});

export type PolicySummary = z.infer<typeof policySummarySchema>;

export const policyListResponseSchema = z.union([
  z.array(policySummarySchema),
  z.strictObject({ policies: z.array(policySummarySchema) }),
]);

/**
 * Fetches the list of registered policies from the engine registry.
 * When NEXT_PUBLIC_ENGINE_URL is unconfigured, returns the validated sample list.
 * When NEXT_PUBLIC_ENGINE_URL is configured, fetches from /policies and never falls back to sample data.
 */
export async function fetchPolicies(): Promise<PolicySummary[]> {
  if (!platformConfig.engineUrl) {
    return sampleDeskPolicies.map((p) => policySummarySchema.parse(p));
  }

  const rawData = await engineRequest("/policies");
  const parsed = policyListResponseSchema.parse(rawData);
  if (Array.isArray(parsed)) return parsed;
  return parsed.policies;
}
