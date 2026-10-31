import { type Address, erc20Abi, getAddress, type PublicClient } from "viem";
import type { Pair } from "../config";

export type TokenSymbol = "USDT" | "WHSK" | "WETH";
export const TOKEN_SYMBOLS: readonly TokenSymbol[] = ["USDT", "WHSK", "WETH"];

export interface Token {
  symbol: TokenSymbol;
  address: Address;
  decimals: number;
}
export type Tokens = Record<TokenSymbol, Token>;
export type Inventory = Record<TokenSymbol, bigint>;

export const PAIR_TOKENS: Record<Pair, { base: TokenSymbol; quote: TokenSymbol }> = {
  "HSK/USDT": { base: "WHSK", quote: "USDT" },
  "ETH/USDT": { base: "WETH", quote: "USDT" },
};

export async function loadTokens(
  client: PublicClient,
  addresses: Record<TokenSymbol, Address>,
  assumeDecimals = false,
): Promise<Tokens> {
  const tokens = await Promise.all(
    TOKEN_SYMBOLS.map(async (symbol): Promise<Token> => {
      const address = getAddress(addresses[symbol]);
      let decimals: number;
      try {
        const [readDecimals, readSymbol] = await Promise.all([
          client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
          client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
        ]);
        decimals = readDecimals;
        if (readSymbol.toUpperCase() !== symbol)
          console.warn(`Shadow token symbol mismatch: expected ${symbol}, read ${readSymbol}`);
      } catch (error) {
        if (!assumeDecimals) throw error;
        decimals = symbol === "USDT" ? 6 : 18;
        console.warn(
          [
            `SHADOW_ASSUME_DECIMALS=true: RPC metadata unavailable for ${symbol}; `,
            `explicitly assuming ${decimals} decimals for paper trading`,
          ].join(""),
        );
      }
      return { symbol, address, decimals };
    }),
  );
  return Object.fromEntries(tokens.map((token) => [token.symbol, token])) as Tokens;
}

export function units(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

// Decimal amount to base units, keeping 6 decimal places so floats never leak into big integers.
export function toUnits(amount: number, decimals: number): bigint {
  const micros = BigInt(Math.round(amount * 1e6));
  return decimals >= 6
    ? micros * 10n ** BigInt(decimals - 6)
    : micros / 10n ** BigInt(6 - decimals);
}
