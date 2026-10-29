import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteDomain, quoteTypes } from "@zethos/shared";
import { privateKeyToAccount } from "viem/accounts";
import type { SignedQuote } from "../src/lib/engine/types";
import { toContractQuote, verifyQuoteSignature } from "../src/lib/engine/verify-quote";

// Public, deterministic test-only keys. No wallet or RPC is involved.
const signer = privateKeyToAccount(`0x${"01".repeat(32)}`);
const otherSigner = privateKeyToAccount(`0x${"02".repeat(32)}`);
const vault = "0x4444444444444444444444444444444444444444";
const quote: SignedQuote = {
  taker: "0x1111111111111111111111111111111111111111",
  tokenIn: "0x2222222222222222222222222222222222222222",
  tokenOut: "0x3333333333333333333333333333333333333333",
  amountIn: "1000000",
  amountOut: "12000000000000000001",
  nonce: "37",
  issuedAt: "1800000000",
  expiry: "1800000030",
};

test("authenticates a real EIP-712 signature for the correct deployment", async () => {
  const signature = await signer.signTypedData({
    domain: { ...quoteDomain, chainId: 133, verifyingContract: vault },
    types: quoteTypes,
    primaryType: "Quote",
    message: toContractQuote(quote),
  });
  const input = { quote, signature, signer: signer.address, vault, chainId: 133 } as const;
  assert.equal(await verifyQuoteSignature(input), true);
  assert.equal(toContractQuote(quote).amountOut, 12000000000000000001n);

  for (const change of [
    { chainId: 177 },
    { vault: otherSigner.address },
    { signer: otherSigner.address },
    { quote: { ...quote, taker: otherSigner.address } },
    { quote: { ...quote, amountOut: "12000000000000000002" } },
    { quote: { ...quote, nonce: "38" } },
  ]) {
    assert.equal(await verifyQuoteSignature({ ...input, ...change }), false);
  }
});

test("rejects a malformed signature instead of opening a transaction path", async () => {
  assert.equal(
    await verifyQuoteSignature({
      quote,
      signature: "0x1234",
      signer: signer.address,
      vault,
      chainId: 133,
    }),
    false,
  );
});
