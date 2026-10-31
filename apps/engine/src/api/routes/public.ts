import type { Hono } from "hono";
import { limit } from "../http";
import type { RouteOptions } from "../types";

export function registerPublicRoutes(app: Hono, { engine, clock }: RouteOptions) {
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/status", async (c) => c.json((await engine()).status()));

  app.get("/diagnosis", async (c) => {
    const diagnosis = (await engine()).diagnosis(
      clock(),
      c.req.query("pair"),
      c.req.query("window"),
    );
    return c.json(diagnosis);
  });

  app.get("/fills", async (c) => {
    const fills = await (await engine()).fills(
      c.req.query("taker"),
      limit(c.req.query("limit"), 20),
      c.req.query("epoch") === undefined ? undefined : Number(c.req.query("epoch")),
    );
    return c.json({ fills });
  });

  app.get("/stats", async (c) => {
    const now = clock();
    const from = Number(c.req.query("from") ?? now - 3_600_000);
    const to = Number(c.req.query("to") ?? now);
    return c.json((await engine()).stats(c.req.query("pair") ?? "HSK/USDT", from, to));
  });
}
