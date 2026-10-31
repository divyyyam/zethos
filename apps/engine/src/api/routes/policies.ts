import type { Context, Hono } from "hono";
import { z } from "zod";
import { EngineError } from "../../engine/errors";
import {
  registrationPayloadSchema,
  toPolicyDetail,
  toPolicySummary,
  verifyAdminAuth,
} from "../../policy";
import { body, validated } from "../http";
import type { RouteOptions } from "../types";

export function registerPolicyRoutes(app: Hono, { engine, clock, adminToken }: RouteOptions) {
  const authorize = async (c: Context) => {
    const expected = typeof adminToken === "function" ? await adminToken() : (adminToken ?? null);
    if (!(await verifyAdminAuth(c.req.header("Authorization"), expected)))
      throw new EngineError("unauthorized", 401, "Missing or invalid admin authorization");
  };

  app.post("/policies", async (c) => {
    await authorize(c);

    const payload = validated(registrationPayloadSchema, await body(c.req.raw));
    const record = await (await engine()).registerPolicy(payload, clock());
    return c.json(toPolicyDetail(record), 200);
  });

  app.post("/policies/:id/canary", async (c) => {
    await authorize(c);
    const payload = validated(
      z.strictObject({ allocationPct: z.number().int().min(1).max(100) }),
      await body(c.req.raw),
    );
    const engineInstance = await engine();
    const record = await engineInstance.startCanary(
      c.req.param("id"),
      payload.allocationPct,
      clock(),
    );
    return c.json({
      ...toPolicyDetail(record),
      canaryStats: await engineInstance.canaryStats(record.id),
    });
  });

  app.post("/policies/:id/promote", async (c) => {
    await authorize(c);
    const engineInstance = await engine();
    const record = await engineInstance.promotePolicy(c.req.param("id"), clock());
    return c.json(toPolicyDetail(record));
  });

  app.post("/policies/:id/retire", async (c) => {
    await authorize(c);
    const engineInstance = await engine();
    const record = await engineInstance.retirePolicy(c.req.param("id"), clock());
    return c.json(toPolicyDetail(record));
  });

  app.get("/policies", async (c) => {
    const records = await (await engine()).listPolicies();
    return c.json({ policies: records.map(toPolicySummary) });
  });

  app.get("/policies/:id", async (c) => {
    const id = c.req.param("id");
    const record = await (await engine()).getPolicy(id);
    if (!record) {
      throw new EngineError("not_found", 404, `Policy '${id}' not found`);
    }
    const engineInstance = await engine();
    return c.json({
      ...toPolicyDetail(record),
      canaryStats: record.status === "canary" ? await engineInstance.canaryStats(record.id) : null,
    });
  });
}
