import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { EngineError } from "../engine";
import { CLIENT_HEADER } from "./http";
import { registerArenaRoutes } from "./routes/arena";
import { registerAuthRoutes } from "./routes/auth";
import { registerChatRoutes } from "./routes/chat";
import { registerOperatorRoutes } from "./routes/operator";
import { registerPaperRoutes } from "./routes/paper";
import { registerPublicRoutes } from "./routes/public";
import type { AppOptions } from "./types";

export type { AppOptions } from "./types";

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
  const options = { engine, auth, assistant, clock };
  registerPublicRoutes(app, options);
  registerPaperRoutes(app, options);
  registerArenaRoutes(app, options);
  registerChatRoutes(app, options);
  registerAuthRoutes(app, options);
  registerOperatorRoutes(app, options);
  return app;
}
