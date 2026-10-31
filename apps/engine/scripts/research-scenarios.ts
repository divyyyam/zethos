import {
  defaultScenariosDir,
  HeldOutAccessError,
  listScenarios,
  loadScenario,
  ScenarioSecurityError,
} from "../src/research";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let role: "research" | "evaluator" = "research";
  let split: "dev" | "held-out" | "all" | undefined;
  let scenariosDir: string | undefined;
  let targetName: string | null = null;
  let showList = false;

  for (const arg of args) {
    if (arg === "--list") {
      showList = true;
    } else if (arg.startsWith("--role=")) {
      const val = arg.slice(7);
      if (val === "evaluator" || val === "research") {
        role = val;
      } else {
        console.error(`Invalid role: ${val}. Must be 'research' or 'evaluator'.`);
        process.exit(2);
      }
    } else if (arg.startsWith("--split=")) {
      const val = arg.slice(8);
      if (val === "dev" || val === "held-out" || val === "all") {
        split = val;
      } else {
        console.error(`Invalid split: ${val}. Must be 'dev', 'held-out', or 'all'.`);
        process.exit(2);
      }
    } else if (arg.startsWith("--scenarios-dir=")) {
      scenariosDir = arg.slice(16);
    } else if (!arg.startsWith("--")) {
      targetName = arg;
    }
  }

  const baseDir = scenariosDir ?? defaultScenariosDir();

  if (showList || (!targetName && args.length === 0)) {
    const manifests = await listScenarios({ scenariosDir: baseDir });
    console.log(`Available scenarios in ${baseDir} (${manifests.length}):`);
    for (const m of manifests) {
      console.log(
        ` - ${m.name} [${m.pair}] ${m.heldOut ? "(HELD-OUT)" : "(dev)"}: ${m.description}`,
      );
    }
    return;
  }

  if (!targetName) {
    console.error(
      "Usage: bun scripts/research-scenarios.ts <scenario-name> [--role=research|evaluator] [--split=dev|held-out|all] [--scenarios-dir=path] [--list]",
    );
    process.exit(2);
  }

  try {
    const loaded = await loadScenario(targetName, { role, split, scenariosDir: baseDir });
    console.log(
      `[SCENARIO LOADED] ${loaded.manifest.name} (${loaded.split}): ${loaded.recordCounts.total} records ` +
        `(${loaded.recordCounts.books} books, ${loaded.recordCounts.trades} trades, ${loaded.recordCounts.takerRequests} taker requests)`,
    );
  } catch (err: unknown) {
    if (err instanceof HeldOutAccessError) {
      console.error(`[HELD-OUT GUARD] ${err.message}`);
      process.exit(1);
    }
    if (err instanceof ScenarioSecurityError) {
      console.error(`[SECURITY ERROR] ${err.message}`);
      process.exit(1);
    }
    console.error(`[ERROR] ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
