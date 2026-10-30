import type { Pair, Side, VenueId } from "../config";
import type { Book, Level, Trade } from "./types";

// Public REST market data. Formats verified against each exchange's docs; HSK is not listed on
// Binance or OKX, so those venues are only used for ETH/USDT (see params.json feeds.sources).
export interface Venue {
  bookUrl(pair: Pair, levels: number): string;
  tradesUrl(pair: Pair): string;
  parseBook(json: unknown): Book;
  parseTrades(json: unknown): Trade[];
}

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("not an object");
  return value as Json;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("not an array");
  return value;
}

function positive(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`bad number: ${String(value)}`);
  return number;
}

function levels(value: unknown): Level[] {
  return list(value).map((row) => {
    const [price, size] = list(row);
    return [positive(price), positive(size)] as const;
  });
}

function book(bids: unknown, asks: unknown): Book {
  return { bids: levels(bids), asks: levels(asks) };
}

function side(value: unknown): Side {
  if (value === "buy" || value === "sell") return value;
  throw new Error(`bad side: ${String(value)}`);
}

function symbol(pair: Pair, separator: string): string {
  return pair.replace("/", separator);
}

// Binance-style API (also MEXC): bids/asks arrays, trades with isBuyerMaker.
function binanceLike(origin: string): Venue {
  return {
    bookUrl: (pair, n) => `${origin}/api/v3/depth?symbol=${symbol(pair, "")}&limit=${n}`,
    tradesUrl: (pair) => `${origin}/api/v3/trades?symbol=${symbol(pair, "")}&limit=100`,
    parseBook: (json) => {
      const data = object(json);
      return book(data.bids, data.asks);
    },
    parseTrades: (json) =>
      list(json).map((item) => {
        const trade = object(item);
        return {
          id: String(trade.id ?? `${trade.time}-${trade.price}-${trade.qty}`),
          price: positive(trade.price),
          size: positive(trade.qty),
          side: trade.isBuyerMaker ? "sell" : "buy",
          ts: positive(trade.time),
        };
      }),
  };
}

export const VENUES: Record<VenueId, Venue> = {
  "hashkey-global": {
    bookUrl: (pair, n) =>
      `https://api-glb.hashkey.com/quote/v1/depth?symbol=${symbol(pair, "")}&limit=${n}`,
    tradesUrl: (pair) =>
      `https://api-glb.hashkey.com/quote/v1/trades?symbol=${symbol(pair, "")}&limit=100`,
    parseBook: (json) => {
      const data = object(json);
      return book(data.b, data.a);
    },
    parseTrades: (json) =>
      list(json).map((item) => {
        const trade = object(item);
        return {
          id: `${trade.t}-${trade.p}-${trade.q}`,
          price: positive(trade.p),
          size: positive(trade.q),
          side: trade.ibm ? "sell" : "buy",
          ts: positive(trade.t),
        };
      }),
  },
  gate: {
    bookUrl: (pair, n) =>
      `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${symbol(pair, "_")}&limit=${n}`,
    tradesUrl: (pair) =>
      `https://api.gateio.ws/api/v4/spot/trades?currency_pair=${symbol(pair, "_")}&limit=100`,
    parseBook: (json) => {
      const data = object(json);
      return book(data.bids, data.asks);
    },
    parseTrades: (json) =>
      list(json).map((item) => {
        const trade = object(item);
        return {
          id: String(trade.id),
          price: positive(trade.price),
          size: positive(trade.amount),
          side: side(trade.side),
          ts: Math.floor(positive(trade.create_time_ms)),
        };
      }),
  },
  kucoin: {
    bookUrl: (pair) =>
      `https://api.kucoin.com/api/v1/market/orderbook/level2_20?symbol=${symbol(pair, "-")}`,
    tradesUrl: (pair) =>
      `https://api.kucoin.com/api/v1/market/histories?symbol=${symbol(pair, "-")}`,
    parseBook: (json) => {
      const data = object(object(json).data);
      return book(data.bids, data.asks);
    },
    parseTrades: (json) =>
      list(object(json).data).map((item) => {
        const trade = object(item);
        return {
          id: String(trade.sequence),
          price: positive(trade.price),
          size: positive(trade.size),
          side: side(trade.side),
          ts: Math.floor(positive(trade.time) / 1e6),
        };
      }),
  },
  mexc: binanceLike("https://api.mexc.com"),
  // data-api.binance.vision serves public market data without Binance's regional blocks.
  binance: binanceLike("https://data-api.binance.vision"),
  okx: {
    bookUrl: (pair, n) =>
      `https://www.okx.com/api/v5/market/books?instId=${symbol(pair, "-")}&sz=${n}`,
    tradesUrl: (pair) =>
      `https://www.okx.com/api/v5/market/trades?instId=${symbol(pair, "-")}&limit=100`,
    parseBook: (json) => {
      const [first] = list(object(json).data);
      const data = object(first);
      return book(data.bids, data.asks);
    },
    parseTrades: (json) =>
      list(object(json).data).map((item) => {
        const trade = object(item);
        return {
          id: String(trade.tradeId),
          price: positive(trade.px),
          size: positive(trade.sz),
          side: side(trade.side),
          ts: positive(trade.ts),
        };
      }),
  },
};
