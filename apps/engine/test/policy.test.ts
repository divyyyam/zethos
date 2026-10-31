import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { defaultParams, type Pair, type Params } from "../src/config";
import { memoryStore } from "../src/db/memory";
import { Engine } from "../src/engine";
import { vwap, vwapForQuote } from "../src/feeds/fuse";
import {
  createV0,
  type Policy,
  type PolicyInventory,
  type PolicyMarketState,
  type PolicyRequest,
} from "../src/policy";
import { amountOut, priceSwap, ttlSeconds } from "../src/pricing";
import { bookAround, MIDS, SIGNER_KEY, TAKER, tokens, usdt } from "./helpers";

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

describe("incumbent policy v0", () => {
  test("matches legacy prices, TTL, terms and raw output exactly across the input grid", () => {
    const changed: Params = structuredClone(defaultParams);
    changed.quote.minTtlSec = 5;
    changed.quote.ttlSec = 25;
    changed.quote.ttlVolK = 0.002;
    changed.spread.base["HSK/USDT"] = 0.0001;
    changed.spread.kInventory = 0.008;
    changed.inventory.targetShare = 0.6;
    for (const params of [defaultParams, changed]) {
      const policy = createV0(params);
      for (const pair of params.pairs)
        for (const side of ["buy", "sell"] as const)
          for (const tierName of ["normal", "probation", "watch", "toxic"] as const)
            for (const sigma1 of [0, 0.0001, params.quote.ttlVolK / Math.sqrt(10), 0.01])
              for (const share of [0, 0.15, 0.5, 0.85, 1])
                for (const tuner of [0.5, 1, 3])
                  for (const degraded of [false, true]) {
                    const { market, inventory, request } = fixture(pair);
                    request.side = side;
                    request.tier = tierName;
                    market.tuner = tuner;
                    market.fused.sigma1 = sigma1;
                    market.fused.health = degraded ? "degraded" : "ok";
                    inventory.baseShare = share;
                    inventory.targetShare = params.inventory.targetShare;
                    const ref =
                      side === "buy"
                        ? vwapForQuote(market.book.asks, request.notionalUsd)
                        : vwap(market.book.bids, request.baseQuantity);
                    if (ref === null) throw new Error("fixture lacks depth");
                    const tier = params.toxicity.tiers[tierName];
                    const ttlSec = ttlSeconds(sigma1, tier.ttlSec, params.quote);
                    const old = priceSwap(
                      {
                        side,
                        ref,
                        sigma1,
                        ttlSec,
                        baseShare: share,
                        degraded,
                        tier,
                        tuner,
                        baseSpread: params.spread.base[pair],
                      },
                      params.spread,
                      inventory.targetShare,
                    );
                    const result = policy.decide(market, inventory, request);
                    expect(result).toEqual({
                      kind: "quote",
                      ref,
                      price: old.price,
                      halfSpread: old.half,
                      sigmaT: old.sigmaT,
                      ttlSec,
                      terms: { ...old.terms },
                    });
                    if (result.kind !== "quote") throw new Error("unexpected rejection");
                    for (const decimals of [6, 18, 24]) {
                      const raw = 123456789n * 10n ** BigInt(decimals);
                      expect(amountOut(side, raw, result.price, decimals, 6)).toBe(
                        amountOut(side, raw, old.price, decimals, 6),
                      );
                    }
                  }
    }
  });

  test("walks buys by quote budget, sells by base quantity, and explicitly rejects thin depth", () => {
    const { market, inventory, request } = fixture();
    market.book = {
      asks: [
        [0.1, 100],
        [0.2, 1000],
      ],
      bids: [
        [0.09, 100],
        [0.08, 1000],
      ],
    };
    const policy = createV0(defaultParams);
    const buy = policy.decide(market, inventory, request);
    expect(buy.kind === "quote" ? buy.ref : null).toBe(vwapForQuote(market.book.asks, 100));
    request.side = "sell";
    request.baseQuantity = 150;
    const sell = policy.decide(market, inventory, request);
    expect(sell.kind === "quote" ? sell.ref : null).toBe(vwap(market.book.bids, 150));
    request.baseQuantity = 1101;
    expect(policy.decide(market, inventory, request)).toEqual({
      kind: "reject",
      reason: "insufficient_reference_depth",
    });
  });

  test("copies pricing configuration and returns deterministic decisions without mutating input", () => {
    const params = structuredClone(defaultParams);
    const policy = createV0(params);
    const { market, inventory, request } = fixture();
    const before = structuredClone({ market, inventory, request });
    const freeze = (value: object) => {
      Object.freeze(value);
      for (const child of Object.values(value))
        if (child && typeof child === "object") freeze(child);
    };
    freeze(market);
    freeze(inventory);
    freeze(request);
    const result = policy.decide(market, inventory, request);
    params.spread.base["HSK/USDT"] = 0.1;
    expect(policy.decide(market, inventory, request)).toEqual(result);
    expect({ market, inventory, request }).toEqual(before);
  });
});

test("quote issuance passes only identity-free snapshots and detached market data to the policy", async () => {
  const captured: {
    market: PolicyMarketState;
    inventory: PolicyInventory;
    request: PolicyRequest;
  }[] = [];
  const v0 = createV0(defaultParams);
  const policy: Policy = {
    id: "v0",
    decide(market, inventory, request) {
      captured.push(structuredClone({ market, inventory, request }));
      const result = v0.decide(market, inventory, request);
      market.book.asks.length = 0;
      market.history = {};
      inventory.base.raw = "0";
      return result;
    },
  };
  const params = structuredClone(defaultParams);
  params.feeds.staleMs = 120_000;
  const engine = new Engine({
    chainId: 177,
    params,
    tokens,
    store: memoryStore(),
    signer: privateKeyToAccount(SIGNER_KEY),
    policy,
  });
  const now = 1_800_000_000_000;
  for (const pair of defaultParams.pairs)
    engine.ingest(
      pair,
      defaultParams.feeds.sources[pair].map((venue) => ({
        venue,
        book: bookAround(MIDS[pair], 1_000_000),
        error: null,
      })),
      now,
    );
  await engine.ensureArena(now);
  for (const [taker, client, ip] of [
    [TAKER, "attacker", "192.0.2.1"],
    ["0x2222222222222222222222222222222222222222", "web", "192.0.2.2"],
  ]) {
    await engine.quote(
      { taker, tokenIn: tokens.USDT.address, tokenOut: tokens.WHSK.address, amountIn: usdt(100) },
      client,
      now,
      ip,
    );
  }
  expect(captured).toHaveLength(2);
  expect(captured[0]).toEqual(captured[1]);
  const snapshot = captured[0];
  expect(Object.keys(snapshot ?? {}).sort()).toEqual(["inventory", "market", "request"]);
  expect(Object.keys(snapshot?.request ?? {}).sort()).toEqual([
    "amountIn",
    "baseQuantity",
    "notionalUsd",
    "pair",
    "score",
    "side",
    "tier",
  ]);
  const inspect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      expect([
        "client",
        "flow",
        "label",
        "taker",
        "address",
        "tokenIn",
        "tokenOut",
        "ip",
        "signer",
        "key",
      ]).not.toContain(key);
      inspect(child);
    }
  };
  inspect(snapshot);
  expect(JSON.stringify(snapshot)).not.toContain(TAKER);
  expect(snapshot?.request.baseQuantity).toBe(1000);
  expect(snapshot?.market.fused.sourceCount).toBe(4);
  expect(snapshot?.market.history["hashkey-global"]).toHaveLength(1);
  engine.ingest(
    "HSK/USDT",
    [{ venue: "gate", book: { bids: [[0.11, 1]], asks: [[0.1, 1]] }, error: null }],
    now + 61_000,
  );
  await engine.quote(
    {
      taker: TAKER,
      tokenIn: tokens.USDT.address,
      tokenOut: tokens.WHSK.address,
      amountIn: usdt(100),
    },
    "sdk",
    now + 61_000,
  );
  const later = captured.at(-1);
  expect(later?.market.history["hashkey-global"]).toEqual([]);
  expect(later?.market.venues.find((venue) => venue.venue === "gate")?.mid).toBeNull();
  expect(later?.market.fused.sourceCount).toBe(3);
});
