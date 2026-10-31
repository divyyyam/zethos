import { describe, expect, test } from "bun:test";
import { defaultParams, type Pair, type Params } from "../src/config";
import {
  createV0,
  defaultMandate,
  type PolicyInventory,
  type PolicyMarketState,
  type PolicyRequest,
} from "../src/policy";
import { amountOut } from "../src/pricing";
import { compile } from "../src/research/compile";
import { createV0Spec } from "../src/research/incumbent";
import { bookAround, MIDS, usdt } from "./helpers";

function fixture(pair: Pair = "HSK/USDT") {
  const mid = MIDS[pair];
  const market: PolicyMarketState = {
    now: 1_800_000_000_000,
    pair,
    fused: { mid, health: "ok", sourceCount: 2, sigma1: 0.0002 },
    venues: [],
    history: {},
    book: bookAround(mid, 1_000_000),
    tuner: 1,
  };
  const inventory: PolicyInventory = {
    base: { raw: "250000000000000000000000", usd: 25000 },
    quote: { raw: "50000000000", usd: 25000 },
    baseShare: 0.5,
    targetShare: 0.5,
  };
  const request: PolicyRequest = {
    pair,
    side: "buy",
    amountIn: usdt(100),
    baseQuantity: 100 / mid,
    notionalUsd: 100,
    tier: "normal",
    score: 0.2,
  };
  return { market, inventory, request };
}

function changedParams(): Params {
  const params = structuredClone(defaultParams);
  params.quote.minTtlSec = 5;
  params.quote.ttlSec = 25;
  params.quote.ttlVolK = 0.002;
  // These fractions do not survive a bps roundtrip exactly on every IEEE-754 value.
  params.spread.base["HSK/USDT"] = 0.0001003;
  params.spread.min = 0.00050003;
  params.spread.max = 0.02999997;
  params.spread.kInventory = 0.008;
  params.inventory.targetShare = 0.6;
  return params;
}

describe("compiled incumbent equivalence", () => {
  test("matches the complete v0 decision and raw output exactly across pricing and TTL boundaries", () => {
    for (const params of [defaultParams, changedParams()]) {
      const policy = compile(createV0Spec("20261031", params), { params });
      const incumbent = createV0(params);
      for (const pair of params.pairs)
        for (const side of ["buy", "sell"] as const)
          for (const tier of ["normal", "probation", "watch", "toxic"] as const)
            for (const sigma1 of [0, 0.0001, params.quote.ttlVolK / Math.sqrt(10), 0.01])
              for (const share of [0, 0.15, 0.5, 0.85, 1])
                for (const tuner of [0.5, 1, 3])
                  for (const health of ["ok", "degraded"] as const) {
                    const { market, inventory, request } = fixture(pair);
                    request.side = side;
                    request.tier = tier;
                    market.tuner = tuner;
                    market.fused.sigma1 = sigma1;
                    market.fused.health = health;
                    inventory.baseShare = share;
                    inventory.targetShare = params.inventory.targetShare;
                    const expected = incumbent.decide(market, inventory, request);
                    const actual = policy.decide(market, inventory, request);
                    expect(actual).toEqual(expected);
                    if (actual.kind !== "quote" || expected.kind !== "quote") {
                      throw new Error("Unexpected rejection in the incumbent parity grid");
                    }
                    for (const decimals of [6, 18, 24]) {
                      const rawIn = 123456789n * 10n ** BigInt(decimals);
                      expect(amountOut(side, rawIn, actual.price, decimals, 6)).toBe(
                        amountOut(side, rawIn, expected.price, decimals, 6),
                      );
                    }
                  }
    }
  });

  test("binds copied spec, configuration and mandate without changing frozen decision inputs", () => {
    const params = structuredClone(defaultParams);
    const mandate = structuredClone(defaultMandate);
    const spec = createV0Spec("20261031", params);
    const policy = compile(spec, { params, mandate });
    const { market, inventory, request } = fixture();
    const before = structuredClone({ market, inventory, request });
    const freeze = (value: object): void => {
      Object.freeze(value);
      for (const child of Object.values(value)) {
        if (child && typeof child === "object") freeze(child);
      }
    };
    freeze(market);
    freeze(inventory);
    freeze(request);
    const expected = policy.decide(market, inventory, request);
    expect(expected).toEqual(createV0(defaultParams).decide(market, inventory, request));

    spec.id = "p-20261031-00000000";
    spec.parent = spec.id;
    spec.pairs.length = 0;
    spec.terms.length = 0;
    spec.reference = { kind: "median", params: {} };
    spec.clamp.minBps = 100;
    spec.clamp.maxBps = 100;
    spec.ttl.ttlVolK = 0.00001;
    spec.ttl.maxSec = 1;
    params.pairs.length = 0;
    params.spread.base["HSK/USDT"] = 0.1;
    params.spread.kSigma = 5;
    params.spread.kInventory = 0.01;
    params.spread.degradedAdd = 0.1;
    params.quote.ttlSec = 1;
    params.quote.ttlVolK = 0.00001;
    params.toxicity.tiers.normal.ttlSec = 1;
    params.toxicity.tiers.normal.sigmaAdd = 2;
    params.feeds.sources["HSK/USDT"].length = 0;
    mandate.pairs.length = 0;
    mandate.service.maxHalfSpreadBps.length = 0;
    mandate.inventory.minShare = 0.99;
    mandate.inventory.maxShare = 1;

    expect(policy.decide(market, inventory, request)).toEqual(expected);
    expect(policy.decide(market, inventory, request)).toEqual(expected);
    expect({ market, inventory, request }).toEqual(before);
  });
});
