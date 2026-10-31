import { z } from "zod";

export const PAIRS = ["HSK/USDT", "ETH/USDT"] as const;
export type Pair = (typeof PAIRS)[number];

export const VENUE_IDS = ["hashkey-global", "gate", "kucoin", "mexc", "binance", "okx"] as const;
export type VenueId = (typeof VENUE_IDS)[number];

export const SNIPER_MODES = ["naive", "sniper", "latecomer", "rotating", "capture-only"] as const;
export type SniperMode = (typeof SNIPER_MODES)[number];

export const TAKER_TIERS = [
  "normal",
  "toxic",
  "internal",
  "watch",
  "blocked",
  "probation",
] as const;
export type TakerTier = (typeof TAKER_TIERS)[number];

const addressRegex = /^0x[0-9a-fA-F]{40}$/;
const uint256Regex = /^[1-9]\d*$/;
const UINT256_MAX = 2n ** 256n - 1n;

export const levelSchema = z.tuple([z.number().positive(), z.number().positive()]);
export type Level = readonly [price: number, size: number];

export const bookSchema = z.strictObject({
  bids: z.array(levelSchema).min(1),
  asks: z.array(levelSchema).min(1),
});
export type Book = z.infer<typeof bookSchema>;

export const scenarioBookRecordSchema = z.strictObject({
  type: z.literal("book"),
  ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pair: z.enum(PAIRS),
  venue: z.enum(VENUE_IDS),
  book: bookSchema,
});
export type ScenarioBookRecord = z.infer<typeof scenarioBookRecordSchema>;

export const scenarioTradeRecordSchema = z.strictObject({
  type: z.literal("trade"),
  ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pair: z.enum(PAIRS),
  venue: z.enum(VENUE_IDS),
  trade: z.strictObject({
    id: z.string().min(1),
    ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    side: z.enum(["buy", "sell"]),
    price: z.number().positive(),
    size: z.number().positive(),
  }),
});
export type ScenarioTradeRecord = z.infer<typeof scenarioTradeRecordSchema>;

export const scenarioTakerRequestRecordSchema = z.strictObject({
  type: z.literal("taker_request"),
  ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pair: z.enum(PAIRS),
  side: z.enum(["buy", "sell"]),
  amountIn: z
    .string()
    .regex(uint256Regex, "amountIn must be a positive base-10 integer string")
    .refine((val) => {
      try {
        const n = BigInt(val);
        return n > 0n && n <= UINT256_MAX;
      } catch {
        return false;
      }
    }, "amountIn must be positive and within uint256 max"),
  taker: z.string().regex(addressRegex, "invalid taker address"),
  id: z.string().min(1).optional(),
  tier: z.enum(TAKER_TIERS).optional(),
  score: z.number().finite().min(0).max(1).optional(),
});
export type ScenarioTakerRequestRecord = z.infer<typeof scenarioTakerRequestRecordSchema>;

export const scenarioRecordSchema = z.discriminatedUnion("type", [
  scenarioBookRecordSchema,
  scenarioTradeRecordSchema,
  scenarioTakerRequestRecordSchema,
]);
export type ScenarioRecord = z.infer<typeof scenarioRecordSchema>;

export const scenarioManifestSchema = z
  .strictObject({
    name: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/, "Scenario name must be alphanumeric with underscores or dashes"),
    source: z.string().min(1),
    pair: z.enum(PAIRS),
    recordedAt: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    heldOut: z.boolean(),
    description: z.string(),
    devWindow: z
      .strictObject({
        fromTs: z.number().int().nonnegative(),
        toTs: z.number().int().nonnegative(),
      })
      .optional(),
    heldOutWindow: z
      .strictObject({
        fromTs: z.number().int().nonnegative(),
        toTs: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .refine(
    (m) => {
      if (m.devWindow && m.devWindow.fromTs > m.devWindow.toTs) return false;
      if (m.heldOutWindow && m.heldOutWindow.fromTs > m.heldOutWindow.toTs) return false;
      if (m.devWindow && m.heldOutWindow) {
        const overlap =
          Math.max(m.devWindow.fromTs, m.heldOutWindow.fromTs) <=
          Math.min(m.devWindow.toTs, m.heldOutWindow.toTs);
        if (overlap) return false;
      }
      return true;
    },
    { message: "Scenario windows must be ordered and non-overlapping" },
  );
export type ScenarioManifest = z.infer<typeof scenarioManifestSchema>;

export interface ScenarioRecorderOptions {
  name: string;
  source?: string;
  pair: Pair;
  heldOut?: boolean;
  description?: string;
  scenariosDir?: string;
  maxBufferSize?: number;
  flushIntervalMs?: number;
  recordedAt?: number | string;
}

export interface ScenarioRecordCounts {
  total: number;
  books: number;
  trades: number;
  takerRequests: number;
}

export interface ScenarioRecordSummary {
  name: string;
  manifestPath: string;
  payloadPath: string;
  counts: ScenarioRecordCounts;
  timeRange: { fromTs: number; toTs: number } | null;
  heldOut: boolean;
}
