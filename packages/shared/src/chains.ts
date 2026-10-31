import { type Chain, defineChain } from "viem";

// Native HSK has 18 decimals. ERC-20 decimals must be read on-chain.
// Explicit annotations keep declaration emit portable (TS2883) while preserving literal ids.
export const hskMainnet: Chain & { id: 177 } = defineChain({
  id: 177,
  name: "HSK Chain",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.hsk.xyz"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://hsk.blockscout.com" } },
});

export const hskTestnet: Chain & { id: 133 } = defineChain({
  id: 133,
  name: "HSK Chain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.hsk.xyz"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://testnet-explorer.hskchain.net" } },
  testnet: true,
});
