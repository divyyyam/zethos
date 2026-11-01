import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { PaperQuote, Status } from "@zethos/sdk";
import { type Attempt, rotateIdentity, runAttack, shouldFill } from "../src/lib/arena/attack";

test("mode rules require a moved, favourable mid only for sniper", () => {
  assert.equal(shouldFill("naive", "buy", 101, 100, 99), true);
  assert.equal(shouldFill("rotating", "buy", 101, 100, null), true);
  assert.equal(shouldFill("sniper", "buy", 101, 100, 100.5), false);
  assert.equal(shouldFill("sniper", "buy", 101, 100, 102), true);
  assert.equal(shouldFill("sniper", "sell", 99, 100, 98), true);
  assert.equal(shouldFill("sniper", "sell", 99, 100, 100), false);
  assert.equal(shouldFill("sniper", "sell", 99, 100, null), false);
  assert.equal(rotateIdentity("rotating", 3), true);
  assert.equal(rotateIdentity("rotating", 0), false);
  assert.equal(rotateIdentity("rotating", 2), false);
  assert.equal(rotateIdentity("naive", 3), false);
});

test("fake engine: 30 quotes per minute and rotation only after three fills", async () => {
  let now = 0;
  let identities = 0;
  const requests: Array<{ taker: string; time: number }> = [];
  const results: Attempt[] = [];
  await runAttack({
    mode: "rotating",
    pair: "HSK/USDT",
    signal: new AbortController().signal,
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    identity: () => `0x${String(++identities).padStart(40, "0")}`,
    onAttempt: (attempt) => {
      if (attempt.outcome !== "quoted") results.push(attempt);
    },
    engine: {
      status: async () =>
        ({
          pairs: [
            {
              pair: "HSK/USDT",
              mid: 1,
              halted: false,
              base: { decimals: 6 },
              quote: { decimals: 6 },
            },
          ],
        }) as Status,
      arenaQuote: async (input) => {
        requests.push({ taker: input.taker, time: now });
        return {
          route: "paper",
          quote: {
            amountIn: "25000000",
            amountOut: "24900000",
            expiry: String((now + 5000) / 1000),
          },
          breakdown: { mid: 1 },
        } as PaperQuote;
      },
      arenaFill: async () => ({ paper: true }) as never,
    },
  });
  assert.equal(requests.length, 30);
  assert.equal(results.filter((a) => a.outcome === "filled").length, 30);
  assert.equal(requests[0]?.taker, requests[2]?.taker);
  assert.notEqual(requests[2]?.taker, requests[3]?.taker);
  assert.ok(requests.every((r, i) => i === 0 || r.time - (requests[i - 1]?.time ?? 0) >= 2000));
});

test("Stop during quote never calls paper settlement", async () => {
  const control = new AbortController();
  let fills = 0;
  const attempts: Attempt[] = [];
  await runAttack({
    mode: "naive",
    pair: "HSK/USDT",
    signal: control.signal,
    onAttempt: (a) => attempts.push(a),
    engine: {
      status: async () =>
        ({
          pairs: [{ pair: "HSK/USDT", mid: 1, base: { decimals: 6 }, quote: { decimals: 6 } }],
        }) as Status,
      arenaQuote: async () => {
        control.abort();
        return {
          route: "paper",
          quote: {
            amountIn: "25000000",
            amountOut: "24900000",
            expiry: String(Date.now() / 1000 + 5),
          },
          breakdown: { mid: 1 },
        } as PaperQuote;
      },
      arenaFill: async () => {
        fills++;
        return {} as never;
      },
    },
  });
  assert.equal(fills, 0);
  assert.equal(attempts.at(-1)?.outcome, "declined");
});

test("fake engine: sniper declines without a favourable mid before expiry", async () => {
  let now = 0;
  let fills = 0;
  const results: Attempt[] = [];
  await runAttack({
    mode: "sniper",
    pair: "HSK/USDT",
    signal: new AbortController().signal,
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    onAttempt: (a) => {
      if (a.outcome !== "quoted") results.push(a);
    },
    engine: {
      status: async () =>
        ({
          pairs: [{ pair: "HSK/USDT", mid: 1, base: { decimals: 6 }, quote: { decimals: 6 } }],
        }) as Status,
      arenaQuote: async () =>
        ({
          route: "paper",
          quote: {
            amountIn: "25000000",
            amountOut: "24900000",
            expiry: String(Math.floor(now / 1000) + 5),
          },
          breakdown: { mid: 1 },
        }) as PaperQuote,
      arenaFill: async () => {
        fills++;
        return {} as never;
      },
    },
  });
  assert.equal(fills, 0);
  assert.ok(results.length > 0);
  assert.ok(results.every((a) => a.outcome === "declined"));
  assert.equal(now, 60_000);
});
