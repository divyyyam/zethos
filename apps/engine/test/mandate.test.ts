import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { initialState } from "../src/agent/types";
import { defaultParams, type Params } from "../src/config";
import type { Store } from "../src/db";
import { memoryStore } from "../src/db/memory";
import { Engine } from "../src/engine";
import { createV0, type Policy, type PolicyQuote } from "../src/policy";
import { defaultMandate } from "../src/policy/mandate";
import { bookAround, MIDS, SIGNER_KEY, TAKER, tokens, usdt, whsk } from "./helpers";

const NOW = 1_800_000_000_000;
const buyHsk = (amount = 100) => ({
  taker: TAKER,
  tokenIn: tokens.USDT.address,
  tokenOut: tokens.WHSK.address,
  amountIn: usdt(amount),
});

function candidate(overrides: Partial<PolicyQuote> = {}): Policy {
  return {
    id: "test-candidate",
    decide(market, _inventory, request) {
      const halfSpread = 0.002;
      const ref = market.fused.mid;
      return {
        kind: "quote",
        ref,
        price: ref * (request.side === "buy" ? 1 + halfSpread : 1 - halfSpread),
        halfSpread,
        sigmaT: 0,
        ttlSec: 3,
        terms: { base: halfSpread },
        ...overrides,
      };
    },
  };
}

async function ready(
  options: { mandate?: unknown; params?: Params; policy?: Policy; store?: Store } = {},
) {
  const params = options.params ?? structuredClone(defaultParams);
  const store = options.store ?? memoryStore();
  const deps = {
    chainId: 177 as const,
    params,
    tokens,
    store,
    signer: privateKeyToAccount(SIGNER_KEY),
    mandate: options.mandate ?? defaultMandate,
    ...(options.policy ? { policy: options.policy } : {}),
  };
  const engine = new Engine(deps);
  await engine.init();
  for (const pair of params.pairs) {
    engine.ingest(
      pair,
      params.feeds.sources[pair].map((venue) => ({
        venue,
        book: bookAround(MIDS[pair], pair === "HSK/USDT" ? 1_000_000 : 50),
        error: null,
      })),
      NOW,
    );
  }
  await engine.ensureArena(NOW);
  return { engine, store };
}

async function rejects(promise: Promise<unknown>, code: string, status = 422) {
  await expect(promise).rejects.toMatchObject({ code, status });
}

test("startup validates and snapshots the mandate; rejected quotes persist every breach", async () => {
  const invalid = structuredClone(defaultMandate);
  invalid.inventory.minShare = invalid.inventory.maxShare;
  await expect(ready({ mandate: invalid })).rejects.toThrow("Invalid desk mandate");

  const mandate = structuredClone(defaultMandate);
  mandate.service.minQuoteNotionalUsd = 200;
  const { engine, store } = await ready({ mandate });
  mandate.service.minQuoteNotionalUsd = 5;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await rejects(engine.quote(buyHsk(100), "sdk", NOW), "mandate_breach");
    const persisted = (await store.loadState(1))?.decisions.filter(
      (d) => d.type === "mandate_breach",
    );
    expect(persisted).toHaveLength(attempt);
    expect(persisted?.at(-1)?.inputs.rule).toBe("minimum_notional");
    expect(persisted?.at(-1)?.inputs.limit).toBe(200);
    expect(await store.loadQuotes(1)).toHaveLength(0);
  }
  expect(engine.decisions(10, "mandate_breach")).toHaveLength(2);
});

test("service buckets cap the actual fused-mid spread, including a policy's shifted reference", async () => {
  const mandate = structuredClone(defaultMandate);
  mandate.service.maxHalfSpreadBps = [
    { maxNotionalUsd: 100, maxBps: 10 },
    { maxNotionalUsd: 1000, maxBps: 50 },
  ];
  const { engine, store } = await ready({ mandate, policy: candidate() });
  await rejects(engine.quote(buyHsk(100), "sdk", NOW), "mandate_breach");
  const accepted = await engine.quote(buyHsk(101), "sdk", NOW);
  expect(accepted.response.vsMidBps).toBeCloseTo(20, 2);
  await rejects(engine.quote(buyHsk(1001), "sdk", NOW), "mandate_breach");
  expect(await store.loadQuotes(1)).toHaveLength(1);

  const shiftedRef = MIDS["HSK/USDT"] * 1.01;
  const shifted = await ready({
    mandate,
    policy: candidate({ ref: shiftedRef, halfSpread: 0.0005, price: shiftedRef * 1.0005 }),
  });
  await rejects(shifted.engine.quote(buyHsk(101), "sdk", NOW), "mandate_breach");
  expect(shifted.engine.decisions(1, "mandate_breach")[0]?.inputs.rule).toBe("maximum_half_spread");
  expect(await shifted.store.loadQuotes(1)).toHaveLength(0);
});

test("a policy cannot quote a pair outside the desk mandate", async () => {
  const mandate = structuredClone(defaultMandate);
  mandate.pairs = ["HSK/USDT"];
  const { engine, store } = await ready({ mandate, policy: candidate() });
  await rejects(
    engine.quote({ ...buyHsk(), tokenOut: tokens.WETH.address }, "sdk", NOW),
    "mandate_breach",
  );
  expect(engine.decisions(1, "mandate_breach")[0]?.inputs.rule).toBe("pair");
  expect(await store.loadQuotes(1)).toHaveLength(0);
});

test("issuance checks projected inventory for the traded pair and the pair sharing USDT", async () => {
  const tight = structuredClone(defaultMandate);
  tight.inventory = { minShare: 0.49, maxShare: 0.51 };
  const own = await ready({ mandate: tight, policy: candidate() });
  await rejects(own.engine.quote(buyHsk(1000), "sdk", NOW), "mandate_breach");
  expect(own.engine.decisions(1, "mandate_breach")[0]?.pair).toBe("HSK/USDT");
  expect(await own.store.loadQuotes(1)).toHaveLength(0);
  const outstanding = (await own.engine.quote(buyHsk(600), "sdk", NOW)).response;
  await rejects(own.engine.quote(buyHsk(600), "sdk", NOW), "mandate_breach");
  expect(await own.store.loadQuotes(1)).toHaveLength(1);
  const filled = await own.engine.paperFill(
    { quote: outstanding.quote, signature: outstanding.signature },
    "sdk",
    NOW + 1,
  );
  expect(filled.quoteId).toBe(outstanding.id);

  const expiring = await ready({ mandate: tight, policy: candidate() });
  const first = (await expiring.engine.quote(buyHsk(600), "sdk", NOW)).response;
  const lastValidMs = Number(first.quote.expiry) * 1000 + 999;
  await rejects(expiring.engine.quote(buyHsk(600), "sdk", lastValidMs), "mandate_breach");
  expect(await expiring.store.loadQuotes(1)).toHaveLength(1);
  await expiring.engine.quote(buyHsk(600), "sdk", lastValidMs + 1);
  expect(await expiring.store.loadQuotes(1)).toHaveLength(2);

  const store = memoryStore();
  const inventory = {
    USDT: BigInt(usdt(50_000)),
    WHSK: BigInt(whsk(250_000)),
    WETH: 3_600_000_000_000_000_000n,
  };
  const arena = await store.startArena(NOW, inventory);
  await store.saveState(initialState(arena.epoch, 85_800));
  const shared = structuredClone(defaultMandate);
  shared.inventory = { minShare: 0.3, maxShare: 0.7 };
  const other = await ready({ store, mandate: shared, policy: candidate() });
  // HSK remains comfortably inside the band; the extra USDT pushes ETH below 30%.
  await rejects(other.engine.quote(buyHsk(1000), "sdk", NOW), "mandate_breach");
  const breach = other.engine.decisions(1, "mandate_breach")[0];
  expect(breach?.pair).toBe("ETH/USDT");
  expect(breach?.inputs.rule).toBe("inventory_min");
  expect(await store.loadQuotes(1)).toHaveLength(0);
});

test("gas-inclusive operating loss pauses the next quote and survives restart and operator resume", async () => {
  const mandate = structuredClone(defaultMandate);
  mandate.loss.maxOperatingLossUsd = 10;
  const { engine, store } = await ready({ mandate, policy: candidate() });
  await engine.tick(NOW, 10n ** 15n);
  const { response } = await engine.quote(buyHsk(), "sdk", NOW);
  const fill = await engine.paperFill(
    { quote: response.quote, signature: response.signature },
    "sdk",
    NOW + 1,
  );
  expect(fill.gasUsd).toBeCloseTo(15, 8);
  expect(engine.status().equityUsd).toBeGreaterThan(100_000);
  expect(engine.status().paused).toBe(false);
  await rejects(engine.quote(buyHsk(), "sdk", NOW + 2), "paused", 503);
  expect(engine.status().paused).toBe(true);
  const checkpoint = await store.loadState(1);
  expect(checkpoint?.paused).toBe(true);
  expect(checkpoint?.decisions.at(-1)?.inputs.rule).toBe("operating_loss");
  expect(await store.loadQuotes(1)).toHaveLength(1);
  const stops = engine.decisions(100, "mandate_breach").length;
  let repeatedWrites = 0;
  const saveState = store.saveState;
  store.saveState = async (state) => {
    repeatedWrites++;
    await saveState(state);
  };
  await rejects(engine.quote(buyHsk(), "sdk", NOW + 2), "paused", 503);
  await rejects(engine.quote(buyHsk(), "sdk", NOW + 2), "paused", 503);
  expect(engine.decisions(100, "mandate_breach")).toHaveLength(stops);
  expect(repeatedWrites).toBe(0);
  store.saveState = saveState;

  const restarted = await ready({ store, mandate, policy: candidate() });
  expect(restarted.engine.status().paused).toBe(true);
  await restarted.engine.pause(TAKER, false, NOW + 3);
  await rejects(restarted.engine.quote(buyHsk(), "sdk", NOW + 4), "paused", 503);
  const resumed = await store.loadState(1);
  expect(resumed?.initialEquity).toBe(checkpoint?.initialEquity);
  expect(resumed?.gasUsd).toBe(checkpoint?.gasUsd);
  expect(resumed?.paused).toBe(true);
});

test("inventory changes do not revoke firm quotes while an explicit pause still blocks settlement", async () => {
  const mandate = structuredClone(defaultMandate);
  mandate.inventory = { minShare: 0.49, maxShare: 0.51 };
  const { engine } = await ready({ mandate, policy: candidate() });
  const first = (await engine.quote(buyHsk(), "sdk", NOW)).response;
  const second = (await engine.quote(buyHsk(), "sdk", NOW)).response;
  engine.ingest(
    "HSK/USDT",
    defaultParams.feeds.sources["HSK/USDT"].map((venue) => ({
      venue,
      book: bookAround(0.095, 1_000_000),
      error: null,
    })),
    NOW + 1,
  );
  await rejects(engine.quote(buyHsk(), "sdk", NOW + 2), "mandate_breach");
  const filled = await engine.paperFill(
    { quote: first.quote, signature: first.signature },
    "sdk",
    NOW + 3,
  );
  expect(filled.quoteId).toBe(first.id);
  expect(await engine.fills(TAKER, 10)).toHaveLength(1);
  await engine.pause(TAKER, true, NOW + 4);
  await rejects(
    engine.paperFill({ quote: second.quote, signature: second.signature }, "sdk", NOW + 5),
    "paused",
    503,
  );
});

test("candidate TTL cannot exceed the tier, configured lifetime or hard 120-second limit", async () => {
  const tier = await ready({ policy: candidate({ ttlSec: 11 }) });
  await rejects(tier.engine.quote(buyHsk(), "sdk", NOW), "policy_invalid");
  expect(await tier.store.loadQuotes(1)).toHaveLength(0);

  const params = structuredClone(defaultParams);
  params.quote.ttlSec = 5;
  const configured = await ready({ params, policy: candidate({ ttlSec: 6 }) });
  await rejects(configured.engine.quote(buyHsk(), "sdk", NOW), "policy_invalid");
  expect(await configured.store.loadQuotes(1)).toHaveLength(0);

  const hardParams = structuredClone(defaultParams);
  hardParams.quote.ttlSec = 120;
  hardParams.toxicity.tiers.probation.ttlSec = 120;
  const hard = await ready({ params: hardParams, policy: candidate({ ttlSec: 121 }) });
  await rejects(hard.engine.quote(buyHsk(), "sdk", NOW), "policy_invalid");
  expect(await hard.store.loadQuotes(1)).toHaveLength(0);
});

test("invalid numerical policy outputs never produce a signed quote", async () => {
  for (const output of [
    { price: NaN },
    { price: 0 },
    { price: MIDS["HSK/USDT"] * 1.1 },
    { ref: Infinity },
    { halfSpread: -0.01 },
    { halfSpread: 1 },
    { sigmaT: NaN },
    { ttlSec: 0 },
    { ttlSec: 3.5 },
    { terms: { base: Infinity } },
  ]) {
    const { engine, store } = await ready({ policy: candidate(output) });
    await rejects(engine.quote(buyHsk(), "sdk", NOW), "policy_invalid");
    expect(await store.loadQuotes(1)).toHaveLength(0);
  }
});

test("a policy cannot invent an adverse reference on either side", async () => {
  for (const side of ["buy", "sell"] as const) {
    const ref = MIDS["HSK/USDT"] * (side === "buy" ? 0.5 : 2);
    const { engine, store } = await ready({
      policy: candidate({ ref, price: ref * (side === "buy" ? 1.002 : 0.998) }),
    });
    const request =
      side === "buy"
        ? buyHsk()
        : {
            taker: TAKER,
            tokenIn: tokens.WHSK.address,
            tokenOut: tokens.USDT.address,
            amountIn: whsk(1000),
          };
    await rejects(engine.quote(request, "sdk", NOW), "policy_invalid");
    expect(await store.loadQuotes(1)).toHaveLength(0);
  }
});

test("a candidate may choose its own volatility TTL within execution limits", async () => {
  const policy = candidate({ ttlSec: 10 });
  const v0 = createV0(defaultParams);
  let incumbentTtl = 0;
  const { engine } = await ready({
    policy: {
      id: policy.id,
      decide(market, inventory, request) {
        const incumbent = v0.decide(market, inventory, request);
        if (incumbent.kind === "quote") incumbentTtl = incumbent.ttlSec;
        return policy.decide(market, inventory, request);
      },
    },
  });
  for (const pair of defaultParams.pairs)
    engine.ingest(
      pair,
      defaultParams.feeds.sources[pair].map((venue) => ({
        venue,
        book: bookAround(MIDS[pair] * 1.005, 1_000_000),
        error: null,
      })),
      NOW + 1000,
    );
  const { response } = await engine.quote(buyHsk(), "sdk", NOW + 1000);
  expect(response.breakdown.ttlSec).toBe(10);
  expect(incumbentTtl).toBeLessThan(10);
});

test("candidate authority cannot bypass the existing probation size cap or blocked tier", async () => {
  const { engine, store } = await ready({ policy: candidate() });
  await rejects(engine.quote(buyHsk(6251), "sdk", NOW), "vault_capacity");
  expect(await store.loadQuotes(1)).toHaveLength(0);
  const accepted = await engine.quote(buyHsk(6250), "sdk", NOW);
  expect(accepted.response.breakdown.tier).toBe("probation");
  await engine.setTaker(TAKER, TAKER, { tier: "blocked" }, NOW + 1);
  await rejects(engine.quote(buyHsk(), "sdk", NOW + 2), "taker_restricted", 403);
  expect(await store.loadQuotes(1)).toHaveLength(1);
});
