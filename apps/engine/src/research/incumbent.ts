import { defaultParams, type Params } from "../config";
import { createPolicySpec } from "./canonical";
import type { PolicySpec } from "./schema";

/** A declarative equivalent of v0, identified with an explicit reproducible UTC date. */
export function createV0Spec(date: string, params: Params = defaultParams): PolicySpec {
  return createPolicySpec(
    {
      parent: "v0",
      hypothesis:
        "Incumbent depth-weighted pricing with volatility, inventory, toxicity and live tuning.",
      pairs: [...params.pairs],
      reference: { kind: "depthWeighted", params: {} },
      terms: [
        {
          kind: "base",
          params: {
            bps: Object.fromEntries(
              params.pairs.map((pair) => [pair, params.spread.base[pair] * 10000]),
            ),
          },
        },
        { kind: "vol", params: { k: params.spread.kSigma } },
        { kind: "inventory", params: { k: params.spread.kInventory } },
        { kind: "toxicity", params: { scale: 1 } },
        { kind: "tuner", params: {} },
      ],
      clamp: { minBps: params.spread.min * 10000, maxBps: params.spread.max * 10000 },
      ttl: {
        kind: "volScaled",
        ttlVolK: params.quote.ttlVolK,
        minSec: params.quote.minTtlSec,
        maxSec: params.quote.maxTtlSec,
      },
    },
    date,
  );
}
