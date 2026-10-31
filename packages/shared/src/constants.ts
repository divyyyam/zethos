import type { Address } from "viem";

export const CHAIN_IDS = { mainnet: 177, testnet: 133 } as const;

// TODO: Confirm these MAINNET addresses on-chain before use (docs/engine.md section 4.3).
// Read each token's decimals() at startup; never hard-code them.
export const MAINNET_TOKEN_ADDRESSES = {
  USDT: "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029",
  WHSK: "0xB210D2120d57b758EE163cFfb43e73728c471Cf1",
  WETH: "0xefd4bC9afD210517803f293ABABd701CaeeCdfd0",
} as const satisfies Record<string, Address>;

// Deployed on HSK testnet. tUSDT and tWETH are test tokens with no market value; always label them
// as such. WHSK is the chain's wrapped-native predeploy.
export const TESTNET_TOKEN_ADDRESSES = {
  tUSDT: "0x1095085CAf22cEEa130f73a99234dd2C9216fb72",
  WHSK: "0x4200000000000000000000000000000000000006",
  tWETH: "0x6ab12f10d4f0ef5B3faae774abb724A958f5BD80",
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

// Only chains with an actual deployment. Mainnet stays absent until the owner decides to deploy there.
export const VAULT_ADDRESSES = {
  [CHAIN_IDS.testnet]: "0x8deB013d7A8f5f5C6C2d8fb12506fab506721d01",
} as const satisfies Partial<Record<number, Address>>;
