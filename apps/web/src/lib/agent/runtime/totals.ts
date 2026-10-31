// Summarize actual slice fills; missing outcomes remain missing.
import type { Mission, MissionTotals } from "./types";

/** Totals over settled fills only. `costBps` compares the average fill with the arrival mid. */
export function missionTotals(mission: Mission): MissionTotals {
  const fills = mission.slices.filter((slice) => slice.state === "filled");
  const paid = fills.reduce((sum, slice) => sum + (slice.paid ?? 0), 0);
  const received = fills.reduce((sum, slice) => sum + (slice.received ?? 0), 0);
  const buy = mission.plan?.side === "buy";
  const avgPrice = received > 0 && paid > 0 ? (buy ? paid / received : received / paid) : null;
  const costBps =
    avgPrice !== null && mission.arrivalMid
      ? (buy ? avgPrice / mission.arrivalMid - 1 : 1 - avgPrice / mission.arrivalMid) * 10_000
      : null;
  return { filled: fills.length, paid, received, avgPrice, costBps };
}
