import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getAddress } from "viem";
import { z } from "zod";
import { COOKIE, type OperatorAuth } from "../auth";
import { type Engine, EngineError } from "../engine";
import type { Assistant } from "../llm";

export interface AppOptions {
  engine: () => Promise<Engine>;
  corsOrigins: string[];
  waitUntil: (promise: Promise<unknown>) => void;
  auth?: () => Promise<OperatorAuth>;
  assistant?: Assistant;
  clock?: () => number;
}

const CLIENT_HEADER = "X-Zethos-Client";

export function createApp({ engine, corsOrigins, auth, assistant, clock = Date.now }: AppOptions) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: corsOrigins,
      credentials: true,
      allowHeaders: ["Content-Type", CLIENT_HEADER],
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: "invalid_request", message: "Body too large" }, 413),
    }),
  );
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && !corsOrigins.includes(origin))
      return c.json({ error: "unauthorized", message: "Origin is not allowed" }, 403);
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof EngineError) {
      return c.json(
        { error: error.code, message: error.message },
        error.status as ContentfulStatusCode,
      );
    }
    console.error(error);
    return c.json({ error: "internal", message: "Something went wrong" }, 500);
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  const body = async (request: Request) =>
    request.json().catch(() => {
      throw new EngineError("invalid_request", 400, "Body must be JSON");
    });

  const limit = (value: string | undefined, fallback: number) =>
    Math.min(Math.max(Number.parseInt(value ?? "", 10) || fallback, 1), 100);

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/status", async (c) => c.json((await engine()).status()));

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

  app.get("/arena", async (c) => c.json((await engine()).arenaView()));
  app.get("/arena/takers", async (c) =>
    c.json({ takers: (await engine()).takers(limit(c.req.query("limit"), 50)) }),
  );
  app.get("/decisions", async (c) =>
    c.json({
      decisions: (await engine()).decisions(limit(c.req.query("limit"), 20), c.req.query("type")),
    }),
  );
  app.post("/chat", async (c) => {
    if (!assistant) throw new EngineError("assistant_unavailable", 503);
    return c.json(await assistant.chat(await body(c.req.raw), await engine(), clock()));
  });

  const authentication = async () => {
    if (!auth) throw new EngineError("unauthorized", 401, "Operator access is not configured");
    return auth();
  };
  app.get("/auth/nonce", async (c) =>
    c.json({ nonce: await (await authentication()).nonce(clock()) }),
  );
  app.post("/auth/verify", async (c) => {
    const result = await (await authentication()).verify(await body(c.req.raw), clock());
    setCookie(c, COOKIE, result.token, {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === "https:",
      sameSite: "Lax",
      path: "/",
      maxAge: Math.max(0, Math.floor((result.expiry - clock()) / 1000)),
    });
    return c.json({ address: result.address, expiresAt: result.expiry });
  });
  app.post("/auth/logout", async (c) => {
    await (await authentication()).logout(getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  const address = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((value) => getAddress(value));
  const tier = z.enum(["probation", "normal", "watch", "toxic", "blocked"]);
  const validated = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      throw new EngineError("invalid_request", 400, parsed.error.issues[0]?.message);
    return parsed.data;
  };
  app.use("/operator/*", async (c, next) => {
    await (await authentication()).require(getCookie(c, COOKIE), clock());
    await next();
  });
  for (const paused of [true, false])
    app.post(`/operator/${paused ? "pause" : "resume"}`, async (c) => {
      const operator = await (await authentication()).require(getCookie(c, COOKIE), clock());
      await (await engine()).pause(operator, paused, clock());
      return c.json({ ok: true });
    });
  app.post("/operator/taker-tier", async (c) => {
    const operator = await (await authentication()).require(getCookie(c, COOKIE), clock());
    const input = validated(z.object({ address, tier: tier.nullable() }), await body(c.req.raw));
    await (await engine()).setTaker(operator, input.address, { tier: input.tier }, clock());
    return c.json({ ok: true });
  });
  app.post("/operator/labels", async (c) => {
    const operator = await (await authentication()).require(getCookie(c, COOKIE), clock());
    const input = validated(
      z.object({ address, label: z.string().trim().max(80) }),
      await body(c.req.raw),
    );
    await (await engine()).setTaker(operator, input.address, { label: input.label }, clock());
    return c.json({ ok: true });
  });
  app.post("/operator/arena-reset", async (c) => {
    const operator = await (await authentication()).require(getCookie(c, COOKIE), clock());
    await (await engine()).resetArena(operator, clock());
    return c.json((await engine()).arenaView());
  });
  app.get("/pnl", async (c) => {
    await (await authentication()).require(getCookie(c, COOKIE), clock());
    const period = validated(z.enum(["today", "7d", "all"]), c.req.query("period") ?? "all");
    return c.json((await engine()).pnl(period, clock()));
  });

  return app;
}
