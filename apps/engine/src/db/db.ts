import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Writes run inside the engine's single queue, so one hung connection would stall every quote.
const DB_TIMEOUT_MS = 8000;
neonConfig.fetchFunction = (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(DB_TIMEOUT_MS) });

export function createDb(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema, casing: "snake_case" });
}

export type Database = ReturnType<typeof createDb>;
