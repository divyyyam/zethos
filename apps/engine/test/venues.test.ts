import { describe, expect, test } from "bun:test";
import { VENUES } from "../src/feeds/venues";

// Response shapes copied from each exchange's public API docs.
const samples = {
  "hashkey-global": {
    book: { t: 1721681436393, b: [["0.0999", "100"]], a: [["0.1001", "200"]] },
    trades: [{ t: 1721682745779, p: "0.1", q: "50", ibm: true }],
  },
  gate: {
    book: { current: 1, update: 1, bids: [["0.0999", "100"]], asks: [["0.1001", "200"]] },
    trades: [
      { id: "7", create_time_ms: "1721682745779.123", side: "buy", amount: "50", price: "0.1" },
    ],
  },
  kucoin: {
    book: {
      code: "200000",
      data: { time: 1, bids: [["0.0999", "100"]], asks: [["0.1001", "200"]] },
    },
    trades: {
      code: "200000",
      data: [{ sequence: "9", price: "0.1", size: "50", side: "sell", time: 1721682745779000000 }],
    },
  },
  mexc: {
    book: { lastUpdateId: 1, bids: [["0.0999", "100"]], asks: [["0.1001", "200"]] },
    trades: [{ id: null, price: "0.1", qty: "50", time: 1721682745779, isBuyerMaker: false }],
  },
  binance: {
    book: { lastUpdateId: 1, bids: [["0.0999", "100"]], asks: [["0.1001", "200"]] },
    trades: [{ id: 12, price: "0.1", qty: "50", time: 1721682745779, isBuyerMaker: true }],
  },
  okx: {
    book: {
      code: "0",
      data: [{ asks: [["0.1001", "200", "0", "1"]], bids: [["0.0999", "100", "0", "1"]], ts: "1" }],
    },
    trades: {
      code: "0",
      data: [{ tradeId: "3", px: "0.1", sz: "50", side: "buy", ts: "1721682745779" }],
    },
  },
} as const;

describe("venue parsers", () => {
  for (const [id, sample] of Object.entries(samples)) {
    const venue = VENUES[id as keyof typeof VENUES];

    test(`${id} book`, () => {
      expect(venue.parseBook(sample.book)).toEqual({
        bids: [[0.0999, 100]],
        asks: [[0.1001, 200]],
      });
    });

    test(`${id} trades`, () => {
      const [trade] = venue.parseTrades(sample.trades);
      expect(trade?.price).toBe(0.1);
      expect(trade?.size).toBe(50);
      expect(trade?.ts).toBe(1721682745779);
      expect(["buy", "sell"]).toContain(trade?.side as string);
    });
  }

  test("rejects malformed books", () => {
    expect(() => VENUES.gate.parseBook({ bids: [["x", "1"]], asks: [] })).toThrow();
    expect(() => VENUES.okx.parseBook({ data: [] })).toThrow();
  });

  test("symbols per venue", () => {
    expect(VENUES["hashkey-global"].bookUrl("HSK/USDT", 20)).toContain("symbol=HSKUSDT");
    expect(VENUES.gate.bookUrl("HSK/USDT", 20)).toContain("currency_pair=HSK_USDT");
    expect(VENUES.kucoin.bookUrl("HSK/USDT", 20)).toContain("symbol=HSK-USDT");
    expect(VENUES.okx.bookUrl("ETH/USDT", 20)).toContain("instId=ETH-USDT");
    expect(VENUES.binance.bookUrl("ETH/USDT", 20)).toContain("data-api.binance.vision");
  });
});
