import { formatUnits } from "viem";
import { z } from "zod";
import { sampleMandate } from "../../content/desk.mock";
import { platformConfig } from "../platform-config";
import { engineRequest } from "./client";

const fraction = z.number().finite().min(0).max(1);
const positiveAmount = z.number().finite().positive();

export const mandateSchema = z.strictObject({
  pairs: z.array(z.string()).min(1),
  inventory: z.strictObject({
    minShare: fraction,
    maxShare: fraction,
  }),
  service: z.strictObject({
    maxHalfSpreadBps: z
      .array(
        z.strictObject({
          maxNotionalUsd: positiveAmount,
          maxBps: z.number().finite().positive().lt(10000),
        }),
      )
      .min(1),
    minQuoteNotionalUsd: positiveAmount,
    uptimeTargetPct: z.number().finite().min(0).max(100),
  }),
  loss: z.strictObject({
    maxOperatingLossUsd: positiveAmount,
  }),
  canary: z.strictObject({
    maxAllocationPct: z.number().finite().min(1).max(100),
    minFillsBeforePromote: z.number().int().positive(),
    retireDrawdownPct: fraction,
    retireFillRateDrop: fraction,
  }),
  qualification: z.strictObject({
    mustBeatHeldOut: z.literal(true),
    maxDrawdownDeltaPct: fraction,
    honestFillTolerance: fraction,
    minHonestFillRate: fraction,
    maxRejectRate: fraction,
  }),
});

export type Mandate = z.infer<typeof mandateSchema>;

export const deskComplianceSchema = z
  .strictObject({
    /** Backend-measured uptime percentage (0-100), distinct from tape capture rate. */
    observedUptimePct: z.number().finite().min(0).max(100).nullable().optional(),
    /** Backend-measured epoch operating loss in USD. */
    observedOperatingLossUsd: z.number().finite().nullable().optional(),
    /** Observed spread compliance per size bucket. */
    sizeBucketCompliance: z
      .array(
        z.strictObject({
          maxNotionalUsd: z.number().finite().positive(),
          observedAvgHalfSpreadBps: z.number().finite().nullable().optional(),
          observedMaxHalfSpreadBps: z.number().finite().nullable().optional(),
          compliant: z.boolean().nullable().optional(),
          /** Signed quotes measured in this bucket over the current epoch. */
          quotes: z.number().int().nonnegative().optional(),
        }),
      )
      .optional(),
    epoch: z.number().int().nullable().optional(),
  })
  .optional();

export type DeskCompliance = z.infer<typeof deskComplianceSchema>;

export interface ObservedPairInventory {
  pair: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseUnits: number;
  quoteUnits: number;
  baseUsd: number | null;
  quoteUsd: number;
  baseShare: number | null; // fraction 0..1
  mid: number | null;
}

/** Formats a 0..1 fractional value into a percentage string (e.g. 0.15 -> "15.0%"). */
export function formatFractionAsPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Formats a 0..100 percentage value into a percentage string (e.g. 99 -> "99.0%"). */
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  return `${value.toFixed(digits)}%`;
}

/** Formats currency with "Unavailable" fallback. */
export function formatUsdOrUnavailable(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Computes observed inventory shares using runtime token metadata from pairs and inventory balances.
 * USDT backing is distributed equally across all active pairs, matching engine inventory accounting.
 */
export function computeObservedInventoryShares(
  pairs: Array<{
    pair: string;
    mid: number | null;
    base: { symbol: string; decimals: number; address: string };
    quote: { symbol: string; decimals: number; address: string };
  }>,
  inventory: Record<string, string>,
): ObservedPairInventory[] {
  if (!pairs || pairs.length === 0 || !inventory) return [];

  return pairs.map((pair) => {
    const baseRaw =
      inventory[pair.base.symbol] ??
      inventory[pair.base.address.toLowerCase()] ??
      inventory[pair.base.address] ??
      "0";
    const quoteRaw =
      inventory[pair.quote.symbol] ??
      inventory[pair.quote.address.toLowerCase()] ??
      inventory[pair.quote.address] ??
      "0";

    const baseUnits = Number(formatUnits(BigInt(baseRaw), pair.base.decimals));
    const quoteUnits = Number(formatUnits(BigInt(quoteRaw), pair.quote.decimals));
    const baseUsd = pair.mid !== null ? baseUnits * pair.mid : null;
    // USDT is shared across pairs
    const pairQuoteUsd = quoteUnits / (pairs.length || 1);

    let baseShare: number | null = null;
    if (baseUsd !== null && Number.isFinite(baseUsd)) {
      const totalSideUsd = baseUsd + pairQuoteUsd;
      if (totalSideUsd > 0) {
        baseShare = Math.max(0, Math.min(1, baseUsd / totalSideUsd));
      }
    }

    return {
      pair: pair.pair,
      baseSymbol: pair.base.symbol,
      quoteSymbol: pair.quote.symbol,
      baseUnits,
      quoteUnits,
      baseUsd,
      quoteUsd: pairQuoteUsd,
      baseShare,
      mid: pair.mid,
    };
  });
}

/**
 * Reads the desk mandate from the engine.
 * When NEXT_PUBLIC_ENGINE_URL is unconfigured, returns the validated sample mandate.
 * When NEXT_PUBLIC_ENGINE_URL is configured, fetches from /mandate and never falls back to sample data.
 */
/**
 * Measured spread compliance per size bucket (GET /desk/compliance). With no engine configured
 * there is nothing measured, so this returns undefined and the Desk shows targets only.
 */
export async function fetchCompliance(): Promise<DeskCompliance> {
  if (!platformConfig.engineUrl) return undefined;
  return deskComplianceSchema.parse(await engineRequest("/desk/compliance"));
}

export async function fetchMandate(): Promise<Mandate> {
  if (!platformConfig.engineUrl) {
    return mandateSchema.parse(sampleMandate);
  }

  const rawData = await engineRequest("/mandate");
  return mandateSchema.parse(rawData);
}
