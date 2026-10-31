import { describe, expect, it } from "bun:test";
import path from "node:path";
import { createApp } from "../src/api";
import { defaultMandate } from "../src/policy/mandate";
import {
  createPolicySpec,
  createV0Spec,
  evaluatePolicies,
  loadScenario,
  type PolicySpec,
} from "../src/research";
import { readyEngine } from "./helpers";

// The web app parses engine responses with strict schemas. A field added or renamed on one side
// shows up on stage as an error card, so these routes are checked against the web's own schemas.
const scenariosDir = path.resolve(import.meta.dir, "../scenarios");
const webEngineLib = path.resolve(import.meta.dir, "../../web/src/lib/engine");

interface Parser {
  safeParse(value: unknown): {
    success: boolean;
    data?: { status?: string; canaryStats?: unknown };
    error?: { issues: unknown };
  };
}
// Loaded at runtime so neither package's typecheck has to compile the other's sources.
const webSchema = async (file: string, name: string): Promise<Parser> =>
  (await import(path.join(webEngineLib, file)))[name] as Parser;
const TOKEN = "contract-test-token";

describe("engine responses match the web app's schemas", () => {
  it("parses /mandate, /policies, /policies/:id (incl. a live canary), /diagnosis and /desk/compliance", async () => {
    const mandateSchema = await webSchema("desk-types.ts", "mandateSchema");
    const policyListResponseSchema = await webSchema("policies.ts", "policyListResponseSchema");
    const policyDetailSchema = await webSchema("research-types.ts", "policyDetailSchema");
    const diagnosisResponseSchema = await webSchema("research-types.ts", "diagnosisResponseSchema");
    const deskComplianceSchema = await webSchema("desk-types.ts", "deskComplianceSchema");
    const clock = 1_800_000_000_000;
    const { engine } = await readyEngine({ now: clock });
    const app = createApp({
      engine: async () => engine,
      corsOrigins: [],
      waitUntil: () => {},
      clock: () => clock,
      adminToken: TOKEN,
    });
    const json = async (route: string, init?: RequestInit) => {
      const res = await app.request(route, init);
      return { status: res.status, body: (await res.json()) as unknown };
    };
    const admin = (body: unknown): RequestInit => ({
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(mandateSchema.safeParse((await json("/mandate")).body).success).toBe(true);

    const v0 = createV0Spec("20261101");
    const { id: _id, ...body } = v0;
    const terms = [...body.terms];
    terms.splice(terms.length - 1, 0, {
      kind: "leadMove",
      params: { thresholdBps: 10, windowSec: 3, addBps: 20 },
    });
    const candidate: PolicySpec = createPolicySpec(
      { ...body, parent: v0.id, hypothesis: "Widen after a lead-venue move", terms },
      "20261101",
    );
    const datasets = [
      await loadScenario("synthetic-dev-tape", { split: "dev", role: "evaluator", scenariosDir }),
      await loadScenario("synthetic-heldout-leadlag", { role: "evaluator", scenariosDir }),
    ];
    const report = await evaluatePolicies({
      candidate,
      incumbent: v0,
      datasets,
      role: "evaluator",
      createdAt: clock,
    });
    expect(report.verdict.qualified).toBe(true);
    expect((await json("/policies", admin({ spec: candidate, report }))).status).toBe(200);
    const canary = await json(
      `/policies/${candidate.id}/canary`,
      admin({ allocationPct: defaultMandate.canary.maxAllocationPct }),
    );
    expect(canary.status).toBe(200);

    const list = policyListResponseSchema.safeParse((await json("/policies")).body);
    expect(list.success).toBe(true);
    const detail = policyDetailSchema.safeParse((await json(`/policies/${candidate.id}`)).body);
    if (!detail.success) throw new Error(JSON.stringify(detail.error?.issues).slice(0, 600));
    expect(detail.data?.status).toBe("canary");
    expect(detail.data?.canaryStats).toBeTruthy();
    expect(policyDetailSchema.safeParse((await json("/policies/v0")).body).success).toBe(true);
    const diagnosis = diagnosisResponseSchema.safeParse(
      (await json("/diagnosis?pair=HSK/USDT&window=1h")).body,
    );
    expect(diagnosis.success).toBe(true);
    await app.request("/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taker: "0x1111111111111111111111111111111111111111",
        tokenIn: "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029",
        tokenOut: "0xB210D2120d57b758EE163cFfb43e73728c471Cf1",
        amountIn: "100000000",
      }),
    });
    const compliance = deskComplianceSchema.safeParse((await json("/desk/compliance")).body);
    if (!compliance.success)
      throw new Error(JSON.stringify(compliance.error?.issues).slice(0, 600));
  });
});
