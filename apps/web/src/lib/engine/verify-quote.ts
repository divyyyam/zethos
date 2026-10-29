import { type Quote, quoteDomain, quoteTypes } from "@zethos/shared";
import { type Address, type Hex, verifyTypedData } from "viem";
import type { SignedQuote } from "./types";

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

// The signer must come from vault.quoteSigner(), never from the engine response.
// The vault specification uses ECDSA, so verification deliberately requires an EOA signature.
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
