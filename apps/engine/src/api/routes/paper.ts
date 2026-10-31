import type { Hono } from "hono";
import { body, CLIENT_HEADER } from "../http";
import type { RouteOptions } from "../types";

export function registerPaperRoutes(app: Hono, { engine, clock }: RouteOptions) {
  app.post("/quote", async (c) => {
    const { response } = await (await engine()).quote(
      await body(c.req.raw),
      c.req.header(CLIENT_HEADER),
      clock(),
      c.req.header("CF-Connecting-IP"),
    );
    return c.json(response);
  });

  app.post("/paper/fill", async (c) =>
    c.json(
      await (await engine()).paperFill(await body(c.req.raw), c.req.header(CLIENT_HEADER), clock()),
    ),
  );
}
