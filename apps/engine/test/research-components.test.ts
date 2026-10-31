import { describe, expect, test } from "bun:test";
import { defaultParams } from "../src/config";
import { vwapForQuote } from "../src/feeds/fuse";
import { defaultMandate } from "../src/policy/mandate";
import type {
  PolicyInventory,
  PolicyMarketState,
  PolicyQuote,
  PolicyRequest,
} from "../src/policy/types";
import {
  compile,
  createPolicySpec,
  createV0Spec,
  type PolicyBody,
  type PolicyTerm,
} from "../src/research";

const NOW = 1_800_000_000_000;
function fixture() {
  const market: PolicyMarketState = {
    now: NOW,
    pair: "HSK/USDT",
    fused: { mid: 100, health: "ok", sourceCount: 2, sigma1: 0 },
    book: { bids: [[99.99, 10_000]], asks: [[100.01, 10_000]] },
    tuner: 1,
    venues: [
      {
        venue: "hashkey-global",
        mid: 100,
        bidDepthUsd: 1000,
        askDepthUsd: 1000,
        receivedAt: NOW,
        status: "ok",
      },
      {
        venue: "gate",
        mid: 100,
        bidDepthUsd: 1000,
        askDepthUsd: 1000,
        receivedAt: NOW,
        status: "ok",
      },
    ],
    history: {
      "hashkey-global": [{ t: NOW - 5000, mid: 100, bidDepthUsd: 1000, askDepthUsd: 1000 }],
    },
  };
  const inventory: PolicyInventory = {
    base: { raw: "5000000000000000000", usd: 500 },
    quote: { raw: "500000000", usd: 500 },
    baseShare: 0.5,
    targetShare: 0.5,
  };
  const request: PolicyRequest = {
    pair: "HSK/USDT",
    side: "buy",
    amountIn: "100000000",
    baseQuantity: 1,
    notionalUsd: 100,
    tier: "normal",
    score: 0.2,
  };
  const lead = market.venues[0];
  const other = market.venues[1];
  if (!lead || !other) throw new Error("Missing fixture venues");
  return { market, inventory, request, lead, other };
}

function recipe(extra: PolicyTerm[] = []): PolicyBody {
  return {
    parent: "v0",
    hypothesis: "Component behavior fixture",
    pairs: ["HSK/USDT"],
    reference: { kind: "depthWeighted", params: {} },
    terms: [{ kind: "base", params: { bps: { "HSK/USDT": 20 } } }, ...extra],
    clamp: { minBps: 5, maxBps: 300 },
    ttl: { kind: "volScaled", ttlVolK: 0.0015, minSec: 3, maxSec: 120 },
  };
}

function decide(body: PolicyBody, input = fixture()) {
  return compile(createPolicySpec(body, "20261031")).decide(
    input.market,
    input.inventory,
    input.request,
  );
}
function quoted(body: PolicyBody, input = fixture()): PolicyQuote {
  const result = decide(body, input);
  if (result.kind !== "quote") throw new Error(`Unexpected rejection: ${result.reason}`);
  return result;
}

describe("policy components", () => {
  test("base, volatility, inventory and toxicity retain their independent contributions", () => {
    const body = recipe([
      { kind: "vol", params: { k: 1 } },
      { kind: "inventory", params: { k: 0.01 } },
      { kind: "toxicity", params: { scale: 2 } },
    ]);
    const input = fixture();
    input.market.fused.sigma1 = 0.0002;
    input.inventory.baseShare = 0.75;
    input.request.tier = "watch";
    const buy = quoted(body, input);
    expect(buy.terms.base).toBe(0.002);
    expect(buy.terms.vol).toBe(buy.sigmaT);
    expect(buy.terms.inventory).toBe(-0.0025);
    expect(buy.terms.toxicity).toBe(2 * buy.sigmaT);
    input.request.side = "sell";
    expect(quoted(body, input).terms.inventory).toBe(0.0025);
    input.market.fused.health = "degraded";
    expect(quoted(body, input).terms.degraded).toBe(defaultParams.spread.degradedAdd);
  });

  test("tuner multiplies the clamped sum and is clamped again; absent tuner is neutral", () => {
    const input = fixture();
    const body = recipe([
      { kind: "inventory", params: { k: 0.01 } },
      { kind: "tuner", params: {} },
    ]);
    input.inventory.baseShare = 1;
    input.market.tuner = 3;
    expect(quoted(body, input).halfSpread).toBe(0.0005 * 3);
    expect(quoted(recipe(), input).halfSpread).toBe(0.002);
    input.request.side = "sell";
    body.clamp.maxBps = 50;
    expect(quoted(body, input).halfSpread).toBe(0.005);
    body.clamp.maxBps = 300;
    input.market.tuner = 0.5;
    expect(quoted(body, input).halfSpread).toBe((0.002 + 0.005) * 0.5);
  });

  test("depth withdrawal uses side-specific peak depth inside the window", () => {
    const body = recipe([
      { kind: "depthWithdrawal", params: { dropPct: 0.5, windowSec: 10, addBps: 10 } },
    ]);
    const input = fixture();
    const venue = input.market.venues[0];
    if (!venue) throw new Error("Missing venue");
    venue.askDepthUsd = 500;
    expect(quoted(body, input).terms.depthWithdrawal).toBe(0.001);
    input.request.side = "sell";
    expect(quoted(body, input).terms.depthWithdrawal).toBe(0);
    input.request.side = "buy";
    venue.askDepthUsd = 501;
    expect(quoted(body, input).terms.depthWithdrawal).toBe(0);
    input.market.history["hashkey-global"]?.push({
      t: NOW - 9000,
      mid: 100,
      bidDepthUsd: 1000,
      askDepthUsd: 2000,
    });
    expect(quoted(body, input).terms.depthWithdrawal).toBe(0.001);
  });

  test("withdrawal signals ignore missing, zero, future and out-of-window baselines and excluded venues", () => {
    const body = recipe([
      { kind: "depthWithdrawal", params: { dropPct: 0.5, windowSec: 10, addBps: 10 } },
    ]);
    for (const t of [NOW + 1, NOW, NOW - 10_001]) {
      const input = fixture();
      input.lead.askDepthUsd = 0;
      input.market.history["hashkey-global"] = [
        { t, mid: 100, bidDepthUsd: 1000, askDepthUsd: 1000 },
      ];
      expect(quoted(body, input).terms.depthWithdrawal).toBe(0);
    }
    for (const status of ["stale", "outlier", "down"] as const) {
      const input = fixture();
      input.lead.askDepthUsd = 0;
      input.lead.status = status;
      expect(quoted(body, input).terms.depthWithdrawal).toBe(0);
    }
    const input = fixture();
    input.lead.askDepthUsd = 0;
    input.market.history["hashkey-global"] = [
      { t: NOW - 5000, mid: 100, bidDepthUsd: 0, askDepthUsd: 0 },
    ];
    expect(quoted(body, input).terms.depthWithdrawal).toBe(0);
    input.market.history = {};
    expect(quoted(body, input).terms.depthWithdrawal).toBe(0);
  });

  test("lead moves widen only the exposed side and stop widening once fused catches up", () => {
    const body = recipe([
      { kind: "leadMove", params: { thresholdBps: 20, windowSec: 10, addBps: 12 } },
    ]);
    const input = fixture();
    input.lead.mid = 100.3;
    expect(quoted(body, input).terms.leadMove).toBe(0.0012);
    input.request.side = "sell";
    expect(quoted(body, input).terms.leadMove).toBe(0);
    input.lead.mid = 99.7;
    expect(quoted(body, input).terms.leadMove).toBe(0.0012);
    input.market.fused.mid = 99.7;
    expect(quoted(body, input).terms.leadMove).toBe(0);
    input.market.fused.mid = 100;
    input.market.history["hashkey-global"] = [];
    expect(quoted(body, input).terms.leadMove).toBe(0);
  });

  test("lead references blend current accepted mids and use lookback only to select leads", () => {
    const body = recipe();
    body.reference = {
      kind: "leadWeighted",
      params: { leadVenues: ["hashkey-global"], leadWeight: 0.5, lookbackSec: 10 },
    };
    const input = fixture();
    input.lead.mid = 100.3;
    const walked = vwapForQuote(input.market.book.asks, input.request.notionalUsd);
    if (walked === null) throw new Error("Missing depth");
    const quote = quoted(body, input);
    expect(quote.ref).toBe(walked * 0.5 + 100.3 * 0.5);
    expect(quote.ref).toBeGreaterThanOrEqual(walked);
    expect(quote.ref).toBeLessThanOrEqual(100.3);
    body.reference.params.leadWeight = 0;
    expect(quoted(body, input).ref).toBe(walked);
    body.reference.params.leadWeight = 0.9;
    body.reference.params.lookbackSec = 1;
    expect(quoted(body, input).ref).toBe(walked);
    body.reference.params.lookbackSec = 10;
    input.lead.receivedAt = NOW + 1;
    expect(quoted(body, input).ref).toBe(walked);
    input.lead.receivedAt = NOW;
    input.other.mid = 100.1;
    input.market.history.gate = [{ t: NOW - 5000, mid: 100, bidDepthUsd: 1000, askDepthUsd: 1000 }];
    body.reference.params.leadVenues.push("gate");
    body.reference.params.leadWeight = 0.5;
    expect(quoted(body, input).ref).toBe(walked * 0.5 + ((100.3 + 100.1) / 2) * 0.5);
  });

  test("median reference excludes stale, outlier and unconfigured source prices", () => {
    const body = recipe();
    body.reference = { kind: "median", params: {} };
    const input = fixture();
    input.lead.mid = 100.3;
    expect(quoted(body, input).ref).toBe(100.15);
    input.market.venues.push({
      venue: "binance",
      mid: 500,
      bidDepthUsd: 1000,
      askDepthUsd: 1000,
      receivedAt: NOW,
      status: "ok",
    });
    expect(quoted(body, input).ref).toBe(100.15);
    input.lead.status = "outlier";
    expect(quoted(body, input).ref).toBe(100);
    input.lead.status = "ok";
    input.lead.receivedAt = NOW - defaultParams.feeds.staleMs - 1;
    expect(quoted(body, input).ref).toBe(100);
    input.other.status = "down";
    expect(decide(body, input)).toEqual({ kind: "reject", reason: "degraded_reject" });
  });

  test("restore cost prices the correcting hedge and normalizes its slippage by pair equity", () => {
    const body = recipe([{ kind: "restoreCost", params: { k: 2 } }]);
    const input = fixture();
    expect(quoted(body, input).terms.restoreCost).toBe(0);
    input.market.book = { bids: [[99, 10_000]], asks: [[101, 10_000]] };
    input.inventory.base.usd = 750;
    input.inventory.quote.usd = 250;
    input.inventory.baseShare = 0.75;
    expect(quoted(body, input).terms.restoreCost).toBeCloseTo(0.005, 12);
    input.inventory.base.usd = 250;
    input.inventory.quote.usd = 750;
    input.inventory.baseShare = 0.25;
    expect(quoted(body, input).terms.restoreCost).toBeCloseTo(0.005, 12);
    input.inventory.base.usd = 0;
    input.inventory.quote.usd = 0;
    expect(quoted(body, input).terms.restoreCost).toBe(0);
  });

  test("missing restoration depth rejects; zero restore coefficient does not require a hedge", () => {
    const body = recipe([{ kind: "restoreCost", params: { k: 1 } }]);
    const input = fixture();
    input.inventory.base.usd = 990;
    input.inventory.quote.usd = 10;
    input.market.book.bids = [[99, 1]];
    expect(decide(body, input)).toEqual({ kind: "reject", reason: "inventory" });
    body.terms = recipe([{ kind: "restoreCost", params: { k: 0 } }]).terms;
    expect(quoted(body, input).terms.restoreCost).toBe(0);
  });

  test("size curve increases with notional relative to the owner size cap", () => {
    const input = fixture();
    for (const exponent of [0.5, 1, 2]) {
      const body = recipe([{ kind: "sizeCurve", params: { exponent, kBps: 50 } }]);
      input.request.notionalUsd = 250;
      const small = quoted(body, input).terms.sizeCurve;
      input.request.notionalUsd = 2500;
      const big = quoted(body, input).terms.sizeCurve;
      expect(big).toBeGreaterThan(small ?? 0);
      input.request.notionalUsd = defaultParams.quote.maxNotionalUsd["HSK/USDT"];
      expect(quoted(body, input).terms.sizeCurve).toBe(0.005);
    }
    expect(
      quoted(recipe([{ kind: "sizeCurve", params: { exponent: 2, kBps: 0 } }]), input).terms
        .sizeCurve,
    ).toBe(0);
  });
});

describe("policy guards and compilation authority", () => {
  test("rejectIf boundaries have fixed reasons and never use rejected or future lead prices", () => {
    const input = fixture();
    const body = recipe();
    body.rejectIf = { maxSigma1: 0, minSources: 2, leadDivergenceBps: 10 };
    expect(quoted(body, input).kind).toBe("quote");
    input.market.fused.sigma1 = 0.0001;
    expect(decide(body, input)).toEqual({ kind: "reject", reason: "policy_rule" });
    input.market.fused.sigma1 = 0;
    input.market.fused.sourceCount = 1;
    expect(decide(body, input)).toEqual({ kind: "reject", reason: "degraded_reject" });
    input.market.fused.sourceCount = 2;
    input.lead.mid = 100.2;
    expect(decide(body, input)).toEqual({ kind: "reject", reason: "lead_divergence" });
    input.lead.status = "stale";
    expect(quoted(body, input).kind).toBe("quote");
    input.lead.status = "ok";
    input.lead.receivedAt = NOW + 1;
    expect(quoted(body, input).kind).toBe("quote");
    input.market.fused.health = "down";
    expect(decide(body, input)).toEqual({ kind: "reject", reason: "halted" });
  });

  test("compilation rejects unsupported pairs, lead venues, owner clamps and impossible TTL", () => {
    const base = createV0Spec("20261031");
    const params = structuredClone(defaultParams);
    params.pairs = ["ETH/USDT"];
    expect(() => compile(base, { params })).toThrow("outside the enabled desk mandate");
    const body = recipe();
    body.reference = {
      kind: "leadWeighted",
      params: { leadVenues: ["binance"], leadWeight: 0.5, lookbackSec: 10 },
    };
    expect(() => compile(createPolicySpec(body, "20261031"))).toThrow("must be configured");
    const mandate = structuredClone(defaultMandate);
    mandate.pairs = ["ETH/USDT"];
    expect(() => compile(base, { mandate })).toThrow("outside the enabled desk mandate");
    for (const clamp of [
      { minBps: 1, maxBps: 300 },
      { minBps: 5, maxBps: 301 },
    ]) {
      const invalid = { ...recipe(), clamp };
      expect(() => compile(createPolicySpec(invalid, "20261031"))).toThrow("clamp exceeds");
    }
    mandate.pairs = [...defaultMandate.pairs];
    mandate.service.maxHalfSpreadBps = [
      { maxNotionalUsd: 100, maxBps: 50 },
      { maxNotionalUsd: 50000, maxBps: 100 },
    ];
    expect(() => compile(base, { mandate })).toThrow("clamp exceeds");
    const ttl = { kind: "volScaled" as const, ttlVolK: 0.0015, minSec: 1, maxSec: 2 };
    expect(() => compile(createPolicySpec({ ...recipe(), ttl }, "20261031"))).toThrow(
      "TTL has no overlap",
    );
  });

  test("every reference requires size depth, while malformed numerical decisions fail closed", () => {
    const input = fixture();
    input.market.book.asks = [[100, 0.01]];
    for (const reference of [
      { kind: "depthWeighted", params: {} },
      { kind: "median", params: {} },
    ] as const)
      expect(decide({ ...recipe(), reference }, input)).toEqual({
        kind: "reject",
        reason: "insufficient_reference_depth",
      });
    input.market.fused.sigma1 = NaN;
    expect(decide(recipe(), input)).toEqual({ kind: "reject", reason: "policy_rule" });
    input.market.fused.sigma1 = 0;
    input.request.notionalUsd = 0;
    expect(decide(recipe(), input)).toEqual({ kind: "reject", reason: "size" });
  });
});
