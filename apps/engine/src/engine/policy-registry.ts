import { baseQuantity } from "../markouts";
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
import { pairTokens } from "./market";
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

    context.deps.emit?.({
      type: "policies",
      policies: (await listPolicies(context)).map((policy) => ({
        id: policy.id,
        status: policy.status,
        parent: policy.parent,
        hypothesis: policy.hypothesis,
        createdAt: policy.createdAt,
        allocationPct: policy.allocationPct,
      })),
    });

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

/** Starts a qualified candidate as the sole canary, under the mandate allocation cap. */
export async function startCanary(
  context: EngineState,
  id: string,
  allocationPct: number,
  now: number,
): Promise<PolicyRecord> {
  return context.exclusive(async () => {
    if (
      !Number.isInteger(allocationPct) ||
      allocationPct < 1 ||
      allocationPct > context.mandate.canary.maxAllocationPct
    )
      throw new EngineError(
        "invalid_request",
        400,
        "allocationPct must be an integer within the mandate canary cap",
      );
    const record = await context.deps.store.getPolicy(id);
    if (!record) throw new EngineError("not_found", 404, `Policy '${id}' not found`);
    if (record.status !== "qualified")
      throw new EngineError("invalid_policy", 409, "Only qualified policies can enter canary");
    if (context.canary) throw new EngineError("conflict", 409, "A canary policy is already active");
    const incumbentId = context.activePolicy?.record.id ?? "v0";
    if (
      record.parent !== incumbentId &&
      record.parent !== getV0PolicyRecord(context.deps.params).id
    )
      throw new EngineError("invalid_policy", 409, "Canary parent must match the active incumbent");
    const updated = { ...record, status: "canary" as const, allocationPct, updatedAt: now };
    await context.deps.store.savePolicy(updated);
    context.canary = {
      record: updated,
      policy: compile(updated.spec, { params: context.deps.params, mandate: context.mandate }),
    };
    decision(context, "canary_started", now, `Started canary ${id} at ${allocationPct}%`, {
      policyId: id,
      allocationPct,
    });
    await emitPolicySnapshot(context);
    return updated;
  });
}

/** Promotes the active canary after minimum observations and live safety checks. */
export async function promotePolicy(
  context: EngineState,
  id: string,
  now: number,
): Promise<PolicyRecord> {
  return context.exclusive(async () => {
    const canary = context.canary;
    if (!canary || canary.record.id !== id)
      throw new EngineError("invalid_policy", 409, "Policy is not the active canary");
    const fills = context.ledger.filter((fill) => fill.policyId === id);
    if (fills.length < context.mandate.canary.minFillsBeforePromote)
      throw new EngineError("invalid_policy", 409, "Canary has not reached minFillsBeforePromote");
    const stats = await canaryStats(context, id);
    if (
      (stats.drawdownPct ?? 0) >= context.mandate.canary.retireDrawdownPct ||
      (stats.fillRateDrop ?? 0) >= context.mandate.canary.retireFillRateDrop
    )
      throw new EngineError("invalid_policy", 409, "Canary live safety guard is failing");

    const previous = context.activePolicy?.record ?? getV0PolicyRecord(context.deps.params);
    if (previous.id !== id) {
      await context.deps.store.savePolicy({
        ...previous,
        status: "retired",
        allocationPct: 0,
        updatedAt: now,
      });
    }
    const promoted = {
      ...canary.record,
      status: "incumbent" as const,
      allocationPct: 100,
      updatedAt: now,
    };
    await context.deps.store.savePolicy(promoted);
    context.activePolicy = { record: promoted, policy: canary.policy };
    context.canary = null;
    decision(context, "policy_promoted", now, `Promoted canary ${id} to incumbent`, {
      policyId: id,
      priorIncumbentId: previous.id,
      fills: fills.length,
    });
    await emitPolicySnapshot(context);
    return promoted;
  });
}

/** Retires any registered policy; active policies are removed from routing immediately. */
export async function retirePolicy(
  context: EngineState,
  id: string,
  now: number,
): Promise<PolicyRecord> {
  return context.exclusive(async () => {
    const record = await getPolicy(context, id);
    if (!record) throw new EngineError("not_found", 404, `Policy '${id}' not found`);
    if (id === "v0" || id === getV0PolicyRecord(context.deps.params).id)
      throw new EngineError("invalid_policy", 409, "The built-in v0 policy cannot be retired");
    if (context.activePolicy?.record.id === id)
      throw new EngineError(
        "invalid_policy",
        409,
        "Promote a replacement before retiring the incumbent",
      );
    const retired = { ...record, status: "retired" as const, allocationPct: 0, updatedAt: now };
    await context.deps.store.savePolicy(retired);
    if (context.canary?.record.id === id) context.canary = null;
    decision(context, "policy_retired", now, `Retired policy ${id}`, { policyId: id });
    await emitPolicySnapshot(context);
    return retired;
  });
}

export async function canaryStats(context: EngineState, id: string) {
  const fills = context.ledger.filter((fill) => fill.policyId === id);
  const quoteRecords = context.arena
    ? await context.deps.store.loadQuotes(context.arena.epoch)
    : [];
  const quoteById = new Map(quoteRecords.map((record) => [record.id, record]));
  const markoutPnl = (fill: (typeof fills)[number]) => {
    const mark = context.state.markouts.find(
      (item) => item.fillId === fill.id && item.horizon === 300,
    );
    const decimals = pairTokens(context, fill.pair).base.decimals;
    return mark ? (mark.bps / 10_000) * fill.price * baseQuantity(fill, decimals) : null;
  };
  const pnl = fills.map(markoutPnl).filter((value): value is number => value !== null);
  const counterfactual: number[] = [];
  for (const fill of context.ledger) {
    if (fill.policyId === id) continue;
    const breakdown = quoteById.get(fill.quoteId)?.breakdown;
    if (!breakdown || typeof breakdown !== "object") continue;
    const comparison = (breakdown as { policyComparison?: Record<string, unknown> })
      .policyComparison;
    if (!comparison || comparison.canaryId !== id || comparison.assignedCanary !== false) continue;
    const alternatePrice = comparison.canaryPrice;
    const mark = context.state.markouts.find(
      (item) => item.fillId === fill.id && item.horizon === 300,
    );
    if (typeof alternatePrice !== "number" || !mark) continue;
    // Count a counterfactual fill only when the alternate quote was at least as
    // competitive as the actually-filled quote for that same taker request.
    const competitive =
      fill.side === "buy" ? alternatePrice <= fill.price : alternatePrice >= fill.price;
    if (!competitive) continue;
    const quantity = baseQuantity(fill, pairTokens(context, fill.pair).base.decimals);
    counterfactual.push(
      (fill.side === "buy" ? alternatePrice - mark.mid : mark.mid - alternatePrice) * quantity,
    );
  }
  let equity = 0;
  let peak = 0;
  let maxDrawdownPct = 0;
  for (const value of pnl) {
    equity += value;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - equity) / peak);
  }
  const quotes = quoteRecords.filter((record) => record.policyId === id).length;
  const incumbentId = context.activePolicy?.record.id ?? context.deps.policy?.id ?? "v0";
  const incumbentQuotes = quoteRecords.filter((record) => record.policyId === incumbentId).length;
  const incumbentFills = context.ledger.filter((fill) => fill.policyId === incumbentId).length;
  const incumbentRate = incumbentQuotes ? incumbentFills / incumbentQuotes : 0;
  const canaryRate = quotes ? fills.length / quotes : 0;
  return {
    observedFills: fills.length,
    observedPnlUsd: pnl.reduce((sum, value) => sum + value, 0),
    counterfactualFills: counterfactual.length,
    counterfactualPnlUsd: counterfactual.reduce((sum, value) => sum + value, 0),
    fillRateDrop: Math.max(0, incumbentRate - canaryRate),
    drawdownPct: maxDrawdownPct,
  };
}

/** Applies the frozen live canary retirement guards from a serialized heartbeat. */
export async function enforceCanaryGuards(context: EngineState, now: number): Promise<void> {
  const canary = context.canary;
  if (!canary) return;
  const stats = await canaryStats(context, canary.record.id);
  const drawdownBreached = (stats.drawdownPct ?? 0) >= context.mandate.canary.retireDrawdownPct;
  const fillRateBreached = (stats.fillRateDrop ?? 0) >= context.mandate.canary.retireFillRateDrop;
  if (!drawdownBreached && !fillRateBreached) return;
  const retired = {
    ...canary.record,
    status: "retired" as const,
    allocationPct: 0,
    updatedAt: now,
  };
  await context.deps.store.savePolicy(retired);
  context.canary = null;
  decision(
    context,
    "policy_retired",
    now,
    `Auto-retired canary ${retired.id} after live guard breach`,
    {
      policyId: retired.id,
      drawdownPct: stats.drawdownPct ?? 0,
      fillRateDrop: stats.fillRateDrop ?? 0,
      drawdownBreached: drawdownBreached ? 1 : 0,
      fillRateBreached: fillRateBreached ? 1 : 0,
    },
  );
  await emitPolicySnapshot(context);
}

async function emitPolicySnapshot(context: EngineState): Promise<void> {
  context.deps.emit?.({
    type: "policies",
    policies: (await listPolicies(context)).map((policy) => ({
      id: policy.id,
      status: policy.status,
      parent: policy.parent,
      hypothesis: policy.hypothesis,
      createdAt: policy.createdAt,
      allocationPct: policy.allocationPct,
    })),
  });
}
