import fs from "node:fs/promises";
import path from "node:path";
import { defaultParams } from "../src/config";
import { defaultMandate } from "../src/policy/mandate";
import {
  createV0Spec,
  defaultScenariosDir,
  type EvaluationInput,
  evaluatePolicies,
  type LoadedScenario,
  listScenarios,
  loadScenario,
  type PolicySpec,
  policySpecSchema,
} from "../src/research";

async function loadSpec(specPathOrId: string): Promise<PolicySpec> {
  if (specPathOrId === "v0") {
    return createV0Spec("20261101", defaultParams);
  }
  // If it's a file path
  try {
    const raw = await fs.readFile(path.resolve(specPathOrId), "utf-8");
    const json = JSON.parse(raw);
    return policySpecSchema.parse(json);
  } catch (err: unknown) {
    throw new Error(`Failed to load policy spec from '${specPathOrId}': ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let candidateArg: string | null = null;
  let incumbentArg: string | null = null;
  let role: "research" | "evaluator" = "research";
  let scenariosArg: string | null = null;
  let scenariosDir: string | undefined;
  let outPath: string | null = null;
  let seed = 42;

  for (const arg of args) {
    if (arg.startsWith("--candidate=")) {
      candidateArg = arg.slice(12);
    } else if (arg.startsWith("--incumbent=")) {
      incumbentArg = arg.slice(12);
    } else if (arg.startsWith("--role=")) {
      const val = arg.slice(7);
      if (val === "research" || val === "evaluator") {
        role = val;
      } else {
        console.error(`Invalid role: ${val}. Must be 'research' or 'evaluator'.`);
        process.exit(2);
      }
    } else if (arg.startsWith("--scenarios=")) {
      scenariosArg = arg.slice(12);
    } else if (arg.startsWith("--scenarios-dir=")) {
      scenariosDir = arg.slice(16);
    } else if (arg.startsWith("--out=")) {
      outPath = arg.slice(6);
    } else if (arg.startsWith("--seed=")) {
      seed = Number.parseInt(arg.slice(7), 10);
    }
  }

  if (!candidateArg) {
    console.error(
      "Usage: bun scripts/research-eval.ts --candidate=<spec.json|id> [--incumbent=<spec.json|v0>] [--role=research|evaluator] [--scenarios=name1,name2] [--out=report.json] [--seed=42]",
    );
    process.exit(2);
  }

  const baseScenariosDir = scenariosDir ?? defaultScenariosDir();

  // Load candidate spec
  const candidateSpec = await loadSpec(candidateArg);

  // Load incumbent spec
  const incumbentSpec = incumbentArg
    ? await loadSpec(incumbentArg)
    : createV0Spec("20261101", defaultParams);

  // Determine scenario datasets to load
  let scenarioNames: string[] = [];
  if (scenariosArg) {
    scenarioNames = scenariosArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    const manifests = await listScenarios({ scenariosDir: baseScenariosDir });
    // If research role, only list non-held-out scenarios
    if (role === "research") {
      scenarioNames = manifests.filter((m) => !m.heldOut).map((m) => m.name);
    } else {
      scenarioNames = manifests.map((m) => m.name);
    }
  }

  if (scenarioNames.length === 0) {
    console.error(`No scenarios found to evaluate in '${baseScenariosDir}'`);
    process.exit(1);
  }

  // Load scenarios
  const datasets: LoadedScenario[] = [];
  for (const name of scenarioNames) {
    try {
      const loaded = await loadScenario(name, {
        role,
        scenariosDir: baseScenariosDir,
      });
      datasets.push(loaded);
    } catch (err: unknown) {
      console.error(`[EVAL ERROR] Could not load scenario '${name}': ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // Run pure evaluation
  const input: EvaluationInput = {
    candidate: candidateSpec,
    incumbent: incumbentSpec,
    datasets,
    role,
    mandate: defaultMandate,
    params: defaultParams,
    seed,
    codeRevision: "head",
    rulesVersion: "1.0.0",
    createdAt: Date.now(),
  };

  try {
    const report = await evaluatePolicies(input);
    const jsonOutput = JSON.stringify(report, null, 2);

    if (outPath) {
      await fs.writeFile(path.resolve(outPath), jsonOutput);
      console.log(`[EVAL REPORT WRITTEN] ${outPath}`);
    } else {
      console.log(jsonOutput);
    }
  } catch (err: unknown) {
    console.error(`[EVAL FAILED] ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
