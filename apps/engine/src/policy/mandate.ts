import { z } from "zod";
import raw from "../../mandate.json";
import { PAIRS } from "../config";

const fraction = z.number().finite().min(0).max(1);
const positiveFraction = z.number().finite().gt(0).max(1);
const positiveAmount = z.number().finite().positive();

/** The owner's limits, checked independently of any policy's quote decision. */
export const mandateSchema = z
  .strictObject({
    pairs: z.array(z.enum(PAIRS)).min(1),
    inventory: z.strictObject({ minShare: fraction, maxShare: fraction }),
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
    loss: z.strictObject({ maxOperatingLossUsd: positiveAmount }),
    canary: z.strictObject({
      maxAllocationPct: z.number().finite().min(1).max(100),
      minFillsBeforePromote: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      retireDrawdownPct: positiveFraction,
      retireFillRateDrop: positiveFraction,
    }),
    qualification: z.strictObject({
      mustBeatHeldOut: z.literal(true),
      maxDrawdownDeltaPct: fraction,
      honestFillTolerance: fraction,
      minHonestFillRate: fraction,
      maxRejectRate: fraction,
    }),
  })
  .superRefine((mandate, ctx) => {
    if (new Set(mandate.pairs).size !== mandate.pairs.length) {
      ctx.addIssue({ code: "custom", path: ["pairs"], message: "Pairs must be unique" });
    }
    if (mandate.inventory.minShare >= mandate.inventory.maxShare) {
      ctx.addIssue({
        code: "custom",
        path: ["inventory", "maxShare"],
        message: "Inventory maxShare must exceed minShare",
      });
    }
    const buckets = mandate.service.maxHalfSpreadBps;
    for (let index = 1; index < buckets.length; index++) {
      const previous = buckets[index - 1];
      const current = buckets[index];
      if (previous && current && current.maxNotionalUsd <= previous.maxNotionalUsd) {
        ctx.addIssue({
          code: "custom",
          path: ["service", "maxHalfSpreadBps", index, "maxNotionalUsd"],
          message: "Size buckets must have unique, increasing maxNotionalUsd values",
        });
      }
    }
    const largestBucket = buckets.at(-1);
    if (largestBucket && mandate.service.minQuoteNotionalUsd > largestBucket.maxNotionalUsd) {
      ctx.addIssue({
        code: "custom",
        path: ["service", "minQuoteNotionalUsd"],
        message: "Minimum quote notional must fit within the largest size bucket",
      });
    }
  });

export type Mandate = z.infer<typeof mandateSchema>;

export function loadMandate(input: unknown): Mandate {
  const parsed = mandateSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid desk mandate: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export const defaultMandate: Mandate = loadMandate(raw);
