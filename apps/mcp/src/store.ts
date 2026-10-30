import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type PairStatus, type Side, schemas } from "@zethos/sdk";
import { z } from "zod";
import { ToolError } from "./errors.js";

const entrySchema = z.object({
  quote: z.discriminatedUnion("route", [schemas.paperQuote, schemas.vaultQuote]),
  request: schemas.quoteRequest,
  market: schemas.pairStatus,
  side: schemas.side,
  notional: schemas.uint(256),
});
export type Entry = z.infer<typeof entrySchema>;
export type StoredResult = { data: Record<string, unknown>; isError?: boolean };
type Attempt = { state: string; result: string | null };

/** Quotes and attempt receipts survive client reconnects and process restarts. No keys. */
export class Ledger {
  private readonly db: Database;
  constructor(
    path: string,
    private readonly scope: string,
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_quotes (
        scope TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(scope, id)
      );
      CREATE TABLE IF NOT EXISTS mcp_attempts (
        scope TEXT NOT NULL, id TEXT NOT NULL, day TEXT NOT NULL,
        notional TEXT NOT NULL, charged INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL, result TEXT,
        PRIMARY KEY(scope, id)
      );
      CREATE INDEX IF NOT EXISTS mcp_daily ON mcp_attempts(scope, day);
    `);
  }
  save(id: string, entry: Entry): void {
    this.db
      .query("INSERT INTO mcp_quotes(scope,id,body) VALUES (?,?,?)")
      .run(this.scope, id, JSON.stringify(entrySchema.parse(entry)));
  }
  quote(id: string): Entry {
    const row = this.db
      .query<{ body: string }, [string, string]>(
        "SELECT body FROM mcp_quotes WHERE scope=? AND id=?",
      )
      .get(this.scope, id);
    if (!row)
      throw new ToolError(
        "unknown_quote",
        "Quote not found for this configured identity. Request a fresh quote.",
      );
    return entrySchema.parse(JSON.parse(row.body));
  }
  receipt(id: string): StoredResult | null {
    const row = this.db
      .query<Attempt, [string, string]>(
        "SELECT state,result FROM mcp_attempts WHERE scope=? AND id=?",
      )
      .get(this.scope, id);
    if (!row) return null;
    if (!row.result)
      throw new ToolError(
        "execution_unknown",
        "A submission was already started. Check get_my_fills; this quote will not be submitted again.",
      );
    return JSON.parse(row.result) as StoredResult;
  }
  reserve(id: string, day: string, amount: bigint, limit: bigint): StoredResult | null {
    return this.db
      .transaction(() => {
        const existing = this.receipt(id);
        if (existing) return existing;
        const rows = this.db
          .query<{ notional: string }, [string, string]>(
            "SELECT notional FROM mcp_attempts WHERE scope=? AND day=? AND charged=1",
          )
          .all(this.scope, day);
        const spent = rows.reduce((sum, row) => sum + BigInt(row.notional), 0n);
        if (spent + amount > limit)
          throw new ToolError(
            "daily_limit",
            "This swap would exceed the configured UTC-day notional budget.",
          );
        this.db
          .query("INSERT INTO mcp_attempts(scope,id,day,notional,state) VALUES (?,?,?,?,?)")
          .run(this.scope, id, day, amount.toString(), "pending");
        return null;
      })
      .immediate();
  }
  finish(id: string, result: StoredResult, charged = true): void {
    this.db
      .query("UPDATE mcp_attempts SET state=?,result=?,charged=? WHERE scope=? AND id=?")
      .run(
        result.isError ? "failed" : "complete",
        JSON.stringify(result),
        charged ? 1 : 0,
        this.scope,
        id,
      );
  }
  close(): void {
    this.db.close();
  }
}

export function makeEntry(
  quote: Entry["quote"],
  request: Entry["request"],
  market: PairStatus,
  side: Side,
  notional: bigint,
): Entry {
  return { quote, request, market, side, notional: notional.toString() };
}
