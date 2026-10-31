import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type Pair,
  type ScenarioBookRecord,
  type ScenarioManifest,
  type ScenarioRecord,
  type ScenarioRecordCounts,
  type ScenarioRecorderOptions,
  type ScenarioRecordSummary,
  type ScenarioTakerRequestRecord,
  type ScenarioTradeRecord,
  scenarioManifestSchema,
  scenarioRecordSchema,
} from "./types.js";

const TYPE_ORDER: Record<ScenarioRecord["type"], number> = {
  book: 0,
  trade: 1,
  taker_request: 2,
};

export class ScenarioSecurityError extends Error {
  constructor(message: string) {
    super(`Scenario security violation: ${message}`);
    this.name = "ScenarioSecurityError";
  }
}

export function defaultScenariosDir(): string {
  const cwd =
    typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";
  if (cwd.endsWith("apps/sniper") || cwd.endsWith("apps\\sniper")) {
    return path.resolve(cwd, "../engine/scenarios");
  }
  if (cwd.endsWith("apps/engine") || cwd.endsWith("apps\\engine")) {
    return path.resolve(cwd, "scenarios");
  }
  return path.resolve(cwd, "apps/engine/scenarios");
}

export function validateScenarioName(name: string): void {
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
}

interface QueuedItem {
  record: ScenarioRecord;
  seq: number;
}

function compareQueuedItems(a: QueuedItem, b: QueuedItem): number {
  if (a.record.ts !== b.record.ts) {
    return a.record.ts - b.record.ts;
  }
  const typeA = TYPE_ORDER[a.record.type];
  const typeB = TYPE_ORDER[b.record.type];
  if (typeA !== typeB) {
    return typeA - typeB;
  }
  if (a.record.type === "book" && b.record.type === "book") {
    const venueCmp = a.record.venue.localeCompare(b.record.venue);
    if (venueCmp !== 0) return venueCmp;
  } else if (a.record.type === "trade" && b.record.type === "trade") {
    const idCmp = a.record.trade.id.localeCompare(b.record.trade.id);
    if (idCmp !== 0) return idCmp;
  } else if (a.record.type === "taker_request" && b.record.type === "taker_request") {
    const takerCmp = a.record.taker.localeCompare(b.record.taker);
    if (takerCmp !== 0) return takerCmp;
    const idA = a.record.id ?? "";
    const idB = b.record.id ?? "";
    const idCmp = idA.localeCompare(idB);
    if (idCmp !== 0) return idCmp;
  }
  return a.seq - b.seq;
}

async function writeManifestFile(
  manifestPath: string,
  payloadPath: string,
  manifest: ScenarioManifest,
): Promise<void> {
  const validatedManifest = scenarioManifestSchema.parse(manifest);

  try {
    const manifestHandle = await fs.open(manifestPath, "wx");
    await manifestHandle.write(`${JSON.stringify(validatedManifest, null, 2)}\n`);
    await manifestHandle.sync();
    await manifestHandle.close();
  } catch (err: unknown) {
    await fs.unlink(payloadPath).catch(() => {});
    await fs.unlink(manifestPath).catch(() => {});
    throw new Error(`Failed to write scenario manifest: ${(err as Error).message}`);
  }
}

export class ScenarioRecorder {
  readonly name: string;
  readonly pair: Pair;
  readonly source: string;
  readonly heldOut: boolean;
  readonly description: string;
  readonly recordedAt: number | string;
  readonly scenariosDir: string;
  readonly manifestPath: string;
  readonly payloadPath: string;

  private readonly maxBufferSize: number;
  private readonly flushIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  private queue: QueuedItem[] = [];
  private seqCounter = 0;
  private flushPromise: Promise<void> | null = null;
  private stopped = false;
  private failed = false;
  private failureError: Error | null = null;

  private fileHandle: fs.FileHandle | null = null;
  private lastFlushedTs = 0;
  private firstRecordTs: number | null = null;
  private lastRecordTs: number | null = null;

  readonly counts: ScenarioRecordCounts = {
    total: 0,
    books: 0,
    trades: 0,
    takerRequests: 0,
  };

  constructor(options: ScenarioRecorderOptions) {
    validateScenarioName(options.name);
    this.name = options.name;
    this.pair = options.pair;
    this.source = options.source ?? "sniper";
    this.heldOut = options.heldOut ?? false;
    this.description =
      options.description ??
      `Recorded ${this.source} observations for ${this.pair} (${
        this.heldOut ? "held-out" : "dev"
      })`;
    this.recordedAt = options.recordedAt ?? Date.now();
    this.maxBufferSize = options.maxBufferSize ?? 500;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;

    const baseDir = path.resolve(options.scenariosDir ?? defaultScenariosDir());
    this.scenariosDir = baseDir;
    this.manifestPath = path.resolve(baseDir, `${this.name}.json`);
    this.payloadPath = path.resolve(baseDir, `${this.name}.ndjson`);

    if (path.dirname(this.manifestPath) !== baseDir || path.dirname(this.payloadPath) !== baseDir) {
      throw new ScenarioSecurityError(`Path resolves outside scenarios directory: ${this.name}`);
    }

    if (fsSync.existsSync(this.manifestPath)) {
      throw new Error(
        `Scenario manifest '${this.manifestPath}' already exists. Refusing to overwrite.`,
      );
    }
    if (fsSync.existsSync(this.payloadPath)) {
      throw new Error(
        `Scenario payload '${this.payloadPath}' already exists. Refusing to overwrite.`,
      );
    }
  }

  async start(): Promise<void> {
    if (this.fileHandle) return;
    await fs.mkdir(this.scenariosDir, { recursive: true });

    try {
      this.fileHandle = await fs.open(this.payloadPath, "wx");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "EEXIST") {
        throw new Error(
          `Scenario payload '${this.payloadPath}' already exists. Refusing to overwrite.`,
        );
      }
      throw err;
    }

    if (this.flushIntervalMs > 0) {
      this.timer = setInterval(() => {
        this.flush().catch((err) => {
          this.failed = true;
          this.failureError = err instanceof Error ? err : new Error(String(err));
        });
      }, this.flushIntervalMs);
    }
  }

  recordBook(record: ScenarioBookRecord): void {
    this.record(record);
  }

  recordTrade(record: ScenarioTradeRecord): void {
    this.record(record);
  }

  recordTakerRequest(record: ScenarioTakerRequestRecord): void {
    this.record(record);
  }

  record(item: ScenarioRecord): void {
    if (this.stopped) {
      throw new Error("Cannot record to stopped ScenarioRecorder");
    }
    if (this.failed) {
      throw new Error(
        `Cannot record to failed ScenarioRecorder: ${this.failureError?.message ?? "unknown error"}`,
      );
    }

    const parsed = scenarioRecordSchema.safeParse(item);
    if (!parsed.success) {
      throw new Error(`Invalid scenario record: ${parsed.error.message}`);
    }
    if (parsed.data.pair !== this.pair) {
      throw new Error(
        `Record pair '${parsed.data.pair}' does not match recorder pair '${this.pair}'`,
      );
    }

    this.queue.push({
      record: parsed.data,
      seq: this.seqCounter++,
    });

    if (this.queue.length >= this.maxBufferSize) {
      this.flush().catch((err) => {
        this.failed = true;
        this.failureError = err instanceof Error ? err : new Error(String(err));
      });
    }
  }

  async flush(): Promise<void> {
    if (this.flushPromise) {
      await this.flushPromise;
      if (this.queue.length === 0) return;
    }

    this.flushPromise = this.performFlush();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private async performFlush(): Promise<void> {
    if (this.queue.length === 0) return;
    if (!this.fileHandle) {
      await this.start();
    }
    if (!this.fileHandle) {
      throw new Error("Failed to initialize file handle for recording");
    }

    const batch = this.queue.splice(0, this.queue.length);
    batch.sort(compareQueuedItems);

    const buffer = this.serializeBatch(batch);

    try {
      await this.fileHandle.write(buffer);
      await this.fileHandle.sync();
    } catch (err: unknown) {
      this.failed = true;
      this.failureError = err instanceof Error ? err : new Error(String(err));
      throw this.failureError;
    }
  }

  private serializeBatch(batch: QueuedItem[]): string {
    let buffer = "";
    for (const item of batch) {
      const rec = item.record;
      if (rec.ts < this.lastFlushedTs) {
        rec.ts = this.lastFlushedTs;
      } else {
        this.lastFlushedTs = rec.ts;
      }

      if (this.firstRecordTs === null) {
        this.firstRecordTs = rec.ts;
      }
      this.lastRecordTs = rec.ts;

      buffer += `${JSON.stringify(rec)}\n`;
      this.counts.total++;
      if (rec.type === "book") this.counts.books++;
      else if (rec.type === "trade") this.counts.trades++;
      else if (rec.type === "taker_request") this.counts.takerRequests++;
    }
    return buffer;
  }

  async stop(): Promise<ScenarioRecordSummary> {
    if (this.stopped) {
      throw new Error("ScenarioRecorder has already stopped");
    }
    this.stopped = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    try {
      await this.flush();
    } catch (err) {
      this.failed = true;
      this.failureError = err instanceof Error ? err : new Error(String(err));
    }

    if (this.fileHandle) {
      try {
        await this.fileHandle.close();
      } catch {
        // ignore close error
      }
      this.fileHandle = null;
    }

    if (this.failed || this.failureError) {
      await fs.unlink(this.payloadPath).catch(() => {});
      throw new Error(`Recording failed: ${this.failureError?.message ?? "unknown write error"}`);
    }

    if (this.counts.total === 0) {
      await fs.unlink(this.payloadPath).catch(() => {});
      throw new Error(`Recording '${this.name}' captured 0 records. Incomplete capture rejected.`);
    }

    const manifest: ScenarioManifest = {
      name: this.name,
      source: this.source,
      pair: this.pair,
      recordedAt: this.recordedAt,
      heldOut: this.heldOut,
      description: this.description,
    };

    await writeManifestFile(this.manifestPath, this.payloadPath, manifest);

    const timeRange =
      this.firstRecordTs !== null && this.lastRecordTs !== null
        ? { fromTs: this.firstRecordTs, toTs: this.lastRecordTs }
        : null;

    return {
      name: this.name,
      manifestPath: this.manifestPath,
      payloadPath: this.payloadPath,
      counts: { ...this.counts },
      timeRange,
      heldOut: this.heldOut,
    };
  }
}
