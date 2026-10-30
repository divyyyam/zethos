import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { englishQuote, interpretEnglish, preparedIntent } from "../src/lib/agent/english";

const address = "0x1111111111111111111111111111111111111111";
describe("English quote requests", () => {
  for (const sentence of [
    "How much HSK can I get for $500?",
    "What would I get if I spent 500 dollars on HSK?",
    "Could you quote me 500 USDT into HSK please?",
  ]) {
    test(sentence, () => {
      const intent = englishQuote(sentence);
      assert.ok(intent);
      assert.deepEqual(
        {
          pair: intent.pair,
          side: intent.side,
          amount: intent.amount,
          amountIn: intent.amountIn,
          dryRun: intent.dryRun,
        },
        { pair: "HSK/USDT", side: "buy", amount: "500", amountIn: "quote", dryRun: true },
      );
    });
  }
  test("selling is quoted in the stated base units", () => {
    const intent = englishQuote("Give me a price for selling 0.1 ETH.");
    assert.ok(intent);
    assert.equal(intent.side, "sell");
    assert.equal(intent.amount, "0.1");
    assert.equal(intent.amountIn, "base");
    assert.equal(intent.dryRun, true);
  });
  test("does not drop an unparsed condition or second action", () => {
    assert.equal(englishQuote("How much HSK can I get for $500 only if it drops 1%?"), null);
    assert.equal(englishQuote("How much HSK can I get for $500 and sell 1 ETH?"), null);
  });
  test("model interpretations preserve units and all guards; malformed proposals are refused", async () => {
    const intent = {
      kind: "swap",
      pair: "ETH/USDT",
      side: "buy",
      amount: "0.5",
      amountIn: "base",
      dryRun: false,
      slices: { count: 3, durationMs: 60000 },
      trigger: { type: "below", price: 2000 },
      maxCostBps: 50,
      expiresInMs: 300000,
    };
    const interpreted = await interpretEnglish(
      "I'd like half an ether in three parts, below 2,000, within fifty basis points. Give up after five minutes.",
      address,
      {
        chat: async () => ({
          reply: "Review your interpreted plan.",
          cards: [{ type: "quote", data: { intent } }],
        }),
      },
    );
    assert.deepEqual(interpreted, intent);
    assert.equal(preparedIntent({ ...intent, amount: "-1" }), null);
    assert.equal(preparedIntent({ ...intent, pair: "BTC/USDT" }), null);
    assert.equal(preparedIntent({ ...intent, slices: { count: 999, durationMs: 60000 } }), null);
  });
  test("an ambiguous English request returns the assistant's clarification", async () => {
    await assert.rejects(
      interpretEnglish("Get me some crypto", address, {
        chat: async () => ({
          reply: "Which asset and how much would you like to spend?",
          cards: [],
        }),
      }),
      /Which asset/,
    );
  });
});
