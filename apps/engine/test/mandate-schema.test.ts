import { expect, test } from "bun:test";
import raw from "../mandate.json";
import { defaultParams } from "../src/config";
import { defaultMandate, loadMandate, mandateSchema } from "../src/policy/mandate";

test("default mandate preserves the incumbent's supported inventory and size ranges", () => {
  expect(loadMandate(raw)).toEqual(defaultMandate);
  expect(defaultMandate.pairs).toEqual(defaultParams.pairs);
  expect(defaultMandate.inventory).toEqual({
    minShare: defaultParams.inventory.minShare,
    maxShare: defaultParams.inventory.maxShare,
  });
  expect(defaultMandate.service.minQuoteNotionalUsd).toBe(defaultParams.quote.minNotionalUsd);
  expect(defaultMandate.service.maxHalfSpreadBps.at(-1)?.maxNotionalUsd).toBeGreaterThanOrEqual(
    Math.max(...Object.values(defaultParams.quote.maxNotionalUsd)),
  );
});

test("mandate rejects missing, unknown and mistyped limits at every object boundary", () => {
  expect(mandateSchema.safeParse({ ...raw, fallback: true }).success).toBe(false);
  for (const field of ["inventory", "service", "loss", "canary", "qualification"] as const) {
    expect(mandateSchema.safeParse({ ...raw, [field]: undefined }).success).toBe(false);
    expect(mandateSchema.safeParse({ ...raw, [field]: { ...raw[field], extra: 1 } }).success).toBe(
      false,
    );
  }
  const unknownBucket = {
    ...raw,
    service: {
      ...raw.service,
      maxHalfSpreadBps: [{ maxNotionalUsd: 50000, maxBps: 1000, extra: 1 }],
    },
  };
  expect(mandateSchema.safeParse(unknownBucket).success).toBe(false);
  expect(mandateSchema.safeParse({ ...raw, loss: { maxOperatingLossUsd: "5000" } }).success).toBe(
    false,
  );
  expect(() => loadMandate(null)).toThrow("Invalid desk mandate");
});

test("mandate requires nonempty, unique supported pairs", () => {
  for (const pairs of [[], ["BTC/USDT"], ["HSK/USDT", "HSK/USDT"]]) {
    expect(mandateSchema.safeParse({ ...raw, pairs }).success).toBe(false);
  }
  expect(loadMandate({ ...raw, pairs: ["HSK/USDT"] }).pairs).toEqual(["HSK/USDT"]);
});

test("inventory fractions include endpoints but must form a nonempty band", () => {
  expect(loadMandate({ ...raw, inventory: { minShare: 0, maxShare: 1 } }).inventory).toEqual({
    minShare: 0,
    maxShare: 1,
  });
  for (const inventory of [
    { minShare: -0.01, maxShare: 0.85 },
    { minShare: 0.15, maxShare: 1.01 },
    { minShare: 0.5, maxShare: 0.5 },
    { minShare: 0.9, maxShare: 0.8 },
  ]) {
    expect(mandateSchema.safeParse({ ...raw, inventory }).success).toBe(false);
  }
});

test("service buckets must increase uniquely and cover the minimum quote size", () => {
  const service = {
    ...raw.service,
    maxHalfSpreadBps: [
      { maxNotionalUsd: 100, maxBps: 30 },
      { maxNotionalUsd: 1000, maxBps: 50 },
    ],
  };
  expect(loadMandate({ ...raw, service }).service).toEqual(service);
  for (const maxHalfSpreadBps of [
    [],
    [...service.maxHalfSpreadBps].reverse(),
    [service.maxHalfSpreadBps[0], service.maxHalfSpreadBps[0]],
    [{ maxNotionalUsd: 0, maxBps: 30 }],
    [{ maxNotionalUsd: 1000, maxBps: 0 }],
    [{ maxNotionalUsd: 1000, maxBps: 10000 }],
  ]) {
    expect(
      mandateSchema.safeParse({ ...raw, service: { ...service, maxHalfSpreadBps } }).success,
    ).toBe(false);
  }
  expect(
    loadMandate({ ...raw, service: { ...service, minQuoteNotionalUsd: 1000 } }).service
      .minQuoteNotionalUsd,
  ).toBe(1000);
  expect(
    mandateSchema.safeParse({ ...raw, service: { ...service, minQuoteNotionalUsd: 1001 } }).success,
  ).toBe(false);
});

test("mandate rejects nonfinite numeric limits and nonpositive dollar limits", () => {
  for (const value of [NaN, Infinity, -Infinity, 0, -1]) {
    expect(mandateSchema.safeParse({ ...raw, loss: { maxOperatingLossUsd: value } }).success).toBe(
      false,
    );
    expect(
      mandateSchema.safeParse({
        ...raw,
        service: { ...raw.service, minQuoteNotionalUsd: value },
      }).success,
    ).toBe(false);
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    expect(
      mandateSchema.safeParse({ ...raw, inventory: { ...raw.inventory, minShare: value } }).success,
    ).toBe(false);
    expect(
      mandateSchema.safeParse({
        ...raw,
        service: { ...raw.service, maxHalfSpreadBps: [{ maxNotionalUsd: 100, maxBps: value }] },
      }).success,
    ).toBe(false);
    expect(
      mandateSchema.safeParse({
        ...raw,
        service: { ...raw.service, maxHalfSpreadBps: [{ maxNotionalUsd: value, maxBps: 30 }] },
      }).success,
    ).toBe(false);
  }
});

test("canary requires a bounded allocation, actual fills and fractional retirement guards", () => {
  for (const maxAllocationPct of [1, 100]) {
    expect(
      loadMandate({ ...raw, canary: { ...raw.canary, maxAllocationPct } }).canary.maxAllocationPct,
    ).toBe(maxAllocationPct);
  }
  for (const maxAllocationPct of [0, 0.5, 101, Infinity]) {
    expect(
      mandateSchema.safeParse({ ...raw, canary: { ...raw.canary, maxAllocationPct } }).success,
    ).toBe(false);
  }
  for (const minFillsBeforePromote of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(
      mandateSchema.safeParse({ ...raw, canary: { ...raw.canary, minFillsBeforePromote } }).success,
    ).toBe(false);
  }
  for (const field of ["retireDrawdownPct", "retireFillRateDrop"] as const) {
    for (const value of [0, -0.1, 1.01, 20, Infinity]) {
      expect(
        mandateSchema.safeParse({ ...raw, canary: { ...raw.canary, [field]: value } }).success,
      ).toBe(false);
    }
    expect(loadMandate({ ...raw, canary: { ...raw.canary, [field]: 1 } }).canary[field]).toBe(1);
  }
});

test("qualification cannot disable held-out evaluation or use percentages in place of fractions", () => {
  expect(
    mandateSchema.safeParse({
      ...raw,
      qualification: { ...raw.qualification, mustBeatHeldOut: false },
    }).success,
  ).toBe(false);
  for (const field of [
    "maxDrawdownDeltaPct",
    "honestFillTolerance",
    "minHonestFillRate",
    "maxRejectRate",
  ] as const) {
    for (const value of [-0.01, 1.01, 5, Infinity]) {
      expect(
        mandateSchema.safeParse({ ...raw, qualification: { ...raw.qualification, [field]: value } })
          .success,
      ).toBe(false);
    }
    for (const value of [0, 1]) {
      expect(
        loadMandate({ ...raw, qualification: { ...raw.qualification, [field]: value } })
          .qualification[field],
      ).toBe(value);
    }
  }
});

test("uptime is measured in percent, with finite inclusive zero and one hundred bounds", () => {
  for (const uptimeTargetPct of [0, 100]) {
    expect(
      loadMandate({ ...raw, service: { ...raw.service, uptimeTargetPct } }).service.uptimeTargetPct,
    ).toBe(uptimeTargetPct);
  }
  for (const uptimeTargetPct of [-1, 101, Infinity]) {
    expect(
      mandateSchema.safeParse({ ...raw, service: { ...raw.service, uptimeTargetPct } }).success,
    ).toBe(false);
  }
});
