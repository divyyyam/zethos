import { defineChain } from "viem";

// Native HSK has 18 decimals. ERC-20 decimals must be read on-chain.
export const hskMainnet = defineChain({
  id: 177,
  name: "HSK Chain",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.hsk.xyz"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://hsk.blockscout.com" } },
});

export const hskTestnet = defineChain({
  id: 133,
  name: "HSK Chain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.hsk.xyz"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://testnet-explorer.hsk.xyz" } },
  testnet: true,
});
