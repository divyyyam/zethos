import { describe, expect, test } from "bun:test";
import { keccak256, stringToHex } from "viem";
import { canonicalPolicySpec, createPolicySpec, hashPolicySpec } from "../src/research/canonical";
import { type PolicyBody, policyBodySchema, policySpecSchema } from "../src/research/schema";

function body(): PolicyBody {
  return {
    parent: "v0",
    hypothesis: "Protect against a lead venue moving before the fused reference.",
    pairs: ["HSK/USDT", "ETH/USDT"],
    reference: {
      kind: "leadWeighted",
      params: { leadVenues: ["gate", "kucoin"], leadWeight: 0.5, lookbackSec: 10 },
    },
    terms: [
      { kind: "base", params: { bps: { "HSK/USDT": 20, "ETH/USDT": 10 } } },
      { kind: "vol", params: { k: 2 } },
      { kind: "inventory", params: { k: 0.0015 } },
      { kind: "toxicity", params: { scale: 1 } },
      { kind: "depthWithdrawal", params: { dropPct: 0.5, windowSec: 10, addBps: 5 } },
      { kind: "leadMove", params: { thresholdBps: 10, windowSec: 10, addBps: 5 } },
      { kind: "restoreCost", params: { k: 1 } },
      { kind: "sizeCurve", params: { exponent: 1, kBps: 10 } },
      { kind: "tuner", params: {} },
    ],
    clamp: { minBps: 5, maxBps: 300 },
    ttl: { kind: "volScaled", ttlVolK: 100, minSec: 1, maxSec: 120 },
    rejectIf: { maxSigma1: 0.01, minSources: 2, leadDivergenceBps: 50 },
  };
}

function setPath(value: unknown, path: string, replacement: unknown): unknown {
  const copy = structuredClone(value);
  const keys = path.split(".");
  let current = copy as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) current = current[key] as Record<string, unknown>;
  current[keys.at(-1) as string] = replacement;
  return copy;
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseKeys(entry)]),
    );
  }
  return value;
}

describe("PolicySpec bounds", () => {
  // Every inclusive bound in S2, including reference and rejection parameters.
  const bounds: [string, number, number][] = [
    ["terms.0.params.bps.HSK/USDT", 1, 100],
    ["terms.0.params.bps.ETH/USDT", 1, 100],
    ["terms.1.params.k", 0, 5],
    ["terms.2.params.k", 0, 0.01],
    ["terms.3.params.scale", 0, 2],
    ["terms.4.params.dropPct", 0.1, 0.9],
    ["terms.4.params.windowSec", 1, 30],
    ["terms.4.params.addBps", 0, 100],
    ["terms.5.params.thresholdBps", 1, 100],
    ["terms.5.params.windowSec", 1, 30],
    ["terms.5.params.addBps", 0, 100],
    ["terms.6.params.k", 0, 2],
    ["terms.7.params.exponent", 0.5, 2],
    ["terms.7.params.kBps", 0, 50],
    ["reference.params.leadWeight", 0, 0.9],
    ["reference.params.lookbackSec", 1, 60],
    ["rejectIf.minSources", 1, 6],
  ];

  test.each(bounds)("%s accepts endpoints and rejects beyond them", (path, min, max) => {
    for (const endpoint of [min, max]) {
      expect(policyBodySchema.safeParse(setPath(body(), path, endpoint)).success).toBe(true);
    }
    for (const invalid of [min - 0.001, max + 0.001, NaN, Infinity, -Infinity]) {
      expect(policyBodySchema.safeParse(setPath(body(), path, invalid)).success).toBe(false);
    }
    expect(policyBodySchema.safeParse(setPath(body(), path, undefined)).success).toBe(
      path.startsWith("rejectIf."),
    );
  });

  test("TTL, clamp and rejection relations and open bounds", () => {
    const valid = body();
    valid.ttl = { kind: "volScaled", ttlVolK: 0.0001, minSec: 120, maxSec: 120 };
    valid.clamp = { minBps: 0.0001, maxBps: 9999.999 };
    valid.rejectIf = { maxSigma1: 0, minSources: 6, leadDivergenceBps: 0.0001 };
    expect(policyBodySchema.safeParse(valid).success).toBe(true);
    for (const [path, value] of [
      ["ttl.minSec", 0],
      ["ttl.maxSec", 121],
      ["ttl.minSec", 1.5],
      ["ttl.maxSec", 1.5],
      ["ttl.minSec", 121],
      ["ttl.maxSec", 0],
      ["ttl.ttlVolK", 0],
      ["clamp.minBps", 0],
      ["clamp.maxBps", 10_000],
      ["clamp.minBps", 301],
      ["clamp.maxBps", 4],
      ["rejectIf.maxSigma1", -0.001],
      ["rejectIf.minSources", 1.5],
      ["rejectIf.leadDivergenceBps", 0],
    ] as const) {
      expect(policyBodySchema.safeParse(setPath(body(), path, value)).success).toBe(false);
    }
    for (const path of [
      "ttl.ttlVolK",
      "ttl.minSec",
      "ttl.maxSec",
      "clamp.minBps",
      "clamp.maxBps",
      "rejectIf.maxSigma1",
      "rejectIf.leadDivergenceBps",
    ]) {
      for (const nonfinite of [NaN, Infinity, -Infinity]) {
        expect(policyBodySchema.safeParse(setPath(body(), path, nonfinite)).success).toBe(false);
      }
    }
    const inverted = body();
    inverted.ttl.minSec = 30;
    inverted.ttl.maxSec = 29;
    expect(policyBodySchema.safeParse(inverted).success).toBe(false);
    expect(policyBodySchema.safeParse(setPath(body(), "hypothesis", "x".repeat(500))).success).toBe(
      true,
    );
    expect(policyBodySchema.safeParse(setPath(body(), "hypothesis", "x".repeat(501))).success).toBe(
      false,
    );
  });

  test("all nine terms and no-parameter references; unknown fields fail at every level", () => {
    expect(policyBodySchema.parse(body()).terms).toHaveLength(9);
    for (const kind of ["median", "depthWeighted"] as const) {
      expect(
        policyBodySchema.safeParse({ ...body(), reference: { kind, params: {} } }).success,
      ).toBe(true);
    }
    for (const [path, value] of [
      ["unknown", true],
      ["reference.unknown", true],
      ["reference.params.unknown", true],
      ["terms.0.unknown", true],
      ["terms.0.params.unknown", true],
      ["terms.0.params.bps.BTC/USDT", 20],
      ["terms.8.params.k", 1],
      ["clamp.unknown", true],
      ["ttl.unknown", true],
      ["rejectIf.unknown", true],
      ["terms.0.kind", "unknown"],
      ["reference.kind", "unknown"],
    ] as const) {
      expect(policyBodySchema.safeParse(setPath(body(), path, value)).success).toBe(false);
    }
    expect(
      policyBodySchema.safeParse({
        ...body(),
        terms: [
          {
            kind: "reservationFee",
            params: { optionK: 1, adverseK: 1, utilK: 1, floorBps: 1 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      policyBodySchema.safeParse({ ...body(), reference: { kind: "median", params: { k: 1 } } })
        .success,
    ).toBe(false);
  });

  test("components and pairs are nonempty and unique, base matches pairs, tuner is last", () => {
    const invalid: unknown[] = [
      { ...body(), pairs: [] },
      { ...body(), pairs: ["HSK/USDT", "HSK/USDT"] },
      { ...body(), pairs: ["BTC/USDT"] },
      { ...body(), terms: [] },
      { ...body(), terms: [body().terms[0], body().terms[0]] },
      { ...body(), terms: [body().terms[8], body().terms[0]] },
      { ...body(), pairs: ["HSK/USDT"] },
      setPath(body(), "terms.0.params.bps", { "HSK/USDT": 20 }),
      setPath(body(), "reference.params.leadVenues", []),
      setPath(body(), "reference.params.leadVenues", ["gate", "gate"]),
      setPath(body(), "reference.params.leadVenues", ["unknown"]),
      setPath(body(), "terms.1.params", {}),
      setPath(body(), "terms.1", { kind: "vol" }),
    ];
    for (const value of invalid) expect(policyBodySchema.safeParse(value).success).toBe(false);
    const onePair = body();
    onePair.pairs = ["HSK/USDT"];
    onePair.terms = [{ kind: "base", params: { bps: { "HSK/USDT": 20 } } }];
    expect(policyBodySchema.safeParse(onePair).success).toBe(true);
  });
});

describe("PolicySpec canonical identity", () => {
  test("object keys are recursively sorted; array order affects the full keccak hash", () => {
    const source = body();
    const canonical = canonicalPolicySpec(source);
    expect(canonicalPolicySpec(reverseKeys(source))).toBe(canonical);
    expect(hashPolicySpec(source)).toBe(keccak256(stringToHex(canonical)));
    const reorder = body();
    reorder.terms.splice(0, 2, ...reorder.terms.slice(0, 2).reverse());
    expect(hashPolicySpec(reorder)).not.toBe(hashPolicySpec(source));
    expect(hashPolicySpec({ ...source, pairs: [...source.pairs].reverse() })).not.toBe(
      hashPolicySpec(source),
    );
  });

  test("ID binds content, excludes itself, and survives a JSON roundtrip", () => {
    const source = body();
    const spec = createPolicySpec(source, "20261031");
    expect(spec.id).toBe(`p-20261031-${hashPolicySpec(source).slice(2, 10)}`);
    expect(canonicalPolicySpec(spec)).toBe(canonicalPolicySpec(source));
    expect(hashPolicySpec(spec)).toBe(hashPolicySpec(source));
    expect(policySpecSchema.parse(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
    expect(policySpecSchema.safeParse({ ...spec, hypothesis: "different" }).success).toBe(false);
    expect(() => canonicalPolicySpec({ ...spec, hypothesis: "different" })).toThrow();
    expect(() => hashPolicySpec({ ...spec, id: "p-20261031-00000000" })).toThrow();
    const replaced = createPolicySpec({ ...source, hypothesis: "different" }, "20261031");
    expect(replaced.id).not.toBe(spec.id);
    expect(policySpecSchema.safeParse({ ...spec, parent: spec.id }).success).toBe(false);
    expect(() => canonicalPolicySpec({ ...source, unknown: true })).toThrow();
    expect(() => createPolicySpec(spec, "20261031")).toThrow();
  });

  test("explicit real UTC dates and policy parent identities are required", () => {
    for (const date of ["20240229", "20000229", "20261031", "00991231"]) {
      expect(createPolicySpec(body(), date).id).toStartWith(`p-${date}-`);
    }
    for (const date of ["20260229", "19000229", "20261301", "20260431", "00000101", "2026-10-31"]) {
      expect(() => createPolicySpec(body(), date)).toThrow();
    }
    const source = body();
    const parent = createPolicySpec(source, "20261031").id;
    expect(createPolicySpec({ ...source, parent }, "20261101").parent).toBe(parent);
    for (const parentId of ["v1", "p-20260229-12345678", "p-20261031-1234567G", "p-20261031-123"]) {
      expect(() => createPolicySpec({ ...source, parent: parentId }, "20261031")).toThrow();
    }
    const spec = createPolicySpec(source, "20261031");
    expect(
      policySpecSchema.safeParse({ ...spec, id: `p-20260229-${spec.id.slice(-8)}` }).success,
    ).toBe(false);
  });
});
