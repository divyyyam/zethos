import { z } from "zod";
import params from "../params.json";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const port = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(1).max(65535).default(8787),
);

// docs/engine.md section 4.1. Schema only: trading config is not loaded by the health-only stub.
export const envSchema = z.object({
  HSK_RPC_URL: z.url(),
  CHAIN_ID: z.coerce.number().pipe(z.union([z.literal(177), z.literal(133)])),
  VAULT_ADDRESS: address,
  QUOTE_SIGNER_KEY: privateKey,
  EXECUTOR_KEY: privateKey,
  OPERATOR_ADDRESS: address,
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default("gemini-3.8-flash")),
  DB_PATH: z.string().min(1),
  ENGINE_MODE: z.preprocess(emptyToUndefined, z.enum(["live", "dry"]).default("live")),
  ARB_ENABLED: z.preprocess(
    emptyToUndefined,
    z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .default(false),
  ),
  EXCHANGE_API_KEY: optionalString,
  EXCHANGE_API_SECRET: optionalString,
  PORT: port,
  CORS_ORIGIN: z.url(),
});
export type EngineConfig = z.infer<typeof envSchema>;

export const serverEnvSchema = z.object({ PORT: port });
export const defaultParams = params;
// TODO: Load and validate full env, enforce role separation, and hot-reload params per
// docs/engine.md sections 4 and 18 when implementing the agent startup.
