import { describe, expect, test } from "bun:test";
import { quoteDomain, quoteTypes } from "@zethos/shared";
import { createPublicClient, custom, encodeFunctionResult, type Hex, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  type QuoteResponse,
  type SignedQuote,
  toContractQuote,
  type VerifyOptions,
  vaultAbi,
  verifyQuote,
  verifyQuoteSignature,
} from "../src/index.js";
import {
  otherSigner,
  paperQuoteBody,
  request,
  signedQuote,
  signer,
  VAULT,
  vaultQuoteBody,
} from "./fixtures.js";

describe("verifyQuoteSignature (ported)", () => {
  const fixedSigner = privateKeyToAccount(`0x${"01".repeat(32)}`);
  const otherFixed = privateKeyToAccount(`0x${"02".repeat(32)}`);
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
    const signature = await fixedSigner.signTypedData({
      domain: { ...quoteDomain, chainId: 133, verifyingContract: VAULT },
      types: quoteTypes,
      primaryType: "Quote",
      message: toContractQuote(quote),
    });
    const input = { quote, signature, signer: fixedSigner.address, vault: VAULT, chainId: 133 };
    expect(await verifyQuoteSignature(input)).toBe(true);
    expect(toContractQuote(quote).amountOut).toBe(12000000000000000001n);

    for (const change of [
      { chainId: 177 },
      { vault: otherFixed.address },
      { signer: otherFixed.address },
      { quote: { ...quote, taker: otherFixed.address } },
      { quote: { ...quote, amountOut: "12000000000000000002" } },
      { quote: { ...quote, nonce: "38" } },
    ]) {
      expect(await verifyQuoteSignature({ ...input, ...change })).toBe(false);
    }
  });

  test("rejects a malformed signature instead of throwing", async () => {
    const input = {
      quote,
      signature: "0x1234" as Hex,
      signer: fixedSigner.address,
      vault: VAULT,
      chainId: 133,
    };
    expect(await verifyQuoteSignature(input)).toBe(false);
  });
});

const paperOptions: VerifyOptions = {
  chainId: 133,
  status: { signer: signer.address, verifyingContract: zeroAddress },
};

async function reasons(quote: unknown, options = paperOptions, req = request) {
  return (await verifyQuote(quote as QuoteResponse, req, options)).reasons;
}

describe("verifyQuote: paper domain", () => {
  test("accepts a correctly signed paper quote with engine trust", async () => {
    expect(await verifyQuote(await paperQuoteBody(), request, paperOptions)).toEqual({
      ok: true,
      trust: "engine",
      reasons: [],
    });
  });

  test("a field changed after signing fails the signer check", async () => {
    const body = await paperQuoteBody();
    const tamper = (fields: Partial<SignedQuote>) => ({
      ...body,
      quote: { ...body.quote, ...fields },
    });
    const expiry = String(Number(body.quote.expiry) + 10);

    expect(await reasons(tamper({ taker: otherSigner.address }))).toEqual([
      "binding_mismatch",
      "bad_signer",
    ]);
    expect(
      await reasons({
        ...tamper({ amountOut: "1995000000000000000" }),
        paperOut: "1995000000000000000",
      }),
    ).toEqual(["bad_signer"]);
    expect(await reasons(tamper({ amountOut: "1995000000000000000" }))).toEqual([
      "display_mismatch",
      "bad_signer",
    ]);
    expect(await reasons(tamper({ nonce: "38" }))).toEqual(["bad_signer"]);
    expect(await reasons({ ...tamper({ expiry }), expiresAt: Number(expiry) })).toEqual([
      "bad_signer",
    ]);
  });

  test("a signature for another chain, signer or verifying contract fails", async () => {
    const quote = signedQuote();
    expect(await reasons(await paperQuoteBody(quote, { chainId: 177 }))).toEqual(["bad_signer"]);
    expect(await reasons(await paperQuoteBody(quote, { account: otherSigner }))).toEqual([
      "bad_signer",
    ]);
    expect(await reasons(await paperQuoteBody(quote, { vault: VAULT }))).toEqual(["bad_signer"]);
  });

  test("respects minRemainingSec and maxSpreadVsMid", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = await paperQuoteBody(
      signedQuote({ issuedAt: String(now - 26), expiry: String(now + 4) }),
    );
    expect(await reasons(body)).toEqual(["expired"]);
    expect(await reasons(body, { ...paperOptions, minRemainingSec: 1 })).toEqual([]);

    const wide = { ...(await paperQuoteBody()), spotOut: "2100000000000000000" };
    expect(await reasons(wide)).toEqual(["worse_than_reference"]);
    expect(await reasons(wide, { ...paperOptions, maxSpreadVsMid: 0.06 })).toEqual([]);
  });

  test("skips the pool comparison when there is no pool", async () => {
    const body = { ...(await paperQuoteBody()), poolOut: null, poolVenue: null };
    expect(await reasons(body)).toEqual([]);
  });

  test("short defensive paper quotes remain verifiable", async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = await paperQuoteBody(
      signedQuote({ issuedAt: String(now), expiry: String(now + 3) }),
    );
    expect(await reasons(body)).toEqual([]);
    expect(await reasons(body, { ...paperOptions, minRemainingSec: 5 })).toEqual(["expired"]);
  });

  test("never throws for malformed quotes", async () => {
    const body = await paperQuoteBody();
    expect(await reasons({ ...body, quote: { ...body.quote, amountOut: "1e18" } })).toEqual([
      "out_of_bounds",
    ]);
    expect(
      await reasons({ ...body, quote: { ...body.quote, nonce: (1n << 256n).toString() } }),
    ).toEqual(["out_of_bounds"]);
    expect(await reasons({ ...body, quote: undefined })).toEqual(["out_of_bounds"]);
    expect(await reasons({ ...body, spotOut: "abc" })).toEqual(["worse_than_reference"]);
    expect(await reasons({ ...body, signature: "not hex" })).toEqual(["bad_signature_format"]);
    const unbound = await verifyQuote(body, undefined, paperOptions);
    expect(unbound.reasons).toEqual(["binding_mismatch"]);
    const zero = await paperQuoteBody(signedQuote({ amountOut: "0" }));
    expect(await reasons({ ...zero, spotOut: "0", poolOut: null })).toEqual(["out_of_bounds"]);
  });
});

function chainClient({ code = "0x6080", quoteSigner = signer.address } = {}) {
  const calls: string[] = [];
  const publicClient = createPublicClient({
    transport: custom({
      async request({ method }: { method: string }) {
        calls.push(method);
        if (method === "eth_getCode") return code;
        if (method === "eth_call") {
          return encodeFunctionResult({
            abi: vaultAbi,
            functionName: "quoteSigner",
            result: quoteSigner,
          });
        }
        throw new Error(`unexpected ${method}`);
      },
    }),
  });
  return { publicClient, calls };
}

describe("verifyQuote: conduit (live) route", () => {
  const liveStatus = { signer: otherSigner.address, verifyingContract: VAULT };

  test("reads the signer from the vault, ignoring the engine's claimed signer", async () => {
    const { publicClient, calls } = chainClient();
    const result = await verifyQuote(await vaultQuoteBody(), request, {
      chainId: 133,
      status: liveStatus,
      publicClient,
    });
    expect(result).toEqual({ ok: true, trust: "chain", reasons: [] });
    expect(calls).toEqual(["eth_getCode", "eth_call"]);
  });

  test("fails without a public client, without bytecode, or with a different on-chain signer", async () => {
    const body = await vaultQuoteBody();
    const base = { chainId: 133, status: liveStatus };
    expect(await reasons(body, base)).toEqual(["bad_signer"]);
    expect(
      await reasons(body, { ...base, publicClient: chainClient({ code: "0x" }).publicClient }),
    ).toEqual(["bad_signer"]);
    const wrongSigner = chainClient({ quoteSigner: otherSigner.address }).publicClient;
    expect(await reasons(body, { ...base, publicClient: wrongSigner })).toEqual(["bad_signer"]);
    const zeroVault = { ...base, status: { ...liveStatus, verifyingContract: zeroAddress } };
    expect(await reasons(body, { ...zeroVault, publicClient: chainClient().publicClient })).toEqual(
      ["bad_signer"],
    );
  });

  test("a paper-domain signature is never valid for the vault", async () => {
    const quote = signedQuote();
    const body = await vaultQuoteBody(quote, { vault: zeroAddress });
    const options = { chainId: 133, status: liveStatus, publicClient: chainClient().publicClient };
    expect(await reasons(body, options)).toEqual(["bad_signer"]);
  });

  test("checks conduitOut and the HSKSwap reference", async () => {
    const body = await vaultQuoteBody();
    const options = { chainId: 133, status: liveStatus, publicClient: chainClient().publicClient };
    expect(await reasons({ ...body, conduitOut: "1" }, options)).toEqual(["display_mismatch"]);
    expect(await reasons({ ...body, hskswapOut: "1990000000000000001" }, options)).toEqual([
      "worse_than_reference",
    ]);
  });
});
