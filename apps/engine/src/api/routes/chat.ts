import type { Hono } from "hono";
import { EngineError } from "../../engine";
import { body } from "../http";
import type { RouteOptions } from "../types";

export function registerChatRoutes(app: Hono, { engine, assistant, clock }: RouteOptions) {
  app.post("/chat", async (c) => {
    if (!assistant) throw new EngineError("assistant_unavailable", 503);
    return c.json(await assistant.chat(await body(c.req.raw), await engine(), clock()));
  });
}
