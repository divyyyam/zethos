import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  // Needed for `db:migrate` only: DATABASE_URL=... bun run db:migrate
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
