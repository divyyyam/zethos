import type { Decision, PnlResponse, StatsResponse } from "../lib/engine/types";

// Illustrative data only. No mock is ever eligible for a transaction or operator authorization.
export const sampleSummary: StatsResponse["summary"] = {
  medianGapBefore: 1.84,
  medianGapAfter: 0.23,
  volumeFilled: 248560,
  userSavings: 1845.72,
  swapsFilled: 1240,
};
export function sampleSeries(pair: string): StatsResponse["series"] {
  const price = pair.startsWith("WETH") ? 2500 : 0.082;
  const start = Date.UTC(2026, 9, 28, 12);
  return Array.from({ length: 49 }, (_, i) => {
    const mid = price * (1 + Math.sin(i * 0.47) * 0.015 + Math.cos(i * 0.83) * 0.005 + i * 0.0004);
    return {
      t: start + i * 3600000,
      mid,
      poolPrice:
        mid *
        (1 +
          (i < 21
            ? 0.014 + Math.abs(Math.sin(i * 0.58)) * 0.012
            : 0.0014 + Math.abs(Math.sin(i * 0.7)) * 0.0025)),
    };
  });
}
export const sampleDecisions: Decision[] = [
  {
    id: "sample-1",
    ts: Date.UTC(2026, 9, 30, 12),
    type: "quote",
    reason: "WHSK / USDT quote priced against the exchange reference.",
  },
  {
    id: "sample-2",
    ts: Date.UTC(2026, 9, 30, 11, 58),
    type: "inventory",
    reason: "All three assets remain within their inventory bands.",
  },
  {
    id: "sample-3",
    ts: Date.UTC(2026, 9, 30, 11, 54),
    type: "spread",
    reason: "WETH spread adjusted to reflect reference-market volatility.",
  },
  {
    id: "sample-4",
    ts: Date.UTC(2026, 9, 30, 11, 49),
    type: "risk",
    reason: "Reference feeds healthy. No pair halts required.",
  },
];
export const samplePnl: PnlResponse = {
  total: 128.64,
  spreadCapture: 94.3,
  inventory: -12.5,
  arbitrage: 49.8,
  gas: -2.96,
};
export const sampleInventory = [
  { symbol: "USDT", value: 29000, share: 60.4 },
  { symbol: "WHSK", value: 12000, share: 25 },
  { symbol: "WETH", value: 7000, share: 14.6 },
] as const;
