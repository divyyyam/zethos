import path from "node:path";
import { z } from "zod";
import { type ReplayRecord, replayRecord } from "./replay";

/**
 * Turns an S9 development recording into a market replay for the stage fallback.
 *
 * S9 payloads mix market events (`book`, `trade`) with `taker_request` evidence. Only the
 * market events drive the engine; taker requests are counted and dropped, never executed.
 * Held-out recordings are refused: the fallback must never consume evaluation data.
 */

const manifestSchema = z.object({
  name: z.string().min(1),
  heldOut: z.boolean(),
  heldOutWindow: z.object({ fromTs: z.number(), toTs: z.number() }).optional(),
});

export interface ReplaySource {
  /** Market events in recording time, ordered. */
  records: ReplayRecord[];
  /** Number of taker_request lines that were skipped. */
  skippedTakerRequests: number;
  /** File actually read. */
  payloadPath: string;
  /** Scenario name when a manifest was found. */
  scenario: string | null;
  durationMs: number;
}

export interface ReplayFiles {
  exists(file: string): Promise<boolean>;
  read(file: string): Promise<string>;
}

export class HeldOutReplayError extends Error {
  constructor(name: string) {
    super(`Scenario '${name}' is held out and cannot be used as a replay fallback`);
    this.name = "HeldOutReplayError";
  }
}

/** Parses S9 or legacy replay NDJSON, keeping only market events. */
export function parseScenarioReplay(ndjson: string): {
  records: ReplayRecord[];
  skippedTakerRequests: number;
} {
  const records: ReplayRecord[] = [];
  let skippedTakerRequests = 0;
  const lines = ndjson.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`Invalid replay record on line ${i + 1}: not JSON`);
    }
    const type = z.object({ type: z.string() }).safeParse(json);
    if (type.success && type.data.type === "taker_request") {
      skippedTakerRequests++;
      continue;
    }
    const parsed = replayRecord.safeParse(json);
    if (!parsed.success) throw new Error(`Invalid replay record on line ${i + 1}`);
    records.push(parsed.data);
  }
  if (!records.length) throw new Error("Replay file has no book or trade records");
  for (let i = 1; i < records.length; i++)
    if ((records[i]?.ts ?? 0) < (records[i - 1]?.ts ?? 0))
      throw new Error("Replay timestamps must be ordered");
  return { records, skippedTakerRequests };
}

/**
 * Resolves `FEEDS_REPLAY`: a scenario manifest (`name.json`), an S9 payload (`name.ndjson`)
 * or a legacy replay file. A sibling manifest is always checked for the held-out flag.
 */
export async function loadReplaySource(target: string, files: ReplayFiles): Promise<ReplaySource> {
  const resolved = path.resolve(target);
  const dir = path.dirname(resolved);
  const base = resolved.slice(dir.length + 1).replace(/\.(json|dev\.ndjson|ndjson)$/, "");
  const manifestPath = path.resolve(dir, `${base}.json`);

  let scenario: string | null = null;
  let payloadPath = resolved.endsWith(".json") ? path.resolve(dir, `${base}.ndjson`) : resolved;

  if (await files.exists(manifestPath)) {
    const manifest = manifestSchema.parse(JSON.parse(await files.read(manifestPath)));
    scenario = manifest.name;
    if (manifest.heldOut) throw new HeldOutReplayError(manifest.name);
    if (manifest.heldOutWindow) {
      // Mixed recordings may only be replayed through their materialized dev partition.
      const devPath = path.resolve(dir, `${base}.dev.ndjson`);
      if (!(await files.exists(devPath)))
        throw new Error(
          `Scenario '${manifest.name}' has a held-out window; materialize '${base}.dev.ndjson' first`,
        );
      payloadPath = devPath;
    }
  } else if (resolved.endsWith(".json")) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  if (!(await files.exists(payloadPath)))
    throw new Error(`Replay payload not found: ${payloadPath}`);
  const { records, skippedTakerRequests } = parseScenarioReplay(await files.read(payloadPath));
  const first = records[0]?.ts ?? 0;
  const last = records[records.length - 1]?.ts ?? first;
  return { records, skippedTakerRequests, payloadPath, scenario, durationMs: last - first };
}

/**
 * Shifts recording time onto wall time so quote expiry verification stays meaningful.
 * Book, record and trade timestamps move by the same offset, preserving order and gaps.
 */
export function remapToWallTime(
  records: ReplayRecord[],
  start: number,
  offsetMs = 0,
): ReplayRecord[] {
  const first = records[0]?.ts ?? 0;
  const shift = start + offsetMs - first;
  return records.map((r) =>
    r.type === "trade"
      ? { ...r, ts: r.ts + shift, trade: { ...r.trade, ts: r.trade.ts + shift } }
      : { ...r, ts: r.ts + shift },
  );
}

/**
 * Plays a finite recording. With `loop`, each pass is re-shifted to start one gap after the
 * previous pass ends and trade IDs are suffixed so the engine doesn't de-duplicate them.
 * Without `loop`, the recording ends and the engine's feeds go stale and degrade on their own;
 * there is never a live-feed or sample fallback.
 */
export class ReplayPlayer {
  private pass = 0;
  private queue: ReplayRecord[];
  private nextStart: number;

  constructor(
    private readonly source: ReplayRecord[],
    start: number,
    private readonly loop: boolean,
    private readonly gapMs = 1000,
  ) {
    this.queue = remapToWallTime(source, start);
    this.nextStart = start + this.duration() + gapMs;
  }

  get passes(): number {
    return this.pass + 1;
  }

  get finished(): boolean {
    return !this.loop && this.queue.length === 0;
  }

  /** Returns every record due at `now`, in order. */
  take(now: number): ReplayRecord[] {
    const due: ReplayRecord[] = [];
    for (;;) {
      while (this.queue.length && (this.queue[0]?.ts ?? Infinity) <= now) {
        const next = this.queue.shift();
        if (next) due.push(next);
      }
      if (this.queue.length || !this.loop || this.nextStart > now) break;
      this.pass++;
      const suffix = `~${this.pass}`;
      this.queue = remapToWallTime(this.source, this.nextStart).map((r) =>
        r.type === "trade" ? { ...r, trade: { ...r.trade, id: `${r.trade.id}${suffix}` } } : r,
      );
      this.nextStart += this.duration() + this.gapMs;
    }
    return due;
  }

  private duration(): number {
    const first = this.source[0]?.ts ?? 0;
    return (this.source[this.source.length - 1]?.ts ?? first) - first;
  }
}
