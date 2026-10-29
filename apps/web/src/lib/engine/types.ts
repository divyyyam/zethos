import type { Address, Hex } from "viem";

export interface SignedQuote {
  taker: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  amountOut: string;
  nonce: string;
  issuedAt: string;
  expiry: string;
}
export interface QuoteRequest {
  taker: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
}
export interface VaultQuote {
  route: "conduit";
  quote: SignedQuote;
  signature: Hex;
  conduitOut: string;
  hskswapOut: string;
  spotOut: string;
  savingPct: number;
  expiresAt: number;
}
export interface PoolQuote {
  route: "hskswap";
  hskswapOut: string;
  reason: string;
}
export type QuoteResponse = VaultQuote | PoolQuote;
export interface EngineStatus {
  paused: boolean;
  riskState: string;
  pairs: {
    pair: string;
    feed: string;
    mid: number;
    poolPrice: number;
    gapPct: number;
    spreadBid: number;
    spreadAsk: number;
  }[];
  vault: { address: Address; balances: Record<string, string> };
}
export interface Fill {
  id: string;
  ts: number;
  pair: string;
  side: string;
  amountIn: string;
  amountOut: string;
  savingPct: number;
  txHash: Hex;
  price: number;
}
export interface StatsResponse {
  series: { t: number; mid: number; poolPrice: number }[];
  fills: unknown[];
  arbs: unknown[];
  summary: {
    medianGapBefore: number;
    medianGapAfter: number;
    volumeFilled: number;
    userSavings: number;
    swapsFilled?: number;
  };
}
export interface Decision {
  id: string;
  ts: number;
  type: string;
  reason: string;
  inputs?: Record<string, unknown>;
}
export interface PnlResponse {
  total: number;
  spreadCapture: number;
  inventory: number;
  arbitrage: number;
  gas: number;
}
export interface ChatResponse {
  reply: string;
  cards: { type: string; data: Record<string, unknown> }[];
}
