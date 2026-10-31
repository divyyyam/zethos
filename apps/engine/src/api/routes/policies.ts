import type { Hono } from "hono";
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
  app.post("/policies", async (c) => {
    const expected = typeof adminToken === "function" ? await adminToken() : (adminToken ?? null);
    const authHeader = c.req.header("Authorization");
    const authorized = await verifyAdminAuth(authHeader, expected);
    if (!authorized) {
      throw new EngineError("unauthorized", 401, "Missing or invalid admin authorization");
    }

    const payload = validated(registrationPayloadSchema, await body(c.req.raw));
    const record = await (await engine()).registerPolicy(payload, clock());
    return c.json(toPolicyDetail(record), 200);
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
    return c.json(toPolicyDetail(record));
  });
}
