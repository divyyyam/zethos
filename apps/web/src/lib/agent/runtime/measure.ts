// Measure a settled paper fill against healthy public mids at the original horizons.
import type { Fill } from "@zethos/sdk";
import { MARKOUT_HORIZONS } from "./constants";
import { formatBps } from "./helpers";
import { findMission, patchMission, setStage } from "./missions";
import { latestMid } from "./sense";
import type { RuntimeState } from "./state";
import type { Plan } from "./types";

export async function measure(
  context: RuntimeState,
  id: string,
  index: number,
  plan: Plan,
  fill: Fill,
): Promise<void> {
  const never = new AbortController().signal;
  let elapsed = 0;
  for (const horizon of MARKOUT_HORIZONS) {
    await context.sleep((horizon - elapsed) * 1000, never);
    elapsed = horizon;
    const mid = latestMid(context, plan.pair);
    if (mid === null) continue;
    const bps = (plan.side === "buy" ? mid / fill.price - 1 : 1 - mid / fill.price) * 10_000;
    patchMission(context, id, (mission) => ({
      slices: mission.slices.map((slice) =>
        slice.index === index
          ? { ...slice, markouts: { ...slice.markouts, [horizon]: bps } }
          : slice,
      ),
    }));
    if (index === 0 || index === plan.sliceAmounts.length - 1)
      setStage(
        context,
        id,
        "measure",
        findMission(context, id)?.stages.measure.state ?? "active",
        `${horizon}s ${formatBps(bps)}`,
      );
  }
}
