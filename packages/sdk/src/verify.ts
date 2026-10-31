import { type Quote, quoteDomain, quoteTypes } from "@zethos/shared";
import { type Address, type Hex, type PublicClient, verifyTypedData, zeroAddress } from "viem";
import { vaultAbi } from "./abi.js";
import { signedQuote, uint } from "./schemas.js";
import type {
  QuoteRequest,
  QuoteResponse,
  SignedQuote,
  SignedQuoteResponse,
  Status,
} from "./types.js";

export const MAX_TTL_SEC = 120;

export type VerificationReason =
  | "not_signed_route"
  | "binding_mismatch"
  | "out_of_bounds"
  | "bad_signature_format"
  | "expired"
  | "ttl_too_long"
  | "display_mismatch"
  | "expiry_mismatch"
  | "bad_signer"
  | "worse_than_reference";

export interface Verification {
  ok: boolean;
  /** `engine`: paper quote checked against the engine's signer. `chain`: signer read from the vault. */
  trust: "engine" | "chain" | "none";
  reasons: VerificationReason[];
}

export interface VerifyOptions {
  chainId: number;
  status: Pick<Status, "signer" | "verifyingContract">;
  publicClient?: PublicClient | undefined;
  /** Unix seconds. Defaults to the current time. */
  now?: number;
  /** Minimum remaining seconds. Default 5; 1 for paper quotes with TTL at most 5 seconds. */
  minRemainingSec?: number;
  /** Largest accepted shortfall versus `spotOut`, as a fraction. Default 0.03. */
  maxSpreadVsMid?: number;
}

export function toContractQuote(quote: SignedQuote): Quote {
  return {
    ...quote,
    amountIn: BigInt(quote.amountIn),
    amountOut: BigInt(quote.amountOut),
    nonce: BigInt(quote.nonce),
    issuedAt: BigInt(quote.issuedAt),
    expiry: BigInt(quote.expiry),
  };
}

// Quote signatures are ECDSA by specification, so verification requires an EOA signer.
export async function verifyQuoteSignature({
  quote,
  signature,
  signer,
  vault,
  chainId,
}: {
  quote: SignedQuote;
  signature: Hex;
  signer: Address;
  vault: Address;
  chainId: number;
}): Promise<boolean> {
  try {
    return await verifyTypedData({
      address: signer,
      domain: { ...quoteDomain, chainId, verifyingContract: vault },
      types: quoteTypes,
      primaryType: "Quote",
      message: toContractQuote(quote),
      signature,
    });
  } catch {
    return false;
  }
}

/** Checks a quote locally. Never throws for an invalid quote; failures are listed in `reasons`. */
export async function verifyQuote(
  response: QuoteResponse,
  request: QuoteRequest | undefined,
  options: VerifyOptions,
): Promise<Verification> {
  if (response.route !== "paper" && response.route !== "conduit") {
    return { ok: false, trust: "none", reasons: ["not_signed_route"] };
  }
  const trust = response.route === "paper" ? "engine" : "chain";
  const parsed = signedQuote.safeParse(response.quote);
  if (!parsed.success) return { ok: false, trust, reasons: ["out_of_bounds"] };

  const quote = parsed.data;
  const reasons = new Set<VerificationReason>();
  const add = (failed: boolean, reason: VerificationReason) => {
    if (failed) reasons.add(reason);
  };
  const signed = toContractQuote(quote);
  const formatOk = isSignatureFormat(response.signature);

  add(!matchesRequest(quote, request), "binding_mismatch");
  add(signed.amountOut === 0n || signed.expiry <= signed.issuedAt, "out_of_bounds");
  add(!formatOk, "bad_signature_format");
  add(signed.expiry - signed.issuedAt > BigInt(MAX_TTL_SEC), "ttl_too_long");
  const safetyWindow = response.route === "paper" && signed.expiry - signed.issuedAt <= 5n ? 1 : 5;
  add(
    Number(signed.expiry) <= nowSec(options) + (options.minRemainingSec ?? safetyWindow),
    "expired",
  );
  add(uintOf(displayedOut(response)) !== signed.amountOut, "display_mismatch");
  add(toSeconds(response.expiresAt) !== Number(signed.expiry), "expiry_mismatch");
  add(isWorseThanReference(response, signed.amountOut, options), "worse_than_reference");
  if (formatOk) add(!(await hasExpectedSigner(response, quote, options)), "bad_signer");
  return { ok: reasons.size === 0, trust, reasons: [...reasons] };
}

function nowSec(options: VerifyOptions): number {
  return options.now ?? Math.floor(Date.now() / 1000);
}

const uint256 = uint(256);

function uintOf(value: unknown): bigint | null {
  const parsed = uint256.safeParse(value);
  return parsed.success ? BigInt(parsed.data) : null;
}

function sameAddress(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

function matchesRequest(quote: SignedQuote, request: QuoteRequest | undefined): boolean {
  if (!request) return false;
  return (
    sameAddress(quote.taker, request.taker) &&
    sameAddress(quote.tokenIn, request.tokenIn) &&
    sameAddress(quote.tokenOut, request.tokenOut) &&
    uintOf(request.amountIn) === BigInt(quote.amountIn)
  );
}

function isSignatureFormat(signature: unknown): signature is Hex {
  return typeof signature === "string" && /^0x[\da-fA-F]{130}$/.test(signature);
}

/** Accepts unix seconds or milliseconds. */
function toSeconds(expiresAt: number): number {
  return expiresAt > 1e12 ? Math.floor(expiresAt / 1000) : expiresAt;
}

function displayedOut(response: SignedQuoteResponse): unknown {
  return response.route === "paper" ? response.paperOut : response.conduitOut;
}

function isWorseThanReference(
  response: SignedQuoteResponse,
  amountOut: bigint,
  options: VerifyOptions,
): boolean {
  const pool = response.route === "paper" ? response.poolOut : response.hskswapOut;
  const poolOut = pool === null ? null : uintOf(pool);
  const spotOut = uintOf(response.spotOut);
  if (spotOut === null || (pool !== null && poolOut === null)) return true;
  const keepPpm = BigInt(Math.round((1 - (options.maxSpreadVsMid ?? 0.03)) * 1_000_000));
  const minimum = (spotOut * keepPpm) / 1_000_000n;
  return amountOut < minimum || (poolOut !== null && amountOut < poolOut);
}

async function hasExpectedSigner(
  response: SignedQuoteResponse,
  quote: SignedQuote,
  options: VerifyOptions,
): Promise<boolean> {
  const expected =
    response.route === "paper"
      ? { signer: options.status.signer, vault: zeroAddress }
      : await readVaultSigner(options);
  if (!expected) return false;
  return verifyQuoteSignature({
    quote,
    signature: response.signature,
    signer: expected.signer,
    vault: expected.vault,
    chainId: options.chainId,
  });
}

/** Live route: the signer comes from the vault contract, never from the engine. */
async function readVaultSigner(
  options: VerifyOptions,
): Promise<{ signer: Address; vault: Address } | null> {
  const vault = options.status.verifyingContract;
  const client = options.publicClient;
  if (!client || sameAddress(vault, zeroAddress)) return null;
  try {
    const code = await client.getCode({ address: vault });
    if (!code || code === "0x") return null;
    const signer = await client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "quoteSigner",
    });
    return { signer, vault };
  } catch {
    return null;
  }
}
