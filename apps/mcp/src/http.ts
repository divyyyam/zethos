import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Config } from "./config.js";
import { createServer } from "./server.js";
import type { TradingService } from "./service.js";

export function createHttpHandler(service: TradingService, config: Config) {
  const local = ["127.0.0.1", "localhost", "::1"].includes(config.host);
  if (!local && !config.authToken)
    throw new Error(
      "Set MCP_AUTH_TOKEN (at least 32 characters) before binding HTTP beyond loopback.",
    );
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return Response.json({ error: "not_found" }, { status: 404 });
    const host = request.headers.get("host") ?? url.host;
    if (local && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host))
      return Response.json({ error: "invalid_host" }, { status: 403 });
    const origin = request.headers.get("origin");
    if (origin && !config.allowedOrigins.includes(origin))
      return Response.json({ error: "invalid_origin" }, { status: 403 });
    const cors: Record<string, string> = origin
      ? {
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id",
          "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
        }
      : {};
    cors["Cache-Control"] = "no-store";
    // Browser preflights carry no bearer token. Origin/host checks still apply.
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (config.authToken) {
      const given = Buffer.from(request.headers.get("authorization") ?? "");
      const expected = Buffer.from(`Bearer ${config.authToken}`);
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });
    }
    // The SDK needs a fresh server/transport per stateless HTTP request. Trading state
    // and the ledger are deliberately shared across all requests and connections.
    const server = createServer(service);
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: 65536,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request);
      for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
      return response;
    } finally {
      await server.close();
    }
  };
}
