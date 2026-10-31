import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PAIRS, VENUE_IDS } from "../config";

const addressRegex = /^0x[0-9a-fA-F]{40}$/;
const uint256Regex = /^(0|[1-9]\d*)$/;

const levelSchema = z.tuple([z.number().positive(), z.number().positive()]);
const bookSchema = z.strictObject({
  bids: z.array(levelSchema).min(1),
  asks: z.array(levelSchema).min(1),
});

export const scenarioBookRecordSchema = z.strictObject({
  type: z.literal("book"),
  ts: z.number().int().nonnegative(),
  pair: z.enum(PAIRS),
  venue: z.enum(VENUE_IDS),
  book: bookSchema,
});

export const scenarioTradeRecordSchema = z.strictObject({
  type: z.literal("trade"),
  ts: z.number().int().nonnegative(),
  pair: z.enum(PAIRS),
  venue: z.enum(VENUE_IDS),
  trade: z.strictObject({
    id: z.string().min(1),
    ts: z.number().int().nonnegative(),
    side: z.enum(["buy", "sell"]),
    price: z.number().positive(),
    size: z.number().positive(),
  }),
});

export const scenarioTakerRequestRecordSchema = z.strictObject({
  type: z.literal("taker_request"),
  ts: z.number().int().nonnegative(),
  pair: z.enum(PAIRS),
  side: z.enum(["buy", "sell"]),
  amountIn: z.string().regex(uint256Regex, "amountIn must be a base-10 integer string"),
  taker: z.string().regex(addressRegex, "invalid taker address"),
  id: z.string().min(1).optional(),
  tier: z.enum(["normal", "watch", "toxic", "blocked", "probation"]).optional(),
  score: z.number().optional(),
});

export const scenarioRecordSchema = z.discriminatedUnion("type", [
  scenarioBookRecordSchema,
  scenarioTradeRecordSchema,
  scenarioTakerRequestRecordSchema,
]);

export type ScenarioBookRecord = z.infer<typeof scenarioBookRecordSchema>;
export type ScenarioTradeRecord = z.infer<typeof scenarioTradeRecordSchema>;
export type ScenarioTakerRequestRecord = z.infer<typeof scenarioTakerRequestRecordSchema>;
export type ScenarioRecord = z.infer<typeof scenarioRecordSchema>;

export const scenarioManifestSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, "Scenario name must be alphanumeric with underscores or dashes"),
  source: z.string().min(1),
  pair: z.enum(PAIRS),
  recordedAt: z.union([z.number().int().nonnegative(), z.string().min(1)]),
  heldOut: z.boolean(),
  description: z.string(),
  devWindow: z
    .strictObject({
      fromTs: z.number().int().nonnegative(),
      toTs: z.number().int().nonnegative(),
    })
    .optional(),
  heldOutWindow: z
    .strictObject({
      fromTs: z.number().int().nonnegative(),
      toTs: z.number().int().nonnegative(),
    })
    .optional(),
});

export type ScenarioManifest = z.infer<typeof scenarioManifestSchema>;

export class ScenarioSecurityError extends Error {
  constructor(message: string) {
    super(`Scenario security violation: ${message}`);
    this.name = "ScenarioSecurityError";
  }
}

export class HeldOutAccessError extends Error {
  constructor(name: string) {
    super(
      `Access denied: scenario '${name}' is held-out and cannot be accessed with role 'research'`,
    );
    this.name = "HeldOutAccessError";
  }
}

export class ScenarioFormatError extends Error {
  constructor(name: string, line: number, detail: string) {
    super(`Malformed scenario record in '${name}' at line ${line}: ${detail}`);
    this.name = "ScenarioFormatError";
  }
}

export type ScenarioAccessRole = "research" | "evaluator";

export interface LoadScenarioOptions {
  scenariosDir?: string;
  role?: ScenarioAccessRole;
  timeWindow?: {
    fromTs?: number;
    toTs?: number;
  };
  split?: "dev" | "held-out" | "all";
}

export interface LoadedScenario {
  manifest: ScenarioManifest;
  records: ScenarioRecord[];
  split: "dev" | "held-out" | "all";
  recordCounts: {
    total: number;
    books: number;
    trades: number;
    takerRequests: number;
  };
  timeRange: {
    fromTs: number;
    toTs: number;
  } | null;
}

export function defaultScenariosDir(): string {
  const cwd =
    typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";
  if (cwd.endsWith("apps/engine") || cwd.endsWith("apps\\engine")) {
    return path.resolve(cwd, "scenarios");
  }
  return path.resolve(cwd, "apps/engine/scenarios");
}

export function resolveScenarioPaths(
  name: string,
  scenariosDir: string = defaultScenariosDir(),
): { manifestPath: string; payloadPath: string; scenariosDir: string } {
  if (!name || typeof name !== "string") {
    throw new ScenarioSecurityError("Scenario name is required");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0")) {
    throw new ScenarioSecurityError(
      `Path traversal attempt detected in scenario name: ${JSON.stringify(name)}`,
    );
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new ScenarioSecurityError(`Invalid scenario name format: ${JSON.stringify(name)}`);
  }
  const resolvedBase = path.resolve(scenariosDir);
  const manifestPath = path.resolve(resolvedBase, `${name}.json`);
  const payloadPath = path.resolve(resolvedBase, `${name}.ndjson`);

  if (path.dirname(manifestPath) !== resolvedBase || path.dirname(payloadPath) !== resolvedBase) {
    throw new ScenarioSecurityError(`Path resolves outside scenarios directory: ${name}`);
  }

  return { manifestPath, payloadPath, scenariosDir: resolvedBase };
}

export async function loadScenarioManifest(
  name: string,
  options: { scenariosDir?: string } = {},
): Promise<ScenarioManifest> {
  const { manifestPath } = resolveScenarioPaths(name, options.scenariosDir);
  let content: string;
  try {
    content = await fs.readFile(manifestPath, "utf-8");
  } catch (err: unknown) {
    throw new Error(`Scenario manifest not found at '${manifestPath}': ${(err as Error).message}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch (err: unknown) {
    throw new Error(`Invalid JSON in manifest '${name}.json': ${(err as Error).message}`);
  }

  const result = scenarioManifestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(`Invalid scenario manifest '${name}.json': ${result.error.message}`);
  }
  return result.data;
}

export function parseScenarioRecords(ndjson: string, scenarioName = "scenario"): ScenarioRecord[] {
  const lines = ndjson.split(/\r?\n/);
  const records: ScenarioRecord[] = [];
  let lineNumber = 0;

  for (const rawLine of lines) {
    lineNumber++;
    const line = rawLine.trim();
    if (!line) continue;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(line);
    } catch (err: unknown) {
      throw new ScenarioFormatError(
        scenarioName,
        lineNumber,
        `Invalid JSON: ${(err as Error).message}`,
      );
    }

    const parsed = scenarioRecordSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new ScenarioFormatError(scenarioName, lineNumber, parsed.error.message);
    }
    records.push(parsed.data);
  }

  if (records.length === 0) {
    throw new Error(`Scenario '${scenarioName}' has no valid records`);
  }

  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const curr = records[i];
    if (prev && curr && curr.ts < prev.ts) {
      throw new Error(
        `Scenario '${scenarioName}' records must be monotonically ordered by timestamp`,
      );
    }
  }

  return records;
}

export async function loadScenario(
  name: string,
  options: LoadScenarioOptions = {},
): Promise<LoadedScenario> {
  const role: ScenarioAccessRole = options.role ?? "research";
  const { payloadPath, scenariosDir } = resolveScenarioPaths(name, options.scenariosDir);

  // 1. Read and validate manifest FIRST
  const manifest = await loadScenarioManifest(name, { scenariosDir });

  // 2. Held-out protection gate: FAIL CLOSED BEFORE reading the payload file
  if (manifest.heldOut && role !== "evaluator") {
    throw new HeldOutAccessError(manifest.name);
  }

  const requestedSplit = options.split ?? (manifest.heldOut ? "held-out" : "dev");
  if (requestedSplit === "held-out" && role !== "evaluator") {
    throw new HeldOutAccessError(manifest.name);
  }

  // 3. Read payload only after held-out authorization check passes
  let payloadContent: string;
  try {
    payloadContent = await fs.readFile(payloadPath, "utf-8");
  } catch (err: unknown) {
    throw new Error(`Scenario payload not found at '${payloadPath}': ${(err as Error).message}`);
  }

  const allRecords = parseScenarioRecords(payloadContent, name);

  // 4. Apply window and partition splits
  let records = allRecords;

  if (requestedSplit === "dev" && manifest.devWindow) {
    const { fromTs, toTs } = manifest.devWindow;
    records = records.filter((r) => r.ts >= fromTs && r.ts <= toTs);
  } else if (requestedSplit === "held-out" && manifest.heldOutWindow) {
    const { fromTs, toTs } = manifest.heldOutWindow;
    records = records.filter((r) => r.ts >= fromTs && r.ts <= toTs);
  }

  if (options.timeWindow) {
    const { fromTs, toTs } = options.timeWindow;
    if (fromTs !== undefined) {
      records = records.filter((r) => r.ts >= fromTs);
    }
    if (toTs !== undefined) {
      records = records.filter((r) => r.ts <= toTs);
    }
  }

  let books = 0;
  let trades = 0;
  let takerRequests = 0;
  for (const r of records) {
    if (r.type === "book") books++;
    else if (r.type === "trade") trades++;
    else if (r.type === "taker_request") takerRequests++;
  }

  const first = records[0];
  const last = records.at(-1);
  const timeRange = first && last ? { fromTs: first.ts, toTs: last.ts } : null;

  return {
    manifest,
    records,
    split: requestedSplit,
    recordCounts: {
      total: records.length,
      books,
      trades,
      takerRequests,
    },
    timeRange,
  };
}

export function splitRecordsByTime(
  records: readonly ScenarioRecord[],
  splitTs: number,
): { dev: ScenarioRecord[]; heldOut: ScenarioRecord[] } {
  const dev: ScenarioRecord[] = [];
  const heldOut: ScenarioRecord[] = [];
  for (const r of records) {
    if (r.ts < splitTs) {
      dev.push(r);
    } else {
      heldOut.push(r);
    }
  }
  return { dev, heldOut };
}

export function splitRecordsByRatio(
  records: readonly ScenarioRecord[],
  devRatio: number,
): { dev: ScenarioRecord[]; heldOut: ScenarioRecord[]; splitTs: number } {
  if (!Number.isFinite(devRatio) || devRatio <= 0 || devRatio >= 1) {
    throw new Error("devRatio must be a finite number between 0 and 1 exclusive");
  }
  if (records.length === 0) {
    return { dev: [], heldOut: [], splitTs: 0 };
  }
  const splitIndex = Math.min(
    records.length - 1,
    Math.max(0, Math.floor(records.length * devRatio)),
  );
  const splitTs = records[splitIndex]?.ts ?? 0;
  const { dev, heldOut } = splitRecordsByTime(records, splitTs);
  return { dev, heldOut, splitTs };
}

export async function listScenarios(
  options: { scenariosDir?: string } = {},
): Promise<ScenarioManifest[]> {
  const dir = path.resolve(options.scenariosDir ?? defaultScenariosDir());
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = entries.filter((e) => e.endsWith(".json"));
  const manifests: ScenarioManifest[] = [];

  for (const file of jsonFiles) {
    const name = file.slice(0, -5);
    try {
      const manifest = await loadScenarioManifest(name, { scenariosDir: dir });
      manifests.push(manifest);
    } catch {
      // Ignore unparseable or non-manifest JSON files
    }
  }

  manifests.sort((a, b) => a.name.localeCompare(b.name));
  return manifests;
}
