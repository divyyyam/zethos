import { describe, expect, it } from "bun:test";
import path from "node:path";
import { defaultParams } from "../src/config";
import { defaultMandate } from "../src/policy/mandate";
import type {
  Policy,
  PolicyDecision,
  PolicyInventory,
  PolicyMarketState,
  PolicyRequest,
} from "../src/policy/types";
import {
  compile,
  createV0Spec,
  DEFAULT_EVAL_TOKENS,
  defaultScenariosDir,
  type EvaluationInput,
  evaluatePolicies,
  evaluationReportSchema,
  type LoadedScenario,
  loadScenario,
  simulatePolicyOnScenario,
} from "../src/research";

describe("R5 Deterministic Evaluation and Qualification", () => {
  const scenariosDir = defaultScenariosDir();

  // Helper candidate fixture: refuse-everything policy
  const refuseEverythingPolicy: Policy = {
    id: "p-refuse-everything",
    decide(
      _market: PolicyMarketState,
      _inventory: PolicyInventory,
      _request: PolicyRequest,
    ): PolicyDecision {
      return { kind: "reject", reason: "policy_rule" };
    },
  };

  // Helper candidate fixture: wide spread policy (quotes 500 bps)
  const widePolicy: Policy = {
    id: "p-wide",
    decide(market: PolicyMarketState, _inv: PolicyInventory, req: PolicyRequest): PolicyDecision {
      const ref =
        req.side === "buy" ? (market.book.asks[0]?.[0] ?? 2.01) : (market.book.bids[0]?.[0] ?? 2.0);
      const halfSpread = 0.05; // 500 bps
      const price = req.side === "buy" ? ref * (1 + halfSpread) : ref * (1 - halfSpread);
      return {
        kind: "quote",
        price,
        ref,
        halfSpread,
        sigmaT: 0.001,
        ttlSec: 30,
        terms: { base: 0.05 },
      };
    },
  };

  describe("Determinism and Parity", () => {
    it("produces identical, bitwise-reproducible S4 reports on repeated runs with identical seed", async () => {
      const devScenario = await loadScenario("synthetic-dev-tape", {
        split: "dev",
        role: "research",
        scenariosDir,
      });

      const candidateSpec = createV0Spec("20261101", defaultParams);
      const incumbentSpec = createV0Spec("20261101", defaultParams);

      const input: EvaluationInput = {
        candidate: candidateSpec,
        incumbent: incumbentSpec,
        datasets: [devScenario],
        role: "research",
        seed: 12345,
        createdAt: 1700000000000,
        codeRevision: "test-rev-1",
        rulesVersion: "1.0.0",
      };

      const report1 = await evaluatePolicies(input);
      const report2 = await evaluatePolicies(input);

      expect(JSON.stringify(report1)).toBe(JSON.stringify(report2));
      expect(evaluationReportSchema.safeParse(report1).success).toBe(true);
    });

    it("verifies v0 vs v0 candidate and incumbent yield identical results", async () => {
      const devScenario = await loadScenario("synthetic-dev-tape", {
        split: "dev",
        role: "research",
        scenariosDir,
      });

      const v0Spec = createV0Spec("20261101", defaultParams);

      const report = await evaluatePolicies({
        candidate: v0Spec,
        incumbent: v0Spec,
        datasets: [devScenario],
        role: "research",
        seed: 42,
        createdAt: 1700000000000,
      });

      const candRes = report.results["synthetic-dev-tape"]?.candidate;
      const incRes = report.results["synthetic-dev-tape"]?.incumbent;

      expect(candRes).toBeDefined();
      expect(incRes).toBeDefined();

      expect(candRes?.netUsd).toBe(incRes?.netUsd);
      expect(candRes?.spreadCaptureUsd).toBe(incRes?.spreadCaptureUsd);
      expect(candRes?.inventoryPnlUsd).toBe(incRes?.inventoryPnlUsd);
      expect(candRes?.maxDrawdownPct).toBe(incRes?.maxDrawdownPct);
      expect(candRes?.honestFillRate).toBe(incRes?.honestFillRate);
      expect(candRes?.rejectRate).toBe(incRes?.rejectRate);
      expect(candRes?.fills).toBe(incRes?.fills);

      expect(report.verdict.qualified).toBe(true);
      for (const reason of report.verdict.reasons) {
        expect(reason.passed).toBe(true);
      }
    });
  });

  describe("Refuse-Everything Candidate Qualification Failure", () => {
    it("rejects refuse-everything candidate on maxRejectRate and minHonestFillRate", async () => {
      const devScenario = await loadScenario("synthetic-dev-tape", {
        split: "dev",
        role: "research",
        scenariosDir,
      });

      const incumbentSpec = createV0Spec("20261101", defaultParams);

      const report = await evaluatePolicies({
        candidate: refuseEverythingPolicy,
        incumbent: incumbentSpec,
        datasets: [devScenario],
        role: "research",
        seed: 42,
        createdAt: 1700000000000,
      });

      const candRes = report.results["synthetic-dev-tape"]?.candidate;
      expect(candRes?.fills).toBe(0);
      expect(candRes?.rejectRate).toBe(1.0); // 100% reject rate
      expect(candRes?.honestFillRate).toBe(0.0); // 0% honest fill rate

      expect(report.verdict.qualified).toBe(false);

      const maxRejectReason = report.verdict.reasons.find((r) => r.rule === "max_reject_rate");
      expect(maxRejectReason).toBeDefined();
      expect(maxRejectReason?.passed).toBe(false);
      expect(maxRejectReason?.candidate).toBe(1.0);

      const minFillReason = report.verdict.reasons.find((r) => r.rule === "min_honest_fill_rate");
      expect(minFillReason).toBeDefined();
      expect(minFillReason?.passed).toBe(false);
      expect(minFillReason?.candidate).toBe(0.0);
    });
  });

  describe("Portfolio Accounting and Markout Disambiguation", () => {
    it("satisfies netUsd = (spreadCaptureUsd + inventoryPnlUsd) - totalGasUsd exactly", async () => {
      const devScenario = await loadScenario("synthetic-dev-tape", {
        split: "dev",
        role: "research",
        scenariosDir,
      });

      const policy = compile(createV0Spec("20261101", defaultParams));
      const res = simulatePolicyOnScenario(policy, devScenario, {
        mandate: defaultMandate,
        params: defaultParams,
        tokens: DEFAULT_EVAL_TOKENS,
        modeledGasUsdPerFill: 0.05,
      });

      // Operating accounting equation check
      const totalPnl = res.spreadCaptureUsd + res.inventoryPnlUsd;
      const expectedGas = res.fills * 0.05;
      const expectedNet = totalPnl - expectedGas;

      expect(res.netUsd).toBeCloseTo(expectedNet, 2);
    });
  });

  describe("Mandate and Execution Layer Enforcement Parity", () => {
    it("enforces mandate spread caps and size buckets during simulation", async () => {
      const devScenario = await loadScenario("synthetic-dev-tape", {
        split: "dev",
        role: "research",
        scenariosDir,
      });

      // Mandate with tight service limit of 50 bps
      const tightMandate = {
        ...defaultMandate,
        service: {
          ...defaultMandate.service,
          maxHalfSpreadBps: [{ maxNotionalUsd: 50000, maxBps: 50 }],
        },
      };

      const res = simulatePolicyOnScenario(widePolicy, devScenario, {
        mandate: tightMandate,
        params: defaultParams,
        tokens: DEFAULT_EVAL_TOKENS,
      });

      // All quotes from wide policy exceed 50 bps and are rejected by enforceExecution
      expect(res.rejectRate).toBe(1.0);
      expect(res.fills).toBe(0);
    });
  });

  describe("Held-Out Dataset Protection and Evaluation Gate", () => {
    it("fails closed when attempting to evaluate held-out scenario as research", async () => {
      const heldOutScenario = await loadScenario("synthetic-heldout-leadlag", {
        role: "evaluator",
        scenariosDir,
      });

      const v0Spec = createV0Spec("20261101", defaultParams);

      await expect(
        evaluatePolicies({
          candidate: v0Spec,
          incumbent: v0Spec,
          datasets: [heldOutScenario],
          role: "research", // research role cannot evaluate held-out data
        }),
      ).rejects.toThrow();
    });

    it("evaluates successfully with role: evaluator and tests must_beat_held_out rule", async () => {
      const heldOutScenario = await loadScenario("synthetic-heldout-leadlag", {
        role: "evaluator",
        scenariosDir,
      });

      const v0Spec = createV0Spec("20261101", defaultParams);

      const report = await evaluatePolicies({
        candidate: v0Spec,
        incumbent: v0Spec,
        datasets: [heldOutScenario],
        role: "evaluator",
      });

      expect(report.datasets[0]?.kind).toBe("heldout");
      const mustBeat = report.verdict.reasons.find((r) => r.rule === "must_beat_held_out");
      expect(mustBeat).toBeDefined();
      expect(mustBeat?.passed).toBe(true);
    });
  });

  describe("Taker Execution Model and Flow Isolation", () => {
    it("ensures honest takers reject uncompetitive desk prices", async () => {
      const devScenario = await loadScenario("synthetic-dev-tape", {
        split: "dev",
        role: "research",
        scenariosDir,
      });

      const wideRes = simulatePolicyOnScenario(widePolicy, devScenario, {
        mandate: defaultMandate,
        params: defaultParams,
        tokens: DEFAULT_EVAL_TOKENS,
      });

      // Because price is 500 bps worse than public book, honest takers walk away
      expect(wideRes.honestFillRate).toBeLessThanOrEqual(0.0);
    });

    it("verifies policy never receives flow labels or scenario identities in inputs", () => {
      let receivedRequest: PolicyRequest | null = null;
      const spyPolicy: Policy = {
        id: "p-spy",
        decide(_m: PolicyMarketState, _inv: PolicyInventory, req: PolicyRequest): PolicyDecision {
          receivedRequest = req;
          return { kind: "reject", reason: "policy_rule" };
        },
      };

      const syntheticScenario: LoadedScenario = {
        manifest: {
          name: "synthetic-spy-test",
          source: "tape",
          pair: "HSK/USDT",
          recordedAt: 1700000000000,
          heldOut: false,
          description: "Spy test",
        },
        records: [
          {
            type: "book",
            ts: 1000,
            pair: "HSK/USDT",
            venue: "hashkey-global",
            book: { bids: [[2.0, 100]], asks: [[2.01, 100]] },
          },
          {
            type: "taker_request",
            ts: 2000,
            pair: "HSK/USDT",
            side: "buy",
            amountIn: "1000000000",
            taker: "0x1111111111111111111111111111111111111111",
            tier: "toxic",
          },
        ],
        split: "dev",
        recordCounts: { total: 2, books: 1, trades: 0, takerRequests: 1 },
        timeRange: { fromTs: 1000, toTs: 2000 },
      };

      simulatePolicyOnScenario(spyPolicy, syntheticScenario);

      expect(receivedRequest).toBeDefined();
      const reqRecord = receivedRequest as unknown as Record<string, unknown>;
      // Flow label, scenario name or source MUST NOT be on request
      expect(reqRecord.flow).toBeUndefined();
      expect(reqRecord.source).toBeUndefined();
      expect(reqRecord.scenarioName).toBeUndefined();
      expect(reqRecord.heldOut).toBeUndefined();
    });
  });

  describe("CLI Boundary Runner", () => {
    const scriptPath = path.resolve(__dirname, "../scripts/research-eval.ts");

    it("runs research-eval CLI and prints valid S4 JSON report to stdout", () => {
      const proc = Bun.spawnSync(
        ["bun", scriptPath, "--candidate=v0", "--incumbent=v0", "--scenarios=synthetic-dev-tape"],
        { cwd: path.resolve(__dirname, "..") },
      );

      expect(proc.exitCode).toBe(0);
      const output = proc.stdout.toString();
      const parsed = JSON.parse(output);
      expect(parsed.candidateId).toBeDefined();
      expect(parsed.verdict.qualified).toBe(true);
      expect(parsed.results["synthetic-dev-tape"]).toBeDefined();
    });

    it("CLI fails with exit code 1 when attempting to evaluate held-out scenario with research role", () => {
      const proc = Bun.spawnSync(
        [
          "bun",
          scriptPath,
          "--candidate=v0",
          "--incumbent=v0",
          "--scenarios=synthetic-heldout-leadlag",
          "--role=research",
        ],
        { cwd: path.resolve(__dirname, "..") },
      );

      expect(proc.exitCode).toBe(1);
      const stderr = proc.stderr.toString();
      expect(stderr).toContain("[EVAL ERROR]");
      expect(stderr).toContain("held-out");
    });

    it("CLI succeeds with exit code 0 when evaluating held-out scenario with evaluator role", () => {
      const proc = Bun.spawnSync(
        [
          "bun",
          scriptPath,
          "--candidate=v0",
          "--incumbent=v0",
          "--scenarios=synthetic-heldout-leadlag",
          "--role=evaluator",
        ],
        { cwd: path.resolve(__dirname, "..") },
      );

      expect(proc.exitCode).toBe(0);
      const output = proc.stdout.toString();
      const parsed = JSON.parse(output);
      expect(parsed.datasets[0]?.kind).toBe("heldout");
      expect(parsed.verdict).toBeDefined();
    });
  });
});
