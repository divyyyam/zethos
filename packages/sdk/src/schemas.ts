import { type Address, type Hex, isAddress, isHex } from "viem";
import { z } from "zod";

const UINT_PATTERN = /^\d{1,78}$/;

export const uint = (bits: 64 | 256) =>
  z
    .string()
    .refine(
      (value) => UINT_PATTERN.test(value) && BigInt(value) < 1n << BigInt(bits),
      `Expected a uint${bits} base-10 string`,
    )
    .transform((value) => BigInt(value).toString());

export const address = z.custom<Address>(
  (value) => typeof value === "string" && isAddress(value),
  "Expected an address",
);

export const hex = z.custom<Hex>(
  (value) => typeof value === "string" && isHex(value),
  "Expected 0x-prefixed hex",
);

export const txHash = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x[\da-fA-F]{64}$/.test(value),
  "Expected a transaction hash",
);

const num = z.number();

export const pair = z.enum(["HSK/USDT", "ETH/USDT"]);
export const side = z.enum(["buy", "sell"]);
export const tier = z.enum(["probation", "normal", "watch", "toxic", "blocked"]);
export const health = z.enum(["ok", "degraded", "down"]);
export const riskState = z.enum(["normal", "degraded", "paused"]);
export const flow = z.enum(["tape", "user", "agent", "attacker"]);

export const signedQuote = z.object({
  taker: address,
  tokenIn: address,
  tokenOut: address,
  amountIn: uint(256),
  amountOut: uint(256),
  nonce: uint(256),
  issuedAt: uint(64),
  expiry: uint(64),
});

export const source = z.object({
  venue: z.string(),
  mid: num,
  weight: num,
  status: z.enum(["ok", "stale", "outlier", "down"]),
});

export const priceBreakdown = z.object({
  mid: num,
  ref: num,
  sources: z.array(source),
  base: num,
  vol: num,
  inventory: num,
  toxicity: num,
  degraded: num,
  tuner: num,
  half: num,
  sigmaT: num,
  ttlSec: num,
  tier,
});

export const paperQuote = z.object({
  route: z.literal("paper"),
  id: z.string(),
  quote: signedQuote,
  signature: hex,
  paperOut: uint(256),
  poolOut: uint(256).nullable(),
  poolVenue: z.string().nullable(),
  spotOut: uint(256),
  savingVsPoolPct: num.nullable(),
  vsMidBps: num,
  expiresAt: num,
  breakdown: priceBreakdown,
});

export const vaultQuote = z.object({
  route: z.literal("conduit"),
  id: z.string(),
  quote: signedQuote,
  signature: hex,
  conduitOut: uint(256),
  hskswapOut: uint(256),
  spotOut: uint(256),
  savingPct: num,
  expiresAt: num,
  breakdown: priceBreakdown,
});

export const poolQuote = z.object({
  route: z.literal("hskswap"),
  hskswapOut: uint(256),
  venue: z.string(),
  reason: z.string(),
});

export const quoteResponse = z.discriminatedUnion("route", [paperQuote, vaultQuote, poolQuote]);

export const quoteRequest = z.object({
  taker: address,
  tokenIn: address,
  tokenOut: address,
  amountIn: uint(256),
});

const token = z.object({
  symbol: z.string(),
  address,
  decimals: z.int().min(0).max(255),
});

export const pairStatus = z.object({
  pair,
  base: token,
  quote: token,
  mid: num.nullable(),
  health,
  halted: z.boolean(),
  sources: z.array(source),
  halfSpread: z.object({ buy: num, sell: num }).nullable(),
  updatedAt: num.nullable(),
});

export const status = z.object({
  mode: z.enum(["shadow", "live"]),
  dataSource: z.enum(["live", "replay"]).optional(),
  chainId: z.union([z.literal(177), z.literal(133)]),
  signer: address,
  operator: address.nullable().optional(),
  verifyingContract: address,
  paused: z.boolean(),
  riskState,
  pairs: z.array(pairStatus),
  inventory: z.record(z.string(), uint(256)),
  equityUsd: num.nullable(),
});

export const fill = z.object({
  id: z.string(),
  quoteId: z.string(),
  ts: num,
  taker: address,
  pair,
  side,
  tokenIn: address,
  tokenOut: address,
  amountIn: uint(256),
  amountOut: uint(256),
  price: num,
  midAtFill: num.nullable(),
  flow,
  paper: z.boolean(),
  txHash: txHash.nullable().default(null),
  markouts: z.record(z.string(), num).optional(),
  epoch: num.optional(),
});

export const decision = z.object({
  id: z.string(),
  ts: num,
  type: z.string(),
  pair: pair.nullable(),
  taker: address.nullable(),
  reason: z.string(),
  inputs: z.record(z.string(), z.union([num, z.string()])),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  narration: z.string().nullable(),
});

export const takerRow = z.object({
  address,
  label: z.string().nullable(),
  tier,
  score: num,
  signals: z.object({ markout: num, adverse: num, lateness: num, selectivity: num }),
  fills: num,
  pnlUsd: num,
  detectedAfter: z.object({ fills: num, seconds: num }).nullable(),
  preDetectionLossPerFillUsd: num.nullable().optional(),
  postDetectionLossPerFillUsd: num.nullable().optional(),
  estimatedLossAvoidedUsd: num.optional(),
  postDetectionAttempts: num.optional(),
});

const byFlow = z.object({ tape: num, user: num, agent: num, attacker: num });

export const arena = z.object({
  epoch: num,
  startedAt: num,
  equityUsd: num,
  valuationStale: z.boolean().optional(),
  unpricedFills: num.optional(),
  pnl: z.object({ total: num, spread: num, inventory: num, arb: num, gas: num }),
  byFlow,
  series: z.array(z.object({ t: num, equity: num, byFlow })),
  fills: num,
  volumeUsd: num,
  takers: num,
  tapeCaptureRate: num.nullable(),
});

export const arenaSummary = arena.omit({ series: true });

export const stats = z.object({
  series: z.array(z.object({ t: num, mid: num, sources: z.record(z.string(), num).optional() })),
  venues: z.array(z.object({ venue: z.string(), depthUsd: num })),
  summary: z.object({ fills: num, volumeUsd: num, spreadCaptureUsd: num }).optional(),
});

export const chatResponse = z.object({
  reply: z.string(),
  cards: z.array(z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) })),
});

export const errorBody = z.object({ error: z.string(), message: z.string().optional() });

export const streamFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("price"), pair, mid: num.nullable(), health, ts: num }),
  z.object({ type: z.literal("fill"), fill }),
  z.object({ type: z.literal("decision"), decision }),
  z.object({ type: z.literal("risk"), paused: z.boolean(), riskState, halted: z.array(pair) }),
  z.object({ type: z.literal("arena"), arena: arenaSummary }),
  z.object({ type: z.literal("takerTier"), address, tier, score: num }),
  z.object({ type: z.literal("params"), ts: num, changed: z.array(z.string()) }),
]);

/** Accepts both a bare array and `{ [key]: array }`. */
export const listOf = <T extends z.ZodType>(item: T, key: string) =>
  z
    .union([z.array(item), z.object({ [key]: z.array(item) })])
    .transform((value) => (Array.isArray(value) ? value : (value[key] as z.output<T>[])));
