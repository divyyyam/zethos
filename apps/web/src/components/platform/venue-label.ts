const venueLabels: Record<string, string> = {
  "hashkey-global": "HashKey Global",
  gate: "Gate",
  kucoin: "KuCoin",
  mexc: "MEXC",
  binance: "Binance",
  okx: "OKX",
};

/** Presentation labels only; venue IDs remain unchanged in engine data. */
export function venueLabel(venue: string): string {
  return venueLabels[venue] ?? venue;
}
