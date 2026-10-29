import { MAINNET_TOKEN_ADDRESSES } from "@zethos/shared";
import { type Address, isAddress, zeroAddress } from "viem";
import { targetChain } from "./wagmi";

function configuredAddress(value: string | undefined): Address | undefined {
  return value && isAddress(value) && value !== zeroAddress ? value : undefined;
}

export const platformConfig = {
  engineUrl: process.env.NEXT_PUBLIC_ENGINE_URL?.replace(/\/$/, "") || null,
  vaultAddress: configuredAddress(process.env.NEXT_PUBLIC_VAULT_ADDRESS),
  walletConnectEnabled: Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_ID),
  chain: targetChain,
  explorer: targetChain.blockExplorers?.default.url ?? "https://hsk.blockscout.com",
};

export type TokenSymbol = "USDT" | "WHSK" | "WETH";
export interface PlatformToken {
  symbol: TokenSymbol;
  name: string;
  address: Address | undefined;
  samplePrice: number;
  color: "mint" | "lavender" | "sky";
}

export const platformTokens: readonly [PlatformToken, PlatformToken, PlatformToken] = [
  {
    symbol: "USDT",
    name: "Tether USD",
    address:
      configuredAddress(process.env.NEXT_PUBLIC_USDT_ADDRESS) ??
      (targetChain.id === 177 ? MAINNET_TOKEN_ADDRESSES.USDT : undefined),
    samplePrice: 1,
    color: "mint",
  },
  {
    symbol: "WHSK",
    name: "Wrapped HashKey",
    address:
      configuredAddress(process.env.NEXT_PUBLIC_WHSK_ADDRESS) ??
      (targetChain.id === 177 ? MAINNET_TOKEN_ADDRESSES.WHSK : undefined),
    samplePrice: 0.082,
    color: "lavender",
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    address:
      configuredAddress(process.env.NEXT_PUBLIC_WETH_ADDRESS) ??
      (targetChain.id === 177 ? MAINNET_TOKEN_ADDRESSES.WETH : undefined),
    samplePrice: 2500,
    color: "sky",
  },
];

export function tokenBySymbol(symbol: TokenSymbol): PlatformToken {
  return platformTokens.find((token) => token.symbol === symbol) ?? platformTokens[0];
}

export function shortAddress(address: string, size = 4) {
  return `${address.slice(0, size + 2)}…${address.slice(-size)}`;
}

export function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
