/**
 * Mock of the engine's future `GET /stats` response. Swap `getStats` for a real fetch once the
 * endpoint exists; the landing page only depends on the `EngineStats` shape.
 */
export interface EngineStats {
  network: "hashkey-testnet" | "hashkey-mainnet";
  updatedAt: string;
  /** Average fill spread versus the exchange mid price, in percent (0.08 = 0.08%). */
  avgSpreadPct: number;
  /** Median time from quote request to on-chain fill, in seconds. */
  medianFillSeconds: number;
  /** Total vault inventory valued in USD. */
  vaultDepthUsd: number;
  /** Lifetime number of filled swaps. */
  swapsFilled: number;
}

export type StatKey = Exclude<keyof EngineStats, "network" | "updatedAt">;

export const statsMock: EngineStats = {
  network: "hashkey-testnet",
  updatedAt: "2026-10-30T00:00:00.000Z",
  avgSpreadPct: 0.08,
  medianFillSeconds: 2.1,
  vaultDepthUsd: 48_000,
  swapsFilled: 1_240,
};

export async function getStats(): Promise<EngineStats> {
  return statsMock;
}
