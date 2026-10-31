import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GEMINI_MODEL, defaultParams } from "../src/config";
import { defaultMandate } from "../src/policy/mandate";
import {
  assertNotHeldOut,
  compile,
  createV0Spec,
  defaultScenariosDir,
  evaluatePolicies,
  type LoadedScenario,
  listScenarios,
  loadScenario,
  type PolicySpec,
  policyDateSchema,
  policySpecSchema,
  proposePolicy,
  redactSecrets,
  simulatePolicyOnScenario,
} from "../src/research";

interface Options {
  engineUrl: string;
  date: string;
  incumbent: string;
  scenariosDir: string;
  runsDir: string;
  model: string;
  seed: number;
  pair?: string;
  window: string;
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bun scripts/research-cycle.ts --date=YYYYMMDD [--engine-url=https://engine] [--incumbent=v0|spec.json] [--scenarios-dir=path] [--runs-dir=path] [--model=name] [--seed=42] [--pair=HSK/USDT] [--window=1h]",
      );
      process.exit(0);
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match?.[1] || match[2] === undefined) throw new Error("Options must use --name=value");
    if (
      ![
        "engine-url",
        "date",
        "incumbent",
        "scenarios-dir",
        "runs-dir",
        "model",
        "seed",
        "pair",
        "window",
      ].includes(match[1])
    )
      throw new Error(`Unknown option --${match[1]}`);
    values.set(match[1], match[2]);
  }

  const date = values.get("date");
  if (!date || !policyDateSchema.safeParse(date).success)
    throw new Error("A valid --date=YYYYMMDD is required");
  const engineUrl = (values.get("engine-url") ?? process.env.ENGINE_URL ?? "").replace(/\/$/, "");
  if (!engineUrl) throw new Error("Provide --engine-url or ENGINE_URL");
  const seed = Number(values.get("seed") ?? 42);
  if (!Number.isSafeInteger(seed)) throw new Error("--seed must be a safe integer");
  const pair = values.get("pair");
  return {
    engineUrl,
    date,
    incumbent: values.get("incumbent") ?? "v0",
    scenariosDir: path.resolve(values.get("scenarios-dir") ?? defaultScenariosDir()),
    runsDir: path.resolve(values.get("runs-dir") ?? "research-runs"),
    model: values.get("model") ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    seed,
    ...(pair ? { pair } : {}),
    window: values.get("window") ?? "1h",
  };
}

async function loadIncumbent(reference: string, date: string): Promise<PolicySpec> {
  if (reference === "v0") return createV0Spec(date, defaultParams);
  const value: unknown = JSON.parse(await fs.readFile(path.resolve(reference), "utf8"));
  return policySpecSchema.parse(value);
}

async function loadScenarios(
  names: string[],
  role: "research" | "evaluator",
  scenariosDir: string,
): Promise<LoadedScenario[]> {
  const datasets: LoadedScenario[] = [];
  for (const name of names) {
    datasets.push(await loadScenario(name, { role, scenariosDir }));
  }
  return datasets;
}

function aggregateDevStats(scenarios: LoadedScenario[], incumbent: PolicySpec, seed: number) {
  const policy = compile(incumbent, { params: defaultParams, mandate: defaultMandate });
  const rows = scenarios.map((scenario) => ({
    name: scenario.manifest.name,
    kind: "dev" as const,
    counts: scenario.recordCounts,
    performance: simulatePolicyOnScenario(policy, scenario, {
      params: defaultParams,
      mandate: defaultMandate,
      seed,
    }),
  }));
  const sums = rows.reduce(
    (total, row) => ({
      netUsd: total.netUsd + row.performance.netUsd,
      spreadCaptureUsd: total.spreadCaptureUsd + row.performance.spreadCaptureUsd,
      fills: total.fills + row.performance.fills,
      requests: total.requests + row.counts.takerRequests,
      rejects: total.rejects + row.performance.rejectRate * row.counts.takerRequests,
      attackerTakeUsd: total.attackerTakeUsd + row.performance.attackerTakeUsd,
    }),
    { netUsd: 0, spreadCaptureUsd: 0, fills: 0, requests: 0, rejects: 0, attackerTakeUsd: 0 },
  );
  const stats = {
    heldOut: false,
    kind: "dev",
    seed,
    datasetCount: rows.length,
    requestCount: sums.requests,
    fillCount: sums.fills,
    rejectRate: sums.requests ? sums.rejects / sums.requests : 0,
    netUsd: sums.netUsd,
    spreadCaptureUsd: sums.spreadCaptureUsd,
    attackerTakeUsd: sums.attackerTakeUsd,
    datasets: rows,
  };
  assertNotHeldOut(stats, "Development statistics");
  return stats;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const apiKey = process.env.GEMINI_API_KEY;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!apiKey?.trim()) throw new Error("GEMINI_API_KEY must be provided in the environment");
  if (!adminToken?.trim()) throw new Error("ADMIN_TOKEN must be provided in the environment");

  const diagnosisUrl = new URL("/diagnosis", `${options.engineUrl}/`);
  if (options.pair) diagnosisUrl.searchParams.set("pair", options.pair);
  diagnosisUrl.searchParams.set("window", options.window);
  const diagnosisResponse = await fetch(diagnosisUrl);
  if (!diagnosisResponse.ok)
    throw new Error(`GET /diagnosis failed with HTTP ${diagnosisResponse.status}`);
  const diagnosis: unknown = await diagnosisResponse.json();
  assertNotHeldOut(diagnosis, "Engine diagnosis");

  const incumbent = await loadIncumbent(options.incumbent, options.date);
  const manifests = await listScenarios({ scenariosDir: options.scenariosDir });
  const devNames = manifests
    .filter((manifest) => !manifest.heldOut)
    .map((manifest) => manifest.name);
  if (devNames.length === 0) throw new Error("No development scenarios are available for proposal");
  const devScenarios = await loadScenarios(devNames, "research", options.scenariosDir);
  const devStats = aggregateDevStats(devScenarios, incumbent, options.seed);

  const proposal = await proposePolicy({
    diagnosis,
    devStats,
    incumbent,
    date: options.date,
    mandate: defaultMandate,
    params: defaultParams,
    model: options.model,
    apiKey,
    runsDir: options.runsDir,
  });

  // Held-out data is first opened only after the proposal is immutable.
  const evaluatorNames = manifests.map((manifest) => manifest.name);
  const evaluationScenarios = await loadScenarios(
    evaluatorNames,
    "evaluator",
    options.scenariosDir,
  );
  const report = await evaluatePolicies({
    candidate: proposal.candidate,
    incumbent,
    datasets: evaluationScenarios,
    role: "evaluator",
    mandate: defaultMandate,
    params: defaultParams,
    seed: options.seed,
    codeRevision: "head",
    rulesVersion: "1.0.0",
    createdAt: Date.now(),
  });

  const registration = await fetch(new URL("/policies", `${options.engineUrl}/`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ spec: proposal.candidate, report }),
  });
  if (!registration.ok) {
    const responseText = await registration.text();
    throw new Error(
      `POST /policies failed with HTTP ${registration.status}: ${redactSecrets(responseText, [apiKey, adminToken])}`,
    );
  }
  const registered: unknown = await registration.json();
  const cycleDir = path.join(options.runsDir, `cycle-${Date.now()}-${proposal.candidate.id}`);
  await fs.mkdir(cycleDir, { recursive: true });
  await fs.writeFile(path.join(cycleDir, "dev-stats.json"), JSON.stringify(devStats, null, 2));
  await fs.writeFile(path.join(cycleDir, "report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(cycleDir, "registration.json"), JSON.stringify(registered, null, 2));
  console.log(
    JSON.stringify({
      candidateId: proposal.candidate.id,
      hypothesis: proposal.hypothesis,
      qualified: report.verdict.qualified,
      registered: true,
      cycleDir,
    }),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    redactSecrets(message, [process.env.GEMINI_API_KEY ?? "", process.env.ADMIN_TOKEN ?? ""]),
  );
  process.exitCode = 1;
});
