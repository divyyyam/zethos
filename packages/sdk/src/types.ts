import type { z } from "zod";
import type * as s from "./schemas.js";

export type Pair = z.infer<typeof s.pair>;
export type Side = z.infer<typeof s.side>;
export type Tier = z.infer<typeof s.tier>;
export type Health = z.infer<typeof s.health>;
export type RiskState = z.infer<typeof s.riskState>;
export type Flow = z.infer<typeof s.flow>;
export type SignedQuote = z.infer<typeof s.signedQuote>;
export type Source = z.infer<typeof s.source>;
export type PriceBreakdown = z.infer<typeof s.priceBreakdown>;
export type PaperQuote = z.infer<typeof s.paperQuote>;
export type VaultQuote = z.infer<typeof s.vaultQuote>;
export type PoolQuote = z.infer<typeof s.poolQuote>;
export type QuoteResponse = z.infer<typeof s.quoteResponse>;
export type SignedQuoteResponse = PaperQuote | VaultQuote;
export type QuoteRequest = z.infer<typeof s.quoteRequest>;
export type PairStatus = z.infer<typeof s.pairStatus>;
export type Status = z.infer<typeof s.status>;
export type Fill = z.infer<typeof s.fill>;
export type Decision = z.infer<typeof s.decision>;
export type TakerRow = z.infer<typeof s.takerRow>;
export type Arena = z.infer<typeof s.arena>;
export type ArenaSummary = z.infer<typeof s.arenaSummary>;
export type Stats = z.infer<typeof s.stats>;
export type ChatResponse = z.infer<typeof s.chatResponse>;
export type ErrorBody = z.infer<typeof s.errorBody>;
export type StreamFrame = z.infer<typeof s.streamFrame>;
export type StreamFrameType = StreamFrame["type"];

/** Convenience quote input: `amount` is a decimal string of the token being sold. */
export interface QuoteIntent {
  taker: QuoteRequest["taker"];
  pair: Pair;
  side: Side;
  amount: string;
}

export interface Market {
  pair: Pair;
  base: PairStatus["base"];
  quote: PairStatus["quote"];
  mid: number | null;
  /** Price a taker sells base at: `mid · (1 − halfSpread.sell)`. */
  bid: number | null;
  /** Price a taker buys base at: `mid · (1 + halfSpread.buy)`. */
  ask: number | null;
  /** Full spread as a fraction (`halfSpread.buy + halfSpread.sell`). */
  spread: number | null;
  health: Health;
  halted: boolean;
  sources: Source[];
  updatedAt: number | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
