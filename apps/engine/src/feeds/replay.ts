import { z } from "zod";
import { PAIRS, type Pair, VENUE_IDS } from "../config";
import type { Engine } from "../engine";
import type { BookResult } from ".";

const level = z.tuple([z.number().positive(), z.number().positive()]).readonly();
const book = z.object({ bids: z.array(level).min(1), asks: z.array(level).min(1) });
export const replayRecord = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("book"),
    ts: z.number().int().nonnegative(),
    pair: z.enum(PAIRS),
    venue: z.enum(VENUE_IDS),
    book,
  }),
  z.object({
    type: z.literal("trade"),
    ts: z.number().int().nonnegative(),
    pair: z.enum(PAIRS),
    venue: z.enum(VENUE_IDS),
    trade: z.object({
      id: z.string().min(1),
      ts: z.number().int().nonnegative(),
      side: z.enum(["buy", "sell"]),
      price: z.number().positive(),
      size: z.number().positive(),
    }),
  }),
]);
export type ReplayRecord = z.infer<typeof replayRecord>;

export function parseReplay(ndjson: string): ReplayRecord[] {
  const records = ndjson
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return replayRecord.parse(JSON.parse(line));
      } catch {
        throw new Error(`Invalid replay record on line ${index + 1}`);
      }
    });
  if (!records.length) throw new Error("Replay file is empty");
  for (let i = 1; i < records.length; i++)
    if ((records[i]?.ts ?? 0) < (records[i - 1]?.ts ?? 0))
      throw new Error("Replay timestamps must be ordered");
  return records;
}

// A deterministic clock and explicit records let the exact production quote/fill/agent
// code run without an exchange or wall-clock sleeps.
export class Replay {
  private index = 0;
  constructor(readonly records: ReplayRecord[]) {}
  get done(): boolean {
    return this.index >= this.records.length;
  }
  async advance(engine: Engine, now: number): Promise<void> {
    while (this.index < this.records.length) {
      const record = this.records[this.index];
      if (!record || record.ts > now) break;
      const books = new Map<Pair, BookResult[]>();
      const trades: ReplayRecord[] = [];
      while (this.records[this.index]?.ts === record.ts) {
        const item = this.records[this.index++];
        if (!item) break;
        if (item.type === "book")
          books.set(item.pair, [
            ...(books.get(item.pair) ?? []),
            { venue: item.venue, book: item.book, error: null },
          ]);
        else trades.push(item);
      }
      for (const [pair, results] of books) engine.ingest(pair, results, record.ts);
      await engine.ensureArena(record.ts);
      for (const item of trades)
        if (item.type === "trade")
          await engine.ingestTrades(item.pair, item.venue, [item.trade], item.ts);
    }
    await engine.tick(now);
  }
}
