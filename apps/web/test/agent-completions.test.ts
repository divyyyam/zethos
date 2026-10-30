import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { completions, ghostOf, MODIFIERS } from "../src/lib/agent/completions";
import { parseIntent } from "../src/lib/agent/intent";

describe("completions", () => {
  test("keeps the user's own number", () => {
    assert.deepEqual(completions("buy 750").slice(0, 2), [
      "buy 750 USDT of HSK",
      "buy 750 USDT of ETH",
    ]);
    assert.equal(completions("sell 3")[0], "sell 3 HSK");
  });
  test("finishes a half-typed pair", () => {
    assert.equal(completions("buy 500 usdt")[0], "buy 500 usdt of HSK");
    assert.equal(completions("buy 500 usdt of")[0], "buy 500 usdt of HSK");
  });
  test("a finished swap is offered its next clause, and not one it already has", () => {
    assert.ok(completions("buy 500 usdt of hsk").includes("buy 500 usdt of hsk over 2 minutes"));
    assert.ok(
      !completions("buy 500 usdt of hsk over 1 minute").some((c) => /over 2 minutes/.test(c)),
    );
  });
  test("every sentence it offers for these inputs parses", () => {
    for (const typed of [
      "buy 750",
      "sell 3",
      "buy 500 usdt",
      "buy 500 usdt of hsk",
      "sc",
      "why",
      "fl",
    ]) {
      for (const sentence of completions(typed))
        assert.notEqual(parseIntent(sentence).intent.kind, "unknown", sentence);
    }
  });
  test("nothing for an empty prompt, and never the text itself", () => {
    assert.deepEqual(completions("   "), []);
    assert.ok(!completions("Scan HSK depth").includes("Scan HSK depth"));
  });
  test("the ghost only continues what was typed", () => {
    assert.equal(ghostOf("buy 7", ["buy 750 USDT of HSK"]), "50 USDT of HSK");
    assert.equal(ghostOf("depth", ["Scan HSK depth"]), "");
    assert.equal(ghostOf("", ["Help"]), "");
  });
});

describe("modifier chips", () => {
  const base = "Buy 500 USDT of HSK";
  for (const modifier of MODIFIERS) {
    test(`${modifier.label} writes a sentence that still parses, and undoes itself`, () => {
      const on = modifier.apply(base);
      assert.equal(parseIntent(on).intent.kind, "swap", on);
      assert.ok(modifier.test.test(on));
      const off = modifier.remove(on);
      assert.equal(off, base);
    });
  }
  test("they combine", () => {
    let text = base;
    for (const modifier of MODIFIERS) text = modifier.apply(text);
    const { intent } = parseIntent(text);
    assert.equal(intent.kind, "swap", text);
    if (intent.kind !== "swap") return;
    assert.equal(intent.dryRun, true);
    assert.equal(intent.maxCostBps, 100);
    assert.ok(intent.slices);
    assert.ok(intent.trigger);
  });
});
