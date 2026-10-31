import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { getAddress } from "viem";
import { z } from "zod";
import { COOKIE } from "../../auth";
import { authentication, body, validated } from "../http";
import type { RouteOptions } from "../types";

export function registerOperatorRoutes(app: Hono, { engine, auth, clock }: RouteOptions) {
  const address = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((value) => getAddress(value));

  const tier = z.enum(["probation", "normal", "watch", "toxic", "blocked"]);

  app.use("/operator/*", async (c, next) => {
    await (await authentication(auth)).require(getCookie(c, COOKIE), clock());
    await next();
  });

  for (const paused of [true, false])
    app.post(`/operator/${paused ? "pause" : "resume"}`, async (c) => {
      const operator = await (await authentication(auth)).require(getCookie(c, COOKIE), clock());
      await (await engine()).pause(operator, paused, clock());
      return c.json({ ok: true });
    });

  app.post("/operator/taker-tier", async (c) => {
    const operator = await (await authentication(auth)).require(getCookie(c, COOKIE), clock());
    const input = validated(z.object({ address, tier: tier.nullable() }), await body(c.req.raw));
    await (await engine()).setTaker(operator, input.address, { tier: input.tier }, clock());
    return c.json({ ok: true });
  });

  app.post("/operator/labels", async (c) => {
    const operator = await (await authentication(auth)).require(getCookie(c, COOKIE), clock());
    const input = validated(
      z.object({ address, label: z.string().trim().max(80) }),
      await body(c.req.raw),
    );
    await (await engine()).setTaker(operator, input.address, { label: input.label }, clock());
    return c.json({ ok: true });
  });

  app.post("/operator/arena-reset", async (c) => {
    const operator = await (await authentication(auth)).require(getCookie(c, COOKIE), clock());
    await (await engine()).resetArena(operator, clock());
    return c.json((await engine()).arenaView());
  });

  app.get("/pnl", async (c) => {
    await (await authentication(auth)).require(getCookie(c, COOKIE), clock());
    const period = validated(z.enum(["today", "7d", "all"]), c.req.query("period") ?? "all");
    return c.json((await engine()).pnl(period, clock()));
  });
}
