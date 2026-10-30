import { quoteTypes } from "@zethos/shared";

/** Minimal ZethosVault fragment until the generated ABI in @zethos/shared is populated. */
export const vaultAbi = [
  {
    type: "function",
    name: "quoteSigner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "maxTtl",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "isNonceUsed",
    stateMutability: "view",
    inputs: [
      { name: "taker", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "fill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "quote", type: "tuple", components: quoteTypes.Quote },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
