import type { Address, TypedData, TypedDataDomain } from "viem";

// docs/onchain.md section 6. Zethos is the explicit project/domain name from the scaffold request.
export const quoteTypes = {
  Quote: [
    { name: "taker", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOut", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
} as const satisfies TypedData;

export type Quote = {
  taker: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  nonce: bigint;
  issuedAt: bigint;
  expiry: bigint;
};

// Supply chainId and verifyingContract for the actual deployment; never sign with a placeholder.
export type QuoteDomain = TypedDataDomain & {
  name: "Zethos";
  version: "1";
  chainId: 177 | 133;
  verifyingContract: Address;
};

export const quoteDomain = { name: "Zethos", version: "1" } as const;
export const QUOTE_TYPE_STRING =
  "Quote(address taker,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 nonce,uint64 issuedAt,uint64 expiry)";
