import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function createDb(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema, casing: "snake_case" });
}

export type Database = ReturnType<typeof createDb>;
