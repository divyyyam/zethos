import type { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { COOKIE } from "../../auth";
import { authentication, body } from "../http";
import type { RouteOptions } from "../types";

export function registerAuthRoutes(app: Hono, { auth, clock }: RouteOptions) {
  app.get("/auth/nonce", async (c) =>
    c.json({ nonce: await (await authentication(auth)).nonce(clock()) }),
  );

  app.post("/auth/verify", async (c) => {
    const result = await (await authentication(auth)).verify(await body(c.req.raw), clock());
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
    await (await authentication(auth)).logout(getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
}
