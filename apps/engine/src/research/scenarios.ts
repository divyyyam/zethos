import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PAIRS, type Pair, VENUE_IDS } from "../config";

const addressRegex = /^0x[0-9a-fA-F]{40}$/;
const uint256Regex = /^[1-9]\d*$/;
const UINT256_MAX = 2n ** 256n - 1n;

const levelSchema = z.tuple([z.number().positive(), z.number().positive()]);
const bookSchema = z.strictObject({
  bids: z.array(levelSchema).min(1),
  asks: z.array(levelSchema).min(1),
});

export const scenarioBookRecordSchema = z.strictObject({
  type: z.literal("book"),
  ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pair: z.enum(PAIRS),
  venue: z.enum(VENUE_IDS),
  book: bookSchema,
});

export const scenarioTradeRecordSchema = z.strictObject({
  type: z.literal("trade"),
  ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pair: z.enum(PAIRS),
  venue: z.enum(VENUE_IDS),
  trade: z.strictObject({
    id: z.string().min(1),
    ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    side: z.enum(["buy", "sell"]),
    price: z.number().positive(),
    size: z.number().positive(),
  }),
});

export const scenarioTakerRequestRecordSchema = z.strictObject({
  type: z.literal("taker_request"),
  ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pair: z.enum(PAIRS),
  side: z.enum(["buy", "sell"]),
  amountIn: z
    .string()
    .regex(uint256Regex, "amountIn must be a positive base-10 integer string")
    .refine((val) => {
      try {
        const n = BigInt(val);
        return n > 0n && n <= UINT256_MAX;
      } catch {
        return false;
      }
    }, "amountIn must be positive and within uint256 max"),
  taker: z.string().regex(addressRegex, "invalid taker address"),
  id: z.string().min(1).optional(),
  tier: z.enum(["normal", "toxic", "internal", "watch", "blocked", "probation"]).optional(),
  score: z.number().finite().min(0).max(1).optional(),
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

export const scenarioManifestSchema = z
  .strictObject({
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
  })
  .refine(
    (m) => {
      if (m.devWindow && m.devWindow.fromTs > m.devWindow.toTs) return false;
      if (m.heldOutWindow && m.heldOutWindow.fromTs > m.heldOutWindow.toTs) return false;
      if (m.devWindow && m.heldOutWindow) {
        const overlap =
          Math.max(m.devWindow.fromTs, m.heldOutWindow.fromTs) <=
          Math.min(m.devWindow.toTs, m.heldOutWindow.toTs);
        if (overlap) return false;
      }
      return true;
    },
    { message: "Scenario windows must be ordered and non-overlapping" },
  );

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
  scenariosDir?: string | undefined;
  role?: ScenarioAccessRole | undefined;
  timeWindow?:
    | {
        fromTs?: number | undefined;
        toTs?: number | undefined;
      }
    | undefined;
  split?: ("dev" | "held-out" | "all") | undefined;
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

export interface ScenarioPaths {
  manifestPath: string;
  payloadPath: string;
  devPayloadPath: string;
  heldOutPayloadPath: string;
  scenariosDir: string;
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
): ScenarioPaths {
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
  const devPayloadPath = path.resolve(resolvedBase, `${name}.dev.ndjson`);
  const heldOutPayloadPath = path.resolve(resolvedBase, `${name}.heldout.ndjson`);

  if (
    path.dirname(manifestPath) !== resolvedBase ||
    path.dirname(payloadPath) !== resolvedBase ||
    path.dirname(devPayloadPath) !== resolvedBase ||
    path.dirname(heldOutPayloadPath) !== resolvedBase
  ) {
    throw new ScenarioSecurityError(`Path resolves outside scenarios directory: ${name}`);
  }

  // Real-path confinement check to prevent symlink / junction escapes
  try {
    const realBase = fsSync.realpathSync(resolvedBase);
    const checkConfinement = (filePath: string) => {
      try {
        const realTarget = fsSync.realpathSync(filePath);
        if (realTarget !== realBase && !realTarget.startsWith(realBase + path.sep)) {
          throw new ScenarioSecurityError(
            `Symlink target '${realTarget}' escapes scenario directory '${realBase}'`,
          );
        }
      } catch (err: unknown) {
        if (err instanceof ScenarioSecurityError) throw err;
      }
    };
    checkConfinement(manifestPath);
    checkConfinement(payloadPath);
    checkConfinement(devPayloadPath);
    checkConfinement(heldOutPayloadPath);
  } catch (err: unknown) {
    if (err instanceof ScenarioSecurityError) throw err;
  }

  return {
    manifestPath,
    payloadPath,
    devPayloadPath,
    heldOutPayloadPath,
    scenariosDir: resolvedBase,
  };
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

export function parseScenarioRecords(
  ndjson: string,
  scenarioName = "scenario",
  expectedPair?: Pair,
): ScenarioRecord[] {
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
    if (expectedPair && parsed.data.pair !== expectedPair) {
      throw new ScenarioFormatError(
        scenarioName,
        lineNumber,
        `Record pair '${parsed.data.pair}' does not match scenario pair '${expectedPair}'`,
      );
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
  if (role !== "research" && role !== "evaluator") {
    throw new Error(`Invalid scenario role: ${String(role)}`);
  }
  const paths = resolveScenarioPaths(name, options.scenariosDir);

  // 1. Read and validate manifest FIRST
  const manifest = await loadScenarioManifest(name, { scenariosDir: paths.scenariosDir });

  // 2. Held-out protection gate: FAIL CLOSED BEFORE reading any payload file
  if (manifest.heldOut && role !== "evaluator") {
    throw new HeldOutAccessError(manifest.name);
  }

  const requestedSplit = options.split ?? (manifest.heldOut ? "held-out" : "dev");
  if (requestedSplit !== "dev" && requestedSplit !== "held-out" && requestedSplit !== "all") {
    throw new Error(`Invalid split option: ${String(requestedSplit)}`);
  }

  if (requestedSplit === "held-out" && role !== "evaluator") {
    throw new HeldOutAccessError(manifest.name);
  }

  // If manifest defines a heldOutWindow:
  if (manifest.heldOutWindow) {
    if (role === "research") {
      // Research access can NEVER request "all" or "held-out" when heldOutWindow exists
      if (requestedSplit === "all") {
        throw new HeldOutAccessError(
          `Scenario '${manifest.name}' contains a held-out window; research role cannot request split 'all'`,
        );
      }
      // Research access cannot widen timeWindow into the held-out window
      if (
        options.timeWindow?.toTs !== undefined &&
        manifest.devWindow &&
        options.timeWindow.toTs > manifest.devWindow.toTs
      ) {
        throw new HeldOutAccessError(
          "Custom timeWindow extends beyond devWindow into held-out partition",
        );
      }
    }
  }

  // 3. Determine payload file to read with strict isolation
  let targetPayloadPath: string;
  if (role === "research") {
    // If scenario has a heldOutWindow, it MUST read the separated devPayloadPath
    if (manifest.heldOutWindow) {
      try {
        await fs.stat(paths.devPayloadPath);
        targetPayloadPath = paths.devPayloadPath;
      } catch {
        throw new HeldOutAccessError(
          `Scenario '${manifest.name}' contains a mixed payload with held-out window. ` +
            `Research access is rejected; materialize a separate '${manifest.name}.dev.ndjson' file for dev access.`,
        );
      }
    } else {
      try {
        await fs.stat(paths.devPayloadPath);
        targetPayloadPath = paths.devPayloadPath;
      } catch {
        targetPayloadPath = paths.payloadPath;
      }
    }
  } else {
    // role === "evaluator"
    if (requestedSplit === "held-out") {
      try {
        await fs.stat(paths.heldOutPayloadPath);
        targetPayloadPath = paths.heldOutPayloadPath;
      } catch {
        targetPayloadPath = paths.payloadPath;
      }
    } else if (requestedSplit === "dev") {
      try {
        await fs.stat(paths.devPayloadPath);
        targetPayloadPath = paths.devPayloadPath;
      } catch {
        targetPayloadPath = paths.payloadPath;
      }
    } else {
      targetPayloadPath = paths.payloadPath;
    }
  }

  let payloadContent: string;
  try {
    payloadContent = await fs.readFile(targetPayloadPath, "utf-8");
  } catch (err: unknown) {
    throw new Error(
      `Scenario payload not found at '${targetPayloadPath}': ${(err as Error).message}`,
    );
  }

  const allRecords = parseScenarioRecords(payloadContent, name, manifest.pair);

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

export async function materializeScenarioPartitions(
  name: string,
  options: { scenariosDir?: string } = {},
): Promise<{ devPath: string; heldOutPath: string }> {
  const paths = resolveScenarioPaths(name, options.scenariosDir);
  const manifest = await loadScenarioManifest(name, { scenariosDir: paths.scenariosDir });
  const { devWindow, heldOutWindow } = manifest;
  if (!devWindow || !heldOutWindow) {
    throw new Error(`Scenario '${name}' does not specify both devWindow and heldOutWindow`);
  }
  const payloadContent = await fs.readFile(paths.payloadPath, "utf-8");
  const records = parseScenarioRecords(payloadContent, name, manifest.pair);

  const devRecords = records.filter((r) => r.ts >= devWindow.fromTs && r.ts <= devWindow.toTs);
  const heldOutRecords = records.filter(
    (r) => r.ts >= heldOutWindow.fromTs && r.ts <= heldOutWindow.toTs,
  );

  const devContent = `${devRecords.map((r) => JSON.stringify(r)).join("\n")}\n`;
  const heldOutContent = `${heldOutRecords.map((r) => JSON.stringify(r)).join("\n")}\n`;

  await fs.writeFile(paths.devPayloadPath, devContent);
  await fs.writeFile(paths.heldOutPayloadPath, heldOutContent);

  return { devPath: paths.devPayloadPath, heldOutPath: paths.heldOutPayloadPath };
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
