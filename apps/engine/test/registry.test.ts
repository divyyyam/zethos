import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/api";
import { defaultParams } from "../src/config";
import { memoryStore } from "../src/db/memory";
import { Engine } from "../src/engine";
import { type EvaluationReport, verifyAdminAuth } from "../src/policy";
import { createPolicySpec, hashPolicySpec } from "../src/research/canonical";
import { createV0Spec } from "../src/research/incumbent";
import type { PolicySpec } from "../src/research/schema";
import { readyEngine, SIGNER_KEY, TAKER, tokens, usdt } from "./helpers";

const ADMIN_TOKEN = "secret_admin_token_for_tests_12345678";

const json = async (res: Response): Promise<Record<string, unknown>> => {
  const value = await res.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return value as Record<string, unknown>;
};

interface PolicySummaryRecord {
  id: string;
  status: string;
  parent?: string;
  allocationPct?: number;
}

const jsonList = async (res: Response): Promise<{ policies: PolicySummaryRecord[] }> => {
  const value = await json(res);
  return value as unknown as { policies: PolicySummaryRecord[] };
};

interface PolicyDetailRecord {
  id: string;
  status: string;
  spec: { id: string; reference: { kind: string } };
  report: { specHash: string } | null;
  canaryStats: unknown;
}

const jsonDetail = async (res: Response): Promise<PolicyDetailRecord> => {
  const value = await json(res);
  return value as unknown as PolicyDetailRecord;
};

function makeCandidate(overrides: { bpsHsk?: number; date?: string; hypothesis?: string } = {}) {
  const body = {
    parent: "v0",
    hypothesis:
      overrides.hypothesis ??
      "Tighten base spread on HSK/USDT to 12 bps to capture more volume without adverse selection.",
    pairs: ["HSK/USDT", "ETH/USDT"],
    reference: { kind: "depthWeighted", params: {} },
    terms: [
      { kind: "base", params: { bps: { "HSK/USDT": overrides.bpsHsk ?? 12, "ETH/USDT": 10 } } },
      { kind: "vol", params: { k: 2.0 } },
      { kind: "inventory", params: { k: 0.0015 } },
      { kind: "toxicity", params: { scale: 1.0 } },
      { kind: "tuner", params: {} },
    ],
    clamp: { minBps: 5, maxBps: 300 },
    ttl: { kind: "volScaled", ttlVolK: 1.5, minSec: 5, maxSec: 30 },
    rejectIf: { maxSigma1: 0.05, minSources: 2, leadDivergenceBps: 25 },
  };
  return createPolicySpec(body, overrides.date ?? "20261101");
}

function makeReport(
  spec: ReturnType<typeof makeCandidate>,
  options: { qualified?: boolean; reasonsPassed?: boolean; mismatchHash?: boolean } = {},
): EvaluationReport {
  const qualified = options.qualified ?? true;
  const reasonsPassed = options.reasonsPassed ?? qualified;
  const specHash = options.mismatchHash
    ? "0x1111111111111111111111111111111111111111111111111111111111111111"
    : hashPolicySpec(spec);

  return {
    candidateId: spec.id,
    incumbentId: "v0",
    specHash,
    codeRevision: "0eabb53",
    rulesVersion: "1.0",
    seed: 42,
    createdAt: 1730419200000,
    datasets: [
      { name: "synthetic-dev-tape", kind: "dev", requests: 100 },
      { name: "heldout-leadlag-attack", kind: "heldout", requests: 50 },
    ],
    results: {
      "synthetic-dev-tape": {
        candidate: {
          netUsd: 120.5,
          spreadCaptureUsd: 150.0,
          inventoryPnlUsd: -29.5,
          maxDrawdownPct: 0.005,
          avgHalfSpreadBps: 14.2,
          honestFillRate: 0.85,
          rejectRate: 0.04,
          attackerTakeUsd: 10.0,
          fills: 85,
        },
        incumbent: {
          netUsd: 100.0,
          spreadCaptureUsd: 140.0,
          inventoryPnlUsd: -40.0,
          maxDrawdownPct: 0.008,
          avgHalfSpreadBps: 16.5,
          honestFillRate: 0.8,
          rejectRate: 0.05,
          attackerTakeUsd: 15.0,
          fills: 80,
        },
      },
      "heldout-leadlag-attack": {
        candidate: {
          netUsd: 45.0,
          maxDrawdownPct: 0.004,
          avgHalfSpreadBps: 15.0,
          honestFillRate: 0.9,
          rejectRate: 0.02,
          fills: 45,
        },
        incumbent: {
          netUsd: 30.0,
          maxDrawdownPct: 0.007,
          avgHalfSpreadBps: 17.0,
          honestFillRate: 0.88,
          rejectRate: 0.03,
          fills: 44,
        },
      },
    },
    verdict: {
      qualified,
      reasons: [
        {
          rule: "mustBeatHeldOut",
          passed: reasonsPassed,
          candidate: qualified ? 45.0 : 20.0,
          incumbent: 30.0,
          threshold: 30.0,
          detail: qualified ? "Beat incumbent on held-out" : "Failed to beat incumbent",
        },
      ],
    },
  };
}

async function createTestApp(options: { adminToken?: string | null; engine?: Engine } = {}) {
  const engine = options.engine ?? (await readyEngine({ now: 1_800_000_000_000 })).engine;
  return {
    app: createApp({
      engine: async () => engine,
      corsOrigins: ["http://localhost:3000"],
      waitUntil: () => {},
      adminToken: options.adminToken === undefined ? ADMIN_TOKEN : options.adminToken,
    }),
    engine,
  };
}

describe("R8A: Policy Registry", () => {
  describe("timing-safe auth helper", () => {
    test("verifies valid bearer tokens and rejects invalid inputs timing-safely", async () => {
      expect(await verifyAdminAuth(`Bearer ${ADMIN_TOKEN}`, ADMIN_TOKEN)).toBe(true);
      expect(await verifyAdminAuth(`Bearer ${ADMIN_TOKEN} `, ADMIN_TOKEN)).toBe(true);

      // Wrong token
      expect(await verifyAdminAuth("Bearer wrong_token", ADMIN_TOKEN)).toBe(false);

      // Missing Bearer prefix
      expect(await verifyAdminAuth(ADMIN_TOKEN, ADMIN_TOKEN)).toBe(false);
      expect(await verifyAdminAuth("Basic abc", ADMIN_TOKEN)).toBe(false);

      // Empty / missing credentials
      expect(await verifyAdminAuth(null, ADMIN_TOKEN)).toBe(false);
      expect(await verifyAdminAuth(undefined, ADMIN_TOKEN)).toBe(false);
      expect(await verifyAdminAuth("", ADMIN_TOKEN)).toBe(false);
      expect(await verifyAdminAuth("Bearer ", ADMIN_TOKEN)).toBe(false);

      // Unconfigured expected token fails closed
      expect(await verifyAdminAuth(`Bearer ${ADMIN_TOKEN}`, null)).toBe(false);
      expect(await verifyAdminAuth(`Bearer ${ADMIN_TOKEN}`, undefined)).toBe(false);
      expect(await verifyAdminAuth(`Bearer ${ADMIN_TOKEN}`, "")).toBe(false);
      expect(await verifyAdminAuth(`Bearer ${ADMIN_TOKEN}`, "   ")).toBe(false);
    });
  });

  describe("POST /policies authorization", () => {
    test("fails closed with 401 when ADMIN_TOKEN is unconfigured", async () => {
      const { app } = await createTestApp({ adminToken: null });
      const spec = makeCandidate();
      const report = makeReport(spec);

      const res = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report }),
      });

      expect(res.status).toBe(401);
      const data = await json(res);
      expect(data.error).toBe("unauthorized");
    });

    test("fails with 401 on missing or invalid Authorization header", async () => {
      const { app } = await createTestApp();
      const spec = makeCandidate();
      const report = makeReport(spec);

      // Missing header
      const res1 = await app.request("/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, report }),
      });
      expect(res1.status).toBe(401);

      // Wrong token
      const res2 = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong_token_value",
        },
        body: JSON.stringify({ spec, report }),
      });
      expect(res2.status).toBe(401);
    });
  });

  describe("POST /policies input validation & compilation", () => {
    test("rejects malformed bodies and strict schema violations", async () => {
      const { app } = await createTestApp();

      // Non-JSON
      const resNonJson = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: "not json",
      });
      expect(resNonJson.status).toBe(400);

      // Missing report
      const spec = makeCandidate();
      const resMissingReport = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec }),
      });
      expect(resMissingReport.status).toBe(400);

      // Extra unknown property in spec
      const badSpec = { ...spec, extraUnknownProp: "sneaky" };
      const resExtra = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec: badSpec, report: makeReport(spec) }),
      });
      expect(resExtra.status).toBe(400);

      // Spec ID does not match body content
      const tamperedSpec = { ...spec, id: "p-20261101-00000000" };
      const resTampered = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec: tamperedSpec, report: makeReport(spec) }),
      });
      expect(resTampered.status).toBe(400);
    });

    test("rejects inconsistent report fields (candidateId, specHash, verdict)", async () => {
      const { app } = await createTestApp();
      const spec = makeCandidate();

      // candidateId mismatch
      const reportBadId = { ...makeReport(spec), candidateId: "p-20261101-12345678" };
      const resBadId = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report: reportBadId }),
      });
      expect(resBadId.status).toBe(422);
      expect((await json(resBadId)).error).toBe("invalid_report");

      // specHash mismatch
      const reportBadHash = makeReport(spec, { mismatchHash: true });
      const resBadHash = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report: reportBadHash }),
      });
      expect(resBadHash.status).toBe(422);

      // verdict qualified=true but reasons has passed=false
      const reportBadVerdict1 = makeReport(spec, { qualified: true, reasonsPassed: false });
      const resBadVerdict1 = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report: reportBadVerdict1 }),
      });
      expect(resBadVerdict1.status).toBe(422);

      // verdict qualified=false but reasons has passed=true
      const reportBadVerdict2 = makeReport(spec, { qualified: false, reasonsPassed: true });
      const resBadVerdict2 = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report: reportBadVerdict2 }),
      });
      expect(resBadVerdict2.status).toBe(422);

      // declared dataset missing from results
      const reportMissingDataset = {
        ...makeReport(spec),
        datasets: [
          { name: "synthetic-dev-tape", kind: "dev" as const },
          { name: "missing-dataset-name", kind: "scenario" as const },
        ],
      };
      const resMissingDataset = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report: reportMissingDataset }),
      });
      expect(resMissingDataset.status).toBe(422);
    });

    test("compiles submitted spec against current engine params and mandate", async () => {
      const { app } = await createTestApp();

      // Spec with pair outside mandate
      // Note: we must build a valid PolicySpec first to get past schema parsing
      // but compile will fail because the pair is outside the mandate
      const bodyOutsideMandate = {
        parent: "v0",
        hypothesis: "Trying to quote a pair outside enabled pairs",
        pairs: ["HSK/USDT"], // valid pair for schema
        reference: { kind: "depthWeighted", params: {} },
        terms: [
          { kind: "base", params: { bps: { "HSK/USDT": 15 } } },
          { kind: "tuner", params: {} },
        ],
        clamp: { minBps: 1, maxBps: 2000 }, // clamp exceeds owner spread max (params.spread.max = 0.05 = 500 bps)
        ttl: { kind: "volScaled", ttlVolK: 1.5, minSec: 5, maxSec: 30 },
      };
      const badClampSpec = createPolicySpec(bodyOutsideMandate, "20261101");
      const badClampReport = makeReport(badClampSpec as PolicySpec);

      const res = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec: badClampSpec, report: badClampReport }),
      });
      expect(res.status).toBe(422);
      expect((await json(res)).error).toBe("invalid_policy");
    });
  });

  describe("status derivation and duplicate handling", () => {
    test("derives status qualified when verdict.qualified is true", async () => {
      const { app, engine } = await createTestApp();
      const spec = makeCandidate({ bpsHsk: 14 });
      const report = makeReport(spec, { qualified: true });

      const res = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report }),
      });

      expect(res.status).toBe(200);
      const data = await jsonDetail(res);
      expect(data.id).toBe(spec.id);
      expect(data.status).toBe("qualified");
      expect(data.canaryStats).toBeNull();
      expect(data.spec.id).toBe(spec.id);

      // Verify stored in engine
      const stored = await engine.getPolicy(spec.id);
      expect(stored).not.toBeNull();
      expect(stored?.status).toBe("qualified");
      expect(stored?.allocationPct).toBe(0);

      // Verify journal emission
      const decisions = engine.decisions(10);
      const registeredDecision = decisions.find(
        (d) => d.type === "policy_registered" && d.inputs.policyId === spec.id,
      );
      expect(registeredDecision).toBeDefined();
      expect(registeredDecision?.inputs.status).toBe("qualified");

      const qualifiedDecision = decisions.find(
        (d) => d.type === "policy_qualified" && d.inputs.policyId === spec.id,
      );
      expect(qualifiedDecision).toBeDefined();
    });

    test("derives status rejected when verdict.qualified is false", async () => {
      const { app, engine } = await createTestApp();
      const spec = makeCandidate({ bpsHsk: 16 });
      const report = makeReport(spec, { qualified: false });

      const res = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report }),
      });

      expect(res.status).toBe(200);
      const data = await jsonDetail(res);
      expect(data.status).toBe("rejected");

      const stored = await engine.getPolicy(spec.id);
      expect(stored?.status).toBe("rejected");
      expect(stored?.allocationPct).toBe(0);

      // Verify journal emission
      const decisions = engine.decisions(10);
      const rejectedDecision = decisions.find(
        (d) => d.type === "policy_rejected" && d.inputs.policyId === spec.id,
      );
      expect(rejectedDecision).toBeDefined();
    });

    test("handles duplicates deterministically: idempotent return for identical, 409 Conflict for conflicting", async () => {
      const { app } = await createTestApp();
      const spec = makeCandidate({ bpsHsk: 18 });
      const report = makeReport(spec, { qualified: true });

      // First registration succeeds
      const res1 = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report }),
      });
      expect(res1.status).toBe(200);

      // Second identical registration is idempotent 200
      const res2 = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report }),
      });
      expect(res2.status).toBe(200);
      const data2 = await jsonDetail(res2);
      expect(data2.id).toBe(spec.id);

      // Third registration with same spec ID but different report (e.g. different seed/revision) rejects with 409
      const conflictingReport: EvaluationReport = {
        ...report,
        seed: 9999, // different seed changes content
      };
      const res3 = await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report: conflictingReport }),
      });
      expect(res3.status).toBe(409);
      expect((await json(res3)).error).toBe("conflict");
    });
  });

  describe("Public reads & v0 incumbent representation", () => {
    test("GET /policies lists summaries including honest v0 incumbent and registered policies", async () => {
      const { app } = await createTestApp();
      const spec = makeCandidate({ bpsHsk: 20 });
      const report = makeReport(spec, { qualified: true });

      // Register one policy
      await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report }),
      });

      // Public GET without any Authorization header
      const res = await app.request("/policies");
      expect(res.status).toBe(200);
      const body = await jsonList(res);
      expect(Array.isArray(body.policies)).toBe(true);

      const v0Spec = createV0Spec("20261101", defaultParams);
      const v0Summary = body.policies.find((p: { id: string }) => p.id === v0Spec.id);
      expect(v0Summary).toBeDefined();
      expect(v0Summary?.status).toBe("incumbent");
      expect(v0Summary?.parent).toBe("v0");
      expect(v0Summary?.allocationPct).toBe(100);
      expect(v0Summary?.id).toMatch(/^p-20261101-[0-9a-f]{8}$/);

      const candidateSummary = body.policies.find((p: { id: string }) => p.id === spec.id);
      expect(candidateSummary).toBeDefined();
      expect(candidateSummary?.status).toBe("qualified");
      expect(candidateSummary?.allocationPct).toBe(0);
    });

    test("GET /policies/:id resolves both 'v0' and its canonical ID to incumbent detail", async () => {
      const { app } = await createTestApp();
      const v0Spec = createV0Spec("20261101", defaultParams);

      // Query via alias "v0"
      const resAlias = await app.request("/policies/v0");
      expect(resAlias.status).toBe(200);
      const detailAlias = await jsonDetail(resAlias);
      expect(detailAlias.id).toBe(v0Spec.id);
      expect(detailAlias.status).toBe("incumbent");
      expect(detailAlias.spec.id).toBe(v0Spec.id);
      expect(detailAlias.spec.reference.kind).toBe("depthWeighted");
      expect(detailAlias.report).toBeNull();
      expect(detailAlias.canaryStats).toBeNull();

      // Query via canonical content-derived ID
      const resCanonical = await app.request(`/policies/${v0Spec.id}`);
      expect(resCanonical.status).toBe(200);
      const detailCanonical = await jsonDetail(resCanonical);
      expect(detailCanonical.id).toBe(v0Spec.id);
      expect(detailCanonical.status).toBe("incumbent");
    });

    test("GET /policies/:id returns candidate detail or 404 for unknown ID", async () => {
      const { app } = await createTestApp();
      const spec = makeCandidate({ bpsHsk: 22 });
      const report = makeReport(spec, { qualified: true });

      await app.request("/policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ spec, report }),
      });

      // Existing candidate
      const res = await app.request(`/policies/${spec.id}`);
      expect(res.status).toBe(200);
      const detail = await jsonDetail(res);
      expect(detail.id).toBe(spec.id);
      expect(detail.status).toBe("qualified");
      expect(detail.spec.id).toBe(spec.id);
      expect(detail.report?.specHash).toBe(hashPolicySpec(spec));
      expect(detail.canaryStats).toBeNull();

      // Unknown policy
      const resUnknown = await app.request("/policies/p-20261101-deadbeef");
      expect(resUnknown.status).toBe(404);
      expect((await json(resUnknown)).error).toBe("not_found");
    });
  });

  describe("durable persistence across store / engine reconstruction", () => {
    test("survives engine reconstruction and arena reset", async () => {
      const sharedStore = memoryStore();
      const now = 1_800_000_000_000;

      // Boot engine 1 with feeds ready
      const { engine: engine1 } = await readyEngine({ store: sharedStore, now });

      const spec = makeCandidate({ bpsHsk: 24 });
      const report = makeReport(spec, { qualified: true });
      await engine1.registerPolicy({ spec, report }, now);

      // Arena reset should NOT affect policies
      await engine1.resetArena(TAKER, now + 1000);
      expect(await engine1.getPolicy(spec.id)).not.toBeNull();

      // Boot engine 2 with same store (simulating process restart)
      const engine2 = new Engine({
        chainId: 177,
        params: defaultParams,
        tokens,
        store: sharedStore,
        signer: privateKeyToAccount(SIGNER_KEY),
      });
      await engine2.init();

      // Policy is still present in engine 2
      const restored = await engine2.getPolicy(spec.id);
      expect(restored).not.toBeNull();
      expect(restored?.id).toBe(spec.id);
      expect(restored?.status).toBe("qualified");

      const all = await engine2.listPolicies();
      expect(all.some((p) => p.id === spec.id)).toBe(true);
      expect(all.some((p) => p.id === createV0Spec("20261101", defaultParams).id)).toBe(true);
    });
  });

  describe("current behavior preserved", () => {
    test("registration does not activate candidate; pricing and quoting remain identical", async () => {
      const { engine } = await readyEngine({ now: 1_800_000_000_000 });
      const now = 1_800_000_000_000;

      // Price before registration
      const { response: quoteBefore } = await engine.quote(
        {
          taker: TAKER,
          tokenIn: tokens.USDT.address,
          tokenOut: tokens.WHSK.address,
          amountIn: usdt(100),
        },
        "web",
        now,
      );

      // Register candidate with much narrower base spread
      const spec = makeCandidate({ bpsHsk: 1 });
      const report = makeReport(spec, { qualified: true });
      await engine.registerPolicy({ spec, report }, now);

      // Price after registration: must be bit-identical because candidate is NOT active
      const { response: quoteAfter } = await engine.quote(
        {
          taker: TAKER,
          tokenIn: tokens.USDT.address,
          tokenOut: tokens.WHSK.address,
          amountIn: usdt(100),
        },
        "web",
        now,
      );

      expect(quoteAfter.paperOut).toBe(quoteBefore.paperOut);
      expect(quoteAfter.breakdown.half).toBe(quoteBefore.breakdown.half);
      expect(quoteAfter.breakdown.base).toBe(quoteBefore.breakdown.base);
    });
  });
});
