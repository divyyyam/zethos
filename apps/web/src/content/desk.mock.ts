// Sample data only. Labeled as sample wherever displayed.
export const sampleMandate = {
  pairs: ["HSK/USDT", "ETH/USDT"],
  inventory: { minShare: 0.15, maxShare: 0.85 },
  service: {
    maxHalfSpreadBps: [{ maxNotionalUsd: 50000, maxBps: 1000 }],
    minQuoteNotionalUsd: 5,
    uptimeTargetPct: 99,
  },
  loss: { maxOperatingLossUsd: 25000 },
  canary: {
    maxAllocationPct: 10,
    minFillsBeforePromote: 100,
    retireDrawdownPct: 0.02,
    retireFillRateDrop: 0.2,
  },
  qualification: {
    mustBeatHeldOut: true as const,
    maxDrawdownDeltaPct: 0.01,
    honestFillTolerance: 0.05,
    minHonestFillRate: 0.5,
    maxRejectRate: 0.5,
  },
};

export const sampleDeskPolicies = [
  {
    id: "p-20261031-v0",
    status: "incumbent" as const,
    parent: "v0",
    hypothesis:
      "Incumbent depth-weighted reference with volatility, inventory skew, and tuner spread terms.",
    createdAt: 1730419200000,
    allocationPct: 90,
    liveStats: {
      fills: 1240,
      volumeUsd: 248560,
      drawdownPct: 0.004,
      fillRate: 0.88,
    },
  },
  {
    id: "p-20261101-leadlag1",
    status: "canary" as const,
    parent: "p-20261031-v0",
    hypothesis:
      "Widen spread on lead venue divergence to defend against lead-lag latency arbitrage.",
    createdAt: 1730422800000,
    allocationPct: 10,
    liveStats: {
      fills: 42,
      volumeUsd: 11200,
      drawdownPct: 0.001,
      fillRate: 0.82,
    },
  },
];
