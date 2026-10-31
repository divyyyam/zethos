import type { Hex } from "viem";
import {
  canonicalPolicyBody,
  hashPolicyBody,
  type PolicyBody,
  type PolicySpec,
  policyBodySchema,
  policyDateSchema,
  policySpecSchema,
} from "./schema";

function validatedBody(input: unknown): PolicyBody {
  if (input !== null && typeof input === "object" && "id" in input) {
    const { id: _id, ...body } = policySpecSchema.parse(input);
    return body;
  }
  return policyBodySchema.parse(input);
}

/** Canonical UTF-8 JSON includes every validated body field, with array order preserved. */
export function canonicalPolicySpec(input: unknown): string {
  return canonicalPolicyBody(validatedBody(input));
}

export function hashPolicySpec(input: unknown): Hex {
  return hashPolicyBody(validatedBody(input));
}

/** The caller supplies the UTC date explicitly; identity creation never reads the clock. */
export function createPolicySpec(body: unknown, date: string): PolicySpec {
  const parsed = policyBodySchema.parse(body);
  const datePart = policyDateSchema.parse(date);
  return policySpecSchema.parse({
    ...parsed,
    id: `p-${datePart}-${hashPolicyBody(parsed).slice(2, 10)}`,
  });
}
