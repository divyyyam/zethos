import type { Address } from "viem";

export const CHAIN_IDS = { mainnet: 177, testnet: 133 } as const;

// TODO: Confirm these MAINNET addresses on-chain before use (docs/engine.md section 4.3).
// Testnet addresses remain unconfigured. Read each token's decimals() at startup; never hard-code them.
export const MAINNET_TOKEN_ADDRESSES = {
  USDT: "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029",
  WHSK: "0xB210D2120d57b758EE163cFfb43e73728c471Cf1",
  WETH: "0xefd4bC9afD210517803f293ABABd701CaeeCdfd0",
} as const satisfies Record<string, Address>;

// TODO: Fill only with confirmed deployments; undefined is an intentional, unusable placeholder.
export const HSKSWAP_ADDRESSES = {
  router: undefined,
  quoter: undefined,
  pools: { "HSK/USDT": undefined, "ETH/USDT": undefined },
} as const satisfies {
  router: Address | undefined;
  quoter: Address | undefined;
  pools: Record<string, Address | undefined>;
};

// TODO: Set after deploying ZethosVault (docs/onchain.md section 14).
export const VAULT_ADDRESS: Address | undefined = undefined;
