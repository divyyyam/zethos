import { units } from "../tokens";
import { pairTokens } from "./market";
import type { EngineState } from "./state";

export interface BucketCompliance {
  maxNotionalUsd: number;
  /** Mean signed half-spread against the fused mid at quote time, in bps. */
  observedAvgHalfSpreadBps: number | null;
  /** Widest signed half-spread in the bucket, in bps. */
  observedMaxHalfSpreadBps: number | null;
  /** True when every signed quote in the bucket was within the mandate cap. Null with no quotes. */
  compliant: boolean | null;
  quotes: number;
}

export interface DeskCompliance {
  /** Not measured yet: the engine has no uptime ledger. Never substituted with tape capture. */
  observedUptimePct: null;
  /** Not reported here; the Desk derives epoch loss from /arena. */
  observedOperatingLossUsd: null;
  sizeBucketCompliance: BucketCompliance[];
  epoch: number | null;
}

/**
 * Measured spread compliance per mandate size bucket over the current epoch's signed quotes.
 * Uses the execution layer's own measure: signed price against the fused mid at quote time.
 */
export async function deskCompliance(context: EngineState): Promise<DeskCompliance> {
  const epoch = context.arena?.epoch ?? null;
  const records = epoch === null ? [] : await context.deps.store.loadQuotes(epoch);
  const buckets = [...context.mandate.service.maxHalfSpreadBps].sort(
    (a, b) => a.maxNotionalUsd - b.maxNotionalUsd,
  );
  const acc = buckets.map(() => ({ count: 0, sum: 0, max: Number.NEGATIVE_INFINITY }));

  for (const record of records) {
    const mid = (record.breakdown as { mid?: unknown } | null)?.mid;
    if (typeof mid !== "number" || !(mid > 0)) continue;
    const { base, quote } = pairTokens(context, record.pair);
    const amountIn = BigInt(record.quote.amountIn);
    const amountOut = BigInt(record.quote.amountOut);
    const buy = record.side === "buy";
    const baseQty = units(buy ? amountOut : amountIn, base.decimals);
    const quoteQty = units(buy ? amountIn : amountOut, quote.decimals);
    if (!(baseQty > 0) || !(quoteQty > 0)) continue;
    const price = quoteQty / baseQty;
    const notional = buy ? quoteQty : baseQty * mid;
    const index = buckets.findIndex((bucket) => notional <= bucket.maxNotionalUsd);
    const slot = acc[index];
    if (index < 0 || !slot) continue;
    const bps = (buy ? price / mid - 1 : 1 - price / mid) * 10_000;
    slot.count += 1;
    slot.sum += bps;
    slot.max = Math.max(slot.max, bps);
  }

  return {
    observedUptimePct: null,
    observedOperatingLossUsd: null,
    epoch,
    sizeBucketCompliance: buckets.map((bucket, i) => {
      const slot = acc[i] ?? { count: 0, sum: 0, max: Number.NEGATIVE_INFINITY };
      const has = slot.count > 0;
      return {
        maxNotionalUsd: bucket.maxNotionalUsd,
        observedAvgHalfSpreadBps: has ? slot.sum / slot.count : null,
        observedMaxHalfSpreadBps: has ? slot.max : null,
        // A tiny tolerance absorbs float rounding of the raw integer amounts.
        compliant: has ? slot.max <= bucket.maxBps + 1e-6 : null,
        quotes: slot.count,
      };
    }),
  };
}
