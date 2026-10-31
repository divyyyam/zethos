import { type Hex, keccak256, stringToHex } from "viem";
import { z } from "zod";
import { PAIRS, VENUE_IDS } from "../config";

const finite = () => z.number().finite();
const bounded = (min: number, max: number) => finite().min(min).max(max);
const emptyParams = z.strictObject({});
const pairSchema = z.enum(PAIRS);
const venueSchema = z.enum(VENUE_IDS);

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const policyReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("median"), params: emptyParams }),
  z.strictObject({ kind: z.literal("depthWeighted"), params: emptyParams }),
  z.strictObject({
    kind: z.literal("leadWeighted"),
    params: z.strictObject({
      leadVenues: z.array(venueSchema).min(1).refine(unique, "Lead venues must be unique"),
      leadWeight: bounded(0, 0.9),
      lookbackSec: bounded(1, 60),
    }),
  }),
]);

export const policyTermSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("base"),
    params: z.strictObject({ bps: z.partialRecord(pairSchema, bounded(1, 100)) }),
  }),
  z.strictObject({ kind: z.literal("vol"), params: z.strictObject({ k: bounded(0, 5) }) }),
  z.strictObject({ kind: z.literal("inventory"), params: z.strictObject({ k: bounded(0, 0.01) }) }),
  z.strictObject({ kind: z.literal("toxicity"), params: z.strictObject({ scale: bounded(0, 2) }) }),
  z.strictObject({
    kind: z.literal("depthWithdrawal"),
    params: z.strictObject({
      dropPct: bounded(0.1, 0.9),
      windowSec: bounded(1, 30),
      addBps: bounded(0, 100),
    }),
  }),
  z.strictObject({
    kind: z.literal("leadMove"),
    params: z.strictObject({
      thresholdBps: bounded(1, 100),
      windowSec: bounded(1, 30),
      addBps: bounded(0, 100),
    }),
  }),
  z.strictObject({ kind: z.literal("restoreCost"), params: z.strictObject({ k: bounded(0, 2) }) }),
  z.strictObject({
    kind: z.literal("sizeCurve"),
    params: z.strictObject({ exponent: bounded(0.5, 2), kBps: bounded(0, 50) }),
  }),
  z.strictObject({ kind: z.literal("tuner"), params: emptyParams }),
]);

const bodyObjectSchema = z.strictObject({
  parent: z.union([z.literal("v0"), z.string().regex(/^p-\d{8}-[0-9a-f]{8}$/)]),
  hypothesis: z.string().max(500),
  pairs: z.array(pairSchema).min(1).max(PAIRS.length),
  reference: policyReferenceSchema,
  terms: z.array(policyTermSchema).min(1).max(9),
  clamp: z.strictObject({ minBps: finite().gt(0).lt(10_000), maxBps: finite().gt(0).lt(10_000) }),
  ttl: z.strictObject({
    kind: z.literal("volScaled"),
    ttlVolK: finite().positive(),
    minSec: bounded(1, 120).int(),
    maxSec: bounded(1, 120).int(),
  }),
  rejectIf: z
    .strictObject({
      maxSigma1: finite().nonnegative().optional(),
      minSources: bounded(1, 6).int().optional(),
      leadDivergenceBps: finite().positive().optional(),
    })
    .optional(),
});

export type PolicyBody = z.infer<typeof bodyObjectSchema>;
export type PolicyReference = z.infer<typeof policyReferenceSchema>;
export type PolicyTerm = z.infer<typeof policyTermSchema>;

/** Gregorian UTC calendar date, independent of the local timezone and Date's year-1900 shortcut. */
function isPolicyDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    year >= 1 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const policyDateSchema = z.string().refine(isPolicyDate, "Expected a UTC yyyymmdd date");
const policyIdSchema = z
  .string()
  .regex(/^p-\d{8}-[0-9a-f]{8}$/)
  .refine((value) => isPolicyDate(value.slice(2, 10)), "Policy ID has an invalid UTC date");

function refineBody(body: PolicyBody, context: z.RefinementCtx): void {
  if (body.parent !== "v0" && !policyIdSchema.safeParse(body.parent).success) {
    context.addIssue({ code: "custom", path: ["parent"], message: "Invalid parent policy ID" });
  }
  if (!unique(body.pairs)) {
    context.addIssue({ code: "custom", path: ["pairs"], message: "Pairs must be unique" });
  }
  if (!unique(body.terms.map((term) => term.kind))) {
    context.addIssue({ code: "custom", path: ["terms"], message: "Term kinds must be unique" });
  }
  for (const [index, term] of body.terms.entries()) {
    if (term.kind === "tuner" && index !== body.terms.length - 1) {
      context.addIssue({ code: "custom", path: ["terms", index], message: "Tuner must be last" });
    }
    if (
      term.kind === "base" &&
      (Object.keys(term.params.bps).length !== body.pairs.length ||
        body.pairs.some((pair) => term.params.bps[pair] === undefined))
    ) {
      context.addIssue({
        code: "custom",
        path: ["terms", index, "params", "bps"],
        message: "Base bps must contain exactly the declared pairs",
      });
    }
  }
  if (body.clamp.minBps > body.clamp.maxBps) {
    context.addIssue({ code: "custom", path: ["clamp"], message: "minBps must not exceed maxBps" });
  }
  if (body.ttl.minSec > body.ttl.maxSec) {
    context.addIssue({ code: "custom", path: ["ttl"], message: "minSec must not exceed maxSec" });
  }
}

export const policyBodySchema = bodyObjectSchema.superRefine(refineBody);

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

/** Internal validated-body primitive shared with canonical.ts to avoid an import cycle. */
export function canonicalPolicyBody(body: PolicyBody): string {
  return JSON.stringify(sortJson(body));
}

/** Internal validated-body primitive. Identity always hashes the body without its ID. */
export function hashPolicyBody(body: PolicyBody): Hex {
  return keccak256(stringToHex(canonicalPolicyBody(body)));
}

export const policySpecSchema = bodyObjectSchema
  .extend({ id: policyIdSchema })
  .superRefine((spec, context) => {
    refineBody(spec, context);
    const { id, ...body } = spec;
    if (spec.parent === id) {
      context.addIssue({
        code: "custom",
        path: ["parent"],
        message: "Policy cannot parent itself",
      });
    }
    if (id.slice(-8) !== hashPolicyBody(body).slice(2, 10)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Policy ID does not match content",
      });
    }
  });

export type PolicySpec = z.infer<typeof policySpecSchema>;
