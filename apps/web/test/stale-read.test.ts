import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isStaleAllowance, retryWhileAllowanceLags } from "../src/lib/engine/stale-read";

const lagging = new Error('The contract function "fill" reverted with signature: 0xfb8f41b2');

describe("stale allowance reads", () => {
  test("recognises the allowance error, by name or by selector", () => {
    assert.equal(isStaleAllowance(lagging), true);
    assert.equal(isStaleAllowance(new Error("ERC20InsufficientAllowance(a, 1, 2)")), true);
    assert.equal(isStaleAllowance(new Error("wrapper", { cause: lagging })), true);
  });

  test("ignores everything else", () => {
    assert.equal(isStaleAllowance(new Error("QuoteExpired")), false);
    assert.equal(isStaleAllowance("0xfb8f41b2"), false);
  });

  test("retries until the node catches up", async () => {
    let calls = 0;
    const result = await retryWhileAllowanceLags(
      async () => {
        calls += 1;
        if (calls < 3) throw lagging;
        return "simulated";
      },
      { delayMs: 0 },
    );
    assert.equal(result, "simulated");
    assert.equal(calls, 3);
  });

  test("does not retry a real revert", async () => {
    let calls = 0;
    const failure = new Error("QuoteExpired");
    await assert.rejects(
      retryWhileAllowanceLags(
        async () => {
          calls += 1;
          throw failure;
        },
        { delayMs: 0 },
      ),
      (error) => error === failure,
    );
    assert.equal(calls, 1);
  });

  test("gives up after the last attempt with the original error", async () => {
    let calls = 0;
    await assert.rejects(
      retryWhileAllowanceLags(
        async () => {
          calls += 1;
          throw lagging;
        },
        { attempts: 3, delayMs: 0 },
      ),
      (error) => error === lagging,
    );
    assert.equal(calls, 3);
  });

  test("stops when the caller says the quote is no longer usable", async () => {
    const expired = new Error("nearly expired");
    await assert.rejects(
      retryWhileAllowanceLags(
        async () => {
          throw lagging;
        },
        {
          delayMs: 0,
          beforeRetry: () => {
            throw expired;
          },
        },
      ),
      (error) => error === expired,
    );
  });
});
