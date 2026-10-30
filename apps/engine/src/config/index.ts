import { MAINNET_TOKEN_ADDRESSES } from "@zethos/shared";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import raw from "../../params.json";
import type { TokenSymbol } from "../tokens";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

const blank = (value: unknown) => (value === "" ? undefined : value);
const address = z.preprocess(
  blank,
  z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
);

const envSchema = z.object({
  ENGINE_MODE: z.preprocess(
    blank,
    z
      .literal("shadow", "Only ENGINE_MODE=shadow exists until the vault is deployed")
      .default("shadow"),
  ),
  CHAIN_ID: z.coerce.number().pipe(z.union([z.literal(177), z.literal(133)])),
  HSK_RPC_URL: z.url(),
  CORS_ORIGIN: z.string().min(1),
  PAPER_SIGNER_KEY: z.preprocess(
    blank,
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
  ),
  QUOTE_SIGNER_KEY: z.preprocess(
    blank,
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
  ),
  EXECUTOR_KEY: z.preprocess(
    blank,
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
  ),
  OPERATOR_ADDRESS: address,
  SESSION_SECRET: z.preprocess(blank, z.string().min(32).optional()),
  SHADOW_ASSUME_DECIMALS: z.enum(["true", "false"]).default("false"),
  GEMINI_API_KEY: z.preprocess(blank, z.string().min(1).optional()),
  GEMINI_MODEL: z.string().default(DEFAULT_GEMINI_MODEL),
  DATABASE_URL: z.preprocess(blank, z.url().optional()),
  USDT_ADDRESS: address,
  WHSK_ADDRESS: address,
  WETH_ADDRESS: address,
});

export interface Config {
  chainId: 177 | 133;
  rpcUrl: string;
  corsOrigins: string[];
  paperSignerKey: Hex | null;
  databaseUrl: string | null;
  tokens: Record<TokenSymbol, Address>;
  operator: Address | null;
  sessionSecret: string | null;
  assumeDecimals: boolean;
  geminiKey: string | null;
  geminiModel: string;
}

export function corsOrigins(value: unknown): string[] {
  return typeof value === "string" ? value.split(",").map((origin) => origin.trim()) : [];
}

export function loadConfig(env: Record<string, unknown>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid engine config: ${z.prettifyError(parsed.error)}`);
  const vars = parsed.data;
  for (const value of corsOrigins(vars.CORS_ORIGIN)) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || value !== url.origin)
      throw new Error(
        "CORS_ORIGIN must contain exact HTTP(S) origins without paths or trailing slashes",
      );
  }
  const identities = [vars.PAPER_SIGNER_KEY, vars.QUOTE_SIGNER_KEY, vars.EXECUTOR_KEY]
    .filter((key): key is string => Boolean(key))
    .map((key) => privateKeyToAccount(key as Hex).address.toLowerCase());
  if (vars.OPERATOR_ADDRESS) identities.push(vars.OPERATOR_ADDRESS.toLowerCase());
  if (new Set(identities).size !== identities.length) {
    throw new Error("Owner, paper signer, quote signer and executor must be distinct addresses");
  }
  if (vars.OPERATOR_ADDRESS && !vars.SESSION_SECRET) {
    throw new Error("Set SESSION_SECRET (at least 32 characters) when OPERATOR_ADDRESS is set");
  }
  const fallback = vars.CHAIN_ID === 177 ? MAINNET_TOKEN_ADDRESSES : null;
  const token = (symbol: TokenSymbol, override: string | undefined): Address => {
    const value = override ?? fallback?.[symbol];
    if (!value) throw new Error(`Set ${symbol}_ADDRESS for chain ${vars.CHAIN_ID}`);
    return value as Address;
  };
  return {
    chainId: vars.CHAIN_ID,
    rpcUrl: vars.HSK_RPC_URL,
    corsOrigins: corsOrigins(vars.CORS_ORIGIN),
    paperSignerKey: (vars.PAPER_SIGNER_KEY as Hex | undefined) ?? null,
    databaseUrl: vars.DATABASE_URL ?? null,
    operator: (vars.OPERATOR_ADDRESS as Address | undefined) ?? null,
    sessionSecret: vars.SESSION_SECRET ?? null,
    assumeDecimals: vars.SHADOW_ASSUME_DECIMALS === "true",
    geminiKey: vars.GEMINI_API_KEY ?? null,
    geminiModel: vars.GEMINI_MODEL,
    tokens: {
      USDT: token("USDT", vars.USDT_ADDRESS),
      WHSK: token("WHSK", vars.WHSK_ADDRESS),
      WETH: token("WETH", vars.WETH_ADDRESS),
    },
  };
}

export const PAIRS = ["HSK/USDT", "ETH/USDT"] as const;
export const VENUE_IDS = ["hashkey-global", "gate", "kucoin", "mexc", "binance", "okx"] as const;

export type Pair = (typeof PAIRS)[number];
export type VenueId = (typeof VENUE_IDS)[number];
export type Side = "buy" | "sell";

const pair = z.enum(PAIRS);
const venue = z.enum(VENUE_IDS);
const fraction = z.number().min(0).max(1);
const perPair = <T extends z.ZodType>(value: T) => z.record(pair, value);

const tier = z.object({
  ttlSec: z.number().int().positive(),
  sizeCap: z.number().gt(0).max(1),
  sigmaAdd: z.number().min(0),
});

export const paramsSchema = z
  .looseObject({
    pairs: z.array(pair).min(1),
    pools: z.array(z.never()).default([]),
    spread: z.object({
      base: perPair(z.number().positive().max(1)),
      kSigma: z.number().min(0),
      kInventory: z.number().min(0),
      min: fraction,
      max: fraction,
      degradedAdd: fraction,
    }),
    quote: z.object({
      ttlSec: z.number().int().positive(),
      minTtlSec: z.number().int().positive(),
      maxTtlSec: z.number().int().positive().max(120),
      ttlVolK: z.number().positive(),
      minNotionalUsd: z.number().positive(),
      maxNotionalUsd: perPair(z.number().positive()),
      rateLimitPerMin: z.number().int().positive(),
    }),
    feeds: z.object({
      pollMs: z.number().int().min(500),
      timeoutMs: z.number().int().positive(),
      staleMs: z.number().int().positive(),
      maxDisagreement: fraction,
      minSources: z.number().int().positive(),
      bookLevels: z.number().int().positive(),
      sources: perPair(z.array(venue).min(1)),
      tapeSource: perPair(venue),
    }),
    inventory: z.object({ targetShare: fraction, minShare: fraction, maxShare: fraction }),
    arena: z.object({
      initialUsdPerSide: z.number().positive(),
      tapeCaptureRate: fraction.default(0.05),
      tapeSizeScale: z.number().positive().max(1).default(0.2),
      tapeMaxNotionalUsd: z.number().positive().default(2000),
      tapeLatencyMs: z
        .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
        .default([200, 1500]),
      pnlTickMs: z.number().int().min(1000).default(2000),
      gasUnits: z.number().int().nonnegative().default(150000),
    }),
    agent: z
      .object({ tickMs: z.number().int().min(1000), cooldownMs: z.number().int().positive() })
      .default({ tickMs: 2000, cooldownMs: 15000 }),
    risk: z.object({
      maxDrawdownPct: fraction,
      feedOutagePauseSec: z.number().positive(),
      markoutAlarm: z.number().negative(),
    }),
    tuner: z.object({
      windowFills: z.number().int().positive(),
      widenBelow: z.number(),
      narrowAbove: z.number(),
      step: z.number().positive(),
    }),
    heartbeat: z.object({ idleStopMs: z.number().int().positive() }),
    toxicity: z.object({
      minFills: z.number().int().positive(),
      priorScore: fraction,
      halfLifeFills: z.number().positive(),
      weights: z.object({
        markout: fraction,
        adverse: fraction,
        lateness: fraction,
        selectivity: fraction,
      }),
      tiers: z.object({
        probation: tier,
        normal: tier,
        watch: tier.extend({ enter: fraction, exit: fraction }),
        toxic: tier.extend({ enter: fraction, exit: fraction }),
        blocked: z.object({ enter: fraction, exit: fraction }),
      }),
    }),
  })
  .superRefine((p, ctx) => {
    const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Set(p.pairs).size !== p.pairs.length) invalid("Pairs must be unique");
    if (p.spread.min > p.spread.max || p.spread.max >= 1) invalid("Invalid spread bounds");
    if (
      !(
        p.inventory.minShare < p.inventory.targetShare &&
        p.inventory.targetShare < p.inventory.maxShare
      )
    )
      invalid("Invalid inventory bounds");
    if (p.quote.minTtlSec > p.quote.ttlSec || p.quote.ttlSec > p.quote.maxTtlSec)
      invalid("Invalid TTL bounds");
    if (p.arena.tapeLatencyMs[0] > p.arena.tapeLatencyMs[1]) invalid("Invalid tape latency bounds");
    if (p.feeds.sources["HSK/USDT"].some((v) => v === "binance" || v === "okx"))
      invalid("HSK is not listed on Binance or OKX");
    for (const pair of p.pairs) {
      if (!p.feeds.sources[pair].includes(p.feeds.tapeSource[pair]))
        invalid("Tape source must be an enabled feed");
    }
    const t = p.toxicity;
    if (Math.abs(Object.values(t.weights).reduce((a, b) => a + b, 0) - 1) > 1e-8)
      invalid("Toxicity weights must sum to one");
    if (!(t.tiers.watch.enter < t.tiers.toxic.enter && t.tiers.toxic.enter < t.tiers.blocked.enter))
      invalid("Tier thresholds must increase");
    for (const name of ["watch", "toxic", "blocked"] as const) {
      if (t.tiers[name].exit >= t.tiers[name].enter) invalid("Tier exit must be below entry");
    }
  });

export type Params = z.infer<typeof paramsSchema>;
export type Tier = z.infer<typeof tier>;
export type TierName = "probation" | "normal" | "watch" | "toxic" | "blocked";

export const defaultParams: Params = paramsSchema.parse(raw);
