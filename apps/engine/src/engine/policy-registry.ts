import {
  canonicalReport,
  getV0PolicyRecord,
  type PolicyRecord,
  registrationPayloadSchema,
  V0_RUNTIME_ID,
  validateRegistrationConsistency,
} from "../policy";
import { canonicalPolicySpec } from "../research/canonical";
import { compile } from "../research/compile";
import { EngineError } from "./errors";
import { decision } from "./journal";
import type { EngineState } from "./state";

/**
 * Registers a candidate policy along with its complete evaluation report.
 *
 * Enforces:
 * - Strict schema validation of PolicySpec and EvaluationReport.
 * - Cross-field binding (spec.id === report.candidateId, report.specHash === canonical keccak256).
 * - Internal verdict consistency (report.verdict.qualified === all(reasons.passed)).
 * - Successful compilation against active engine params and mandate.
 * - Derived lifecycle status ("qualified" | "rejected") from report.verdict.qualified.
 * - Deterministic duplicate handling (idempotent if identical, 409 Conflict if conflicting).
 * - Decision journal recording for registration and qualification/rejection.
 */
export async function registerPolicy(
  context: EngineState,
  input: unknown,
  now: number,
): Promise<PolicyRecord> {
  return context.exclusive(async () => {
    const parsed = registrationPayloadSchema.safeParse(input);
    if (!parsed.success) {
      throw new EngineError("invalid_request", 400, parsed.error.issues[0]?.message);
    }
    const { spec, report } = parsed.data;

    validateRegistrationConsistency(spec, report);

    try {
      compile(spec, { params: context.deps.params, mandate: context.mandate });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new EngineError("invalid_policy", 422, `Policy spec failed compilation: ${message}`);
    }

    const existing = await context.deps.store.getPolicy(spec.id);
    if (existing) {
      const specMatch = canonicalPolicySpec(existing.spec) === canonicalPolicySpec(spec);
      const reportMatch = canonicalReport(existing.report) === canonicalReport(report);
      if (specMatch && reportMatch) {
        return existing;
      }
      throw new EngineError(
        "conflict",
        409,
        `Policy with ID '${spec.id}' already exists with different spec or report content`,
      );
    }

    const status = report.verdict.qualified ? "qualified" : "rejected";
    const record: PolicyRecord = {
      id: spec.id,
      parent: spec.parent,
      hypothesis: spec.hypothesis,
      spec,
      report,
      status,
      allocationPct: 0,
      createdAt: now,
      updatedAt: now,
    };

    await context.deps.store.savePolicy(record);

    decision(
      context,
      "policy_registered",
      now,
      `Registered candidate policy ${spec.id} (${status})`,
      {
        policyId: spec.id,
        parent: spec.parent,
        specHash: report.specHash,
        status,
      },
    );

    decision(
      context,
      status === "qualified" ? "policy_qualified" : "policy_rejected",
      now,
      `Policy ${spec.id} ${status} by evaluation report`,
      {
        policyId: spec.id,
        specHash: report.specHash,
      },
    );

    return record;
  });
}

/**
 * Retrieves a policy by ID.
 *
 * Maps "v0" or its declarative canonical ID to the built-in incumbent record.
 * Other IDs are retrieved directly from durable storage.
 */
export async function getPolicy(context: EngineState, id: string): Promise<PolicyRecord | null> {
  const v0 = getV0PolicyRecord(context.deps.params);
  if (id === V0_RUNTIME_ID || id === v0.id) {
    const stored = await context.deps.store.getPolicy(v0.id);
    return stored ?? v0;
  }
  return context.deps.store.getPolicy(id);
}

/**
 * Lists all registered policies from durable storage, always including the v0 incumbent.
 */
export async function listPolicies(context: EngineState): Promise<PolicyRecord[]> {
  const stored = await context.deps.store.listPolicies();
  const v0 = getV0PolicyRecord(context.deps.params);
  const hasV0 = stored.some((p) => p.id === v0.id);
  return hasV0 ? stored : [v0, ...stored];
}
