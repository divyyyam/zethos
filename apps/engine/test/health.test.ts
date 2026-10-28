import { expect, test } from "bun:test";
import { app } from "../src/server";

// Scaffold smoke test. Trading tests belong to docs/engine.md section 19.
test("GET /health responds without trading configuration", async () => {
  const response = await app.request("/health");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
