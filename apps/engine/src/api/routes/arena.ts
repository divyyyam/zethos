import type { Hono } from "hono";
import { limit } from "../http";
import type { RouteOptions } from "../types";

export function registerArenaRoutes(app: Hono, { engine }: RouteOptions) {
  app.get("/arena", async (c) => c.json((await engine()).arenaView()));

  app.get("/arena/takers", async (c) =>
    c.json({ takers: (await engine()).takers(limit(c.req.query("limit"), 50)) }),
  );

  app.get("/decisions", async (c) =>
    c.json({
      decisions: (await engine()).decisions(limit(c.req.query("limit"), 20), c.req.query("type")),
    }),
  );
}
