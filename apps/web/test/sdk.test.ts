import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { ZethosError } from "@zethos/sdk";
import { failureMessage } from "../src/lib/engine/sdk";

describe("engine refusal messages", () => {
  for (const message of [
    "Amount is above this route's limit",
    "The vault is not taking this side right now",
  ]) {
    test(`preserves capacity refusal: ${message}`, () => {
      assert.equal(failureMessage(new ZethosError("vault_capacity", message, 409)), message);
    });
  }

  test("preserves the mandate refusal", () => {
    const message = "Amount is under the mandate minimum";
    assert.equal(failureMessage(new ZethosError("mandate_breach", message, 409)), message);
  });

  test("preserves a readable invalid request", () => {
    assert.equal(
      failureMessage(new ZethosError("invalid_request", "Pick different tokens")),
      "Pick different tokens",
    );
  });

  test("uses known fallback text for empty refusals", () => {
    assert.equal(
      failureMessage(new ZethosError("vault_capacity", "  ")),
      "This amount is above the vault’s current capacity. Try a smaller amount.",
    );
    assert.equal(
      failureMessage(new ZethosError("mandate_breach", "")),
      "This trade is outside the desk’s mandate.",
    );
  });

  for (const error of [
    new ZethosError("unknown_failure", "Internal implementation details"),
    new ZethosError("toString", "Internal implementation details"),
    new Error("Internal implementation details"),
    null,
  ]) {
    test(`uses safe generic text for ${String(error)}`, () => {
      assert.equal(failureMessage(error), "Something went wrong. Nothing was filled by this step.");
    });
  }
});
