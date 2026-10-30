import { fileURLToPath } from "node:url";
import { getAddress, isAddress, zeroAddress } from "viem";
import { z } from "zod";

const origin = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  }, "Expected an HTTP(S) origin without credentials, path or query");
export const decimal = z
  .string()
  .max(100)
  .regex(/^\d+(?:\.\d+)?$/)
  .refine((value) => /[1-9]/.test(value), "Amount must be positive");
const usd = decimal.refine(
  (value) => (value.split(".")[1]?.length ?? 0) <= 6,
  "USD limits allow at most six decimal places",
);
const vars = z.object({
  ZETHOS_ENGINE_URL: origin.default("http://localhost:8787"),
  ZETHOS_CHAIN_ID: z.coerce
    .number()
    .pipe(z.union([z.literal(177), z.literal(133)]))
    .default(177),
  ZETHOS_TAKER_ADDRESS: z
    .string()
    .refine(
      (v) => isAddress(v) && v.toLowerCase() !== zeroAddress,
      "Set a nonzero public taker address",
    ),
  ZETHOS_MAX_NOTIONAL_USD: usd.default("1000"),
  ZETHOS_DAILY_NOTIONAL_USD: usd.default("5000"),
  ZETHOS_WEB_URL: origin.default("http://localhost:3000"),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  MCP_HOST: z.string().min(1).default("127.0.0.1"),
  MCP_AUTH_TOKEN: z.string().min(32).optional(),
  MCP_ALLOWED_ORIGINS: z.string().default(""),
  MCP_STATE_PATH: z
    .string()
    .min(1)
    .default(fileURLToPath(new URL("../data/mcp.db", import.meta.url))),
  HSK_RPC_URL: z.string().url().optional(),
});

export function loadConfig(env: Record<string, unknown>) {
  const result = vars.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid MCP configuration: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  const v = result.data;
  const allowedOrigins = v.MCP_ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const allowed of allowedOrigins) origin.parse(allowed);
  return {
    engineUrl: new URL(v.ZETHOS_ENGINE_URL).origin,
    chainId: v.ZETHOS_CHAIN_ID,
    taker: getAddress(v.ZETHOS_TAKER_ADDRESS),
    maxNotionalUsd: v.ZETHOS_MAX_NOTIONAL_USD,
    dailyNotionalUsd: v.ZETHOS_DAILY_NOTIONAL_USD,
    webUrl: new URL(v.ZETHOS_WEB_URL).origin,
    port: v.MCP_PORT,
    host: v.MCP_HOST,
    authToken: v.MCP_AUTH_TOKEN,
    allowedOrigins,
    statePath: v.MCP_STATE_PATH,
    rpcUrl: v.HSK_RPC_URL,
  };
}
export type Config = ReturnType<typeof loadConfig>;
