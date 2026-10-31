import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GEMINI_MODEL, defaultParams, type Params } from "../src/config";
import { defaultMandate, loadMandate, type Mandate } from "../src/policy/mandate";
import {
  assertNotHeldOut,
  createV0Spec,
  type PolicySpec,
  policyDateSchema,
  policySpecSchema,
  proposePolicy,
  redactSecrets,
} from "../src/research";

function printUsage(): void {
  console.log(
    `
Usage: bun scripts/research-propose.ts [options]

Required Options:
  --diagnosis=<path>    Path to validated loss diagnosis JSON (S6)
  --dev-stats=<path>    Path to development dataset performance statistics JSON
  --date=<yyyymmdd>     Explicit UTC calendar date (e.g. 20261101)

Optional Options:
  --incumbent=<path|v0> Path to incumbent PolicySpec JSON, or 'v0' (default: v0)
  --out=<path>          Output file path to save proposed candidate PolicySpec JSON
  --runs-dir=<path>     Directory to save audit trail artifacts (default: research-runs)
  --model=<name>        Gemini model name (default: GEMINI_MODEL env or ${DEFAULT_GEMINI_MODEL})
  --mandate=<path>      Path to desk mandate JSON (default: engine default mandate)
  --params=<path>       Path to engine params JSON (default: engine default params)
  GEMINI_API_KEY        Set the Gemini credential in the environment; never pass it as an argument
  --help, -h            Show this help message
`.trim(),
  );
}

async function loadJsonFile(filePath: string, label: string): Promise<unknown> {
  const resolved = path.resolve(filePath);
  try {
    const raw = await fs.readFile(resolved, "utf-8");
    return JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load ${label} from '${filePath}': ${msg}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let diagnosisArg: string | null = null;
  let devStatsArg: string | null = null;
  let dateArg: string | null = null;
  let incumbentArg: string | null = null;
  let outArg: string | null = null;
  let runsDirArg: string | null = null;
  let modelArg: string | null = null;
  let mandateArg: string | null = null;
  let paramsArg: string | null = null;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("--diagnosis=")) {
      diagnosisArg = arg.slice("--diagnosis=".length);
    } else if (arg.startsWith("--dev-stats=")) {
      devStatsArg = arg.slice("--dev-stats=".length);
    } else if (arg.startsWith("--date=")) {
      dateArg = arg.slice("--date=".length);
    } else if (arg.startsWith("--incumbent=")) {
      incumbentArg = arg.slice("--incumbent=".length);
    } else if (arg.startsWith("--out=")) {
      outArg = arg.slice("--out=".length);
    } else if (arg.startsWith("--runs-dir=")) {
      runsDirArg = arg.slice("--runs-dir=".length);
    } else if (arg.startsWith("--model=")) {
      modelArg = arg.slice("--model=".length);
    } else if (arg.startsWith("--mandate=")) {
      mandateArg = arg.slice("--mandate=".length);
    } else if (arg.startsWith("--params=")) {
      paramsArg = arg.slice("--params=".length);
    } else {
      const optionName = arg.split("=", 1)[0] ?? "(unknown)";
      console.error(`Error: Unknown option '${optionName}'. Use --help for supported options.`);
      process.exit(2);
    }
  }

  if (!diagnosisArg || !devStatsArg || !dateArg) {
    console.error("Error: --diagnosis, --dev-stats, and --date are required.");
    printUsage();
    process.exit(2);
  }

  const dateParse = policyDateSchema.safeParse(dateArg);
  if (!dateParse.success) {
    console.error(
      `Error: Invalid UTC calendar date '${dateArg}': ${dateParse.error.issues[0]?.message}`,
    );
    process.exit(2);
  }
  const date = dateParse.data;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.error("Error: GEMINI_API_KEY must be provided via the environment.");
    process.exit(1);
  }

  try {
    // 1. Load and parse diagnosis and dev-stats
    const diagnosis = await loadJsonFile(diagnosisArg, "diagnosis");
    assertNotHeldOut(diagnosis, "Diagnosis file");

    const devStats = await loadJsonFile(devStatsArg, "dev-stats");
    assertNotHeldOut(devStats, "Dev statistics file");

    // 2. Load params and mandate if provided
    let params: Params = defaultParams;
    if (paramsArg) {
      params = (await loadJsonFile(paramsArg, "params")) as Params;
    }

    let mandate: Mandate = defaultMandate;
    if (mandateArg) {
      mandate = loadMandate(await loadJsonFile(mandateArg, "mandate"));
    }

    // 3. Load incumbent
    let incumbent: PolicySpec;
    if (!incumbentArg || incumbentArg === "v0") {
      incumbent = createV0Spec(date, params);
    } else {
      const rawIncumbent = await loadJsonFile(incumbentArg, "incumbent");
      incumbent = policySpecSchema.parse(rawIncumbent);
    }

    const runsDir = runsDirArg ?? path.resolve("research-runs");

    // 4. Propose policy
    const result = await proposePolicy({
      diagnosis,
      devStats,
      incumbent,
      date,
      mandate,
      params,
      model: modelArg ?? undefined,
      apiKey,
      runsDir,
    });

    // 5. Output candidate JSON if --out specified
    if (outArg) {
      const outPath = path.resolve(outArg);
      await fs.writeFile(outPath, JSON.stringify(result.candidate, null, 2), "utf-8");
      console.log(`Candidate saved to: ${outPath}`);
    }

    console.log(`Candidate Proposed: ${result.candidate.id}`);
    console.log(`Hypothesis: ${result.hypothesis}`);
    console.log(`Spec Hash: ${result.specHash}`);
    console.log(`Attempts: ${result.attempts}`);
    console.log(`Audit Run ID: ${result.runId}`);
    process.exit(0);
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const sanitizedMsg = redactSecrets(rawMsg, [apiKey]);
    console.error(`Proposer Error: ${sanitizedMsg}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal Proposer Error:", err);
  process.exit(1);
});
