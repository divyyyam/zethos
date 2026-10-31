import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { sampleDiagnosis, samplePolicyDetails } from "../src/content/research.mock";
import {
  describeClamp,
  describeReference,
  describeTerm,
  describeTtl,
  diagnosisResponseSchema,
  fetchDiagnosis,
  fetchPolicyDetail,
  policyDetailSchema,
} from "../src/lib/engine/research-types";
import { platformConfig } from "../src/lib/platform-config";

const originalFetch = globalThis.fetch;
const originalUrl = platformConfig.engineUrl;

function respond(body: unknown, status = 200) {
  globalThis.fetch = (async () => Response.json(body, { status })) as typeof fetch;
}

beforeEach(() => {
  platformConfig.engineUrl = null;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  platformConfig.engineUrl = originalUrl;
});

describe("research schema validation and sample fixtures", () => {
  test("validates all sample policy details against policyDetailSchema", () => {
    for (const [id, detail] of Object.entries(samplePolicyDetails)) {
      const parsed = policyDetailSchema.parse(detail);
      assert.equal(parsed.id, id);
      assert.ok(parsed.spec);
      if (parsed.report) {
        assert.equal(parsed.report.candidateId, id);
      }
    }
  });

  test("validates sample diagnosis against diagnosisResponseSchema", () => {
    const parsed = diagnosisResponseSchema.parse(sampleDiagnosis);
    assert.equal(parsed.totalLossUsd, 142.5);
    assert.ok(parsed.causes.stale_reference);
    assert.ok(parsed.causes.selective_execution);
    assert.ok(parsed.causes.adverse_size);
    assert.ok(parsed.causes.inventory_imbalance);
    assert.equal(parsed.causes.stale_reference.share, 0.45);
    assert.equal(parsed.causes.stale_reference.exampleFillIds.length, 3);
  });
});

describe("readable component and policy configuration rendering", () => {
  const leadLagPolicy = samplePolicyDetails["p-20261101-leadlag1"];
  assert.ok(leadLagPolicy);
  const sampleSpec = leadLagPolicy.spec;
  assert.ok(sampleSpec);

  test("formats reference descriptions correctly", () => {
    assert.equal(
      describeReference({ kind: "median", params: {} }),
      "Median reference across all active healthy venues",
    );
    assert.equal(
      describeReference({ kind: "depthWeighted", params: {} }),
      "Depth-weighted reference walk across merged order books (incumbent)",
    );
    assert.equal(
      describeReference({
        kind: "leadWeighted",
        params: { leadVenues: ["hashkey-global", "binance"], leadWeight: 0.65, lookbackSec: 15 },
      }),
      "Lead-weighted reference (hashkey-global, binance) with 65% weight, 15s lookback",
    );
  });

  test("formats clamp bounds into readable percentages and basis points", () => {
    const desc = describeClamp({ minBps: 6, maxBps: 350 });
    assert.equal(desc, "Min 6 bps (0.06%) – Max 350 bps (3.50%)");
  });

  test("formats TTL scaling parameters into readable text", () => {
    const desc = describeTtl({ kind: "volScaled", ttlVolK: 1.2, minSec: 4, maxSec: 25 });
    assert.equal(desc, "Volatility-scaled TTL (k = 1.2, window 4s – 25s)");
  });

  test("renders one readable line per component and parameters", () => {
    const baseDesc = describeTerm({
      kind: "base",
      params: { bps: { "HSK/USDT": 15, "ETH/USDT": 10 } },
    });
    assert.ok(baseDesc.includes("Base spread:"));
    assert.ok(baseDesc.includes("HSK/USDT: 15 bps"));

    const volDesc = describeTerm({ kind: "vol", params: { k: 2.2 } });
    assert.equal(volDesc, "Volatility scaling: k = 2.2 (volatility-adjusted half-spread)");

    const leadMoveDesc = describeTerm({
      kind: "leadMove",
      params: { thresholdBps: 6, windowSec: 10, addBps: 25 },
    });
    assert.equal(leadMoveDesc, "Lead move defense: widen +25 bps when lead moves > 6 bps in 10s");

    const depthDesc = describeTerm({
      kind: "depthWithdrawal",
      params: { dropPct: 0.4, windowSec: 15, addBps: 18 },
    });
    assert.equal(
      depthDesc,
      "Depth withdrawal defense: widen +18 bps if top depth drops 40% within 15s",
    );

    const tunerDesc = describeTerm({ kind: "tuner", params: {} });
    assert.equal(tunerDesc, "Live tuner: dynamic multiplier tuned from fill markout feedback");
  });
});

describe("evaluation dataset grouping and verdict handling", () => {
  const leadLagPolicy = samplePolicyDetails["p-20261101-leadlag1"];
  assert.ok(leadLagPolicy);
  const report = leadLagPolicy.report;
  assert.ok(report);

  test("evaluation report partitions datasets into dev, scenario, and heldout", () => {
    const devDatasets = report.datasets.filter((d) => d.kind === "dev");
    const scenarioDatasets = report.datasets.filter((d) => d.kind === "scenario");
    const heldoutDatasets = report.datasets.filter((d) => d.kind === "heldout");

    assert.equal(devDatasets.length, 1);
    assert.equal(scenarioDatasets.length, 1);
    assert.equal(heldoutDatasets.length, 1);
    assert.ok(devDatasets[0] && heldoutDatasets[0]);
    assert.equal(devDatasets[0].name, "synthetic-dev-tape");
    assert.equal(heldoutDatasets[0].name, "heldout-leadlag-attack");
  });

  test("verdict details pass/fail reasons and comparison against threshold", () => {
    const verdict = report.verdict;
    assert.equal(verdict.qualified, true);
    assert.equal(verdict.reasons.length, 5);

    const heldOutRule = verdict.reasons.find((r) => r.rule === "must_beat_held_out");
    assert.ok(heldOutRule);
    assert.equal(heldOutRule.passed, true);
    assert.equal(heldOutRule.candidate, 14.6);
    assert.equal(heldOutRule.incumbent, -45.2);

    const drawdownRule = verdict.reasons.find((r) => r.rule === "max_drawdown_delta");
    assert.ok(drawdownRule);
    assert.equal(drawdownRule.passed, true);
  });

  test("rejected policy report contains failing reasons", () => {
    const rejectedReport = samplePolicyDetails["p-20261031-looseclamp"]?.report;
    assert.ok(rejectedReport);
    assert.equal(rejectedReport.verdict.qualified, false);

    const failedRules = rejectedReport.verdict.reasons.filter((r) => !r.passed);
    assert.ok(failedRules.length >= 2);
    assert.ok(failedRules.some((r) => r.rule === "must_beat_held_out"));
    assert.ok(failedRules.some((r) => r.rule === "max_drawdown_delta"));
  });

  test("draft policy has null report and is never represented as qualified", () => {
    const draftDetail = samplePolicyDetails["p-20261101-draft-new"];
    assert.ok(draftDetail);
    assert.equal(draftDetail.status, "draft");
    assert.equal(draftDetail.report, null);
  });
});

describe("engine failure handling and sample mode isolation", () => {
  test("unconfigured engine returns sample policy details and sample diagnosis", async () => {
    platformConfig.engineUrl = null;
    const detail = await fetchPolicyDetail("p-20261101-leadlag1");
    assert.equal(detail.id, "p-20261101-leadlag1");
    assert.equal(detail.status, "canary");

    const diagnosis = await fetchDiagnosis();
    assert.equal(diagnosis.totalLossUsd, 142.5);
    assert.ok(diagnosis.causes.stale_reference);
    assert.equal(diagnosis.causes.stale_reference.share, 0.45);
  });

  test("configured engine failure on /policies/:id throws error and NEVER falls back to sample", async () => {
    platformConfig.engineUrl = "https://engine.example.test";
    respond({ error: "not_found" }, 404);

    await assert.rejects(fetchPolicyDetail("p-20261101-leadlag1"), (err: unknown) => {
      return err instanceof Error;
    });
  });

  test("configured engine failure on /diagnosis throws error and NEVER falls back to sample", async () => {
    platformConfig.engineUrl = "https://engine.example.test";
    respond({ error: "internal_error" }, 500);

    await assert.rejects(fetchDiagnosis(), (err: unknown) => {
      return err instanceof Error;
    });
  });
});
