import { quoteDomain, quoteTypes } from "@zethos/shared";
import { type Address, type Hex, type LocalAccount, verifyTypedData, zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const UINT64_MAX = 2n ** 64n - 1n;
const UINT256_MAX = 2n ** 256n - 1n;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const uint = (max: bigint) =>
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .refine((value) => BigInt(value) <= max, "out of range");

export const quoteRequestSchema = z.object({
  taker: address,
  tokenIn: address,
  tokenOut: address,
  amountIn: uint(UINT256_MAX).refine((value) => value !== "0", "must be positive"),
});

export const signedQuoteSchema = z.object({
  taker: address,
  tokenIn: address,
  tokenOut: address,
  amountIn: uint(UINT256_MAX),
  amountOut: uint(UINT256_MAX),
  nonce: uint(UINT256_MAX),
  issuedAt: uint(UINT64_MAX),
  expiry: uint(UINT64_MAX),
});

export const fillRequestSchema = z.object({
  quote: signedQuoteSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type SignedQuote = z.infer<typeof signedQuoteSchema>;

// The paper signer only signs EIP-712 quotes for the zero-address domain. Without a configured
// key an ephemeral one is used, so outstanding quotes become unfillable after a restart.
export function paperSigner(key: Hex | null): LocalAccount {
  if (key) return privateKeyToAccount(key);
  console.warn("PAPER_SIGNER_KEY not set: using an ephemeral paper signer");
  const signer = privateKeyToAccount(generatePrivateKey());
  console.info(`Ephemeral paper signer address: ${signer.address}`);
  return signer;
}

const fields = [
  "taker",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "nonce",
  "issuedAt",
  "expiry",
] as const;

export function sameQuote(a: SignedQuote, b: SignedQuote): boolean {
  return fields.every((field) => a[field].toLowerCase() === b[field].toLowerCase());
}

// Shadow mode signs against the zero address, so a paper signature can never fill a real vault.
export function paperDomain(chainId: number) {
  return { ...quoteDomain, chainId, verifyingContract: zeroAddress };
}

export function contractQuote(quote: SignedQuote) {
  return {
    taker: quote.taker as Address,
    tokenIn: quote.tokenIn as Address,
    tokenOut: quote.tokenOut as Address,
    amountIn: BigInt(quote.amountIn),
    amountOut: BigInt(quote.amountOut),
    nonce: BigInt(quote.nonce),
    issuedAt: BigInt(quote.issuedAt),
    expiry: BigInt(quote.expiry),
  };
}

export function signQuote(signer: LocalAccount, chainId: number, quote: SignedQuote): Promise<Hex> {
  if (!signer.signTypedData) throw new Error("signer cannot sign typed data");
  return signer.signTypedData({
    domain: paperDomain(chainId),
    types: quoteTypes,
    primaryType: "Quote",
    message: contractQuote(quote),
  });
}

export function verifyQuote(
  signer: Address,
  chainId: number,
  quote: SignedQuote,
  signature: Hex,
): Promise<boolean> {
  return verifyTypedData({
    address: signer,
    domain: paperDomain(chainId),
    types: quoteTypes,
    primaryType: "Quote",
    message: contractQuote(quote),
    signature,
  }).catch(() => false);
}

export function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
}
