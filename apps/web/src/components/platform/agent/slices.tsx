"use client";
import { formatPrice, type Mission } from "../../../lib/agent/runtime";
import { Countdown } from "./trigger-gauge";

export function Slices({ mission }: { mission: Mission }) {
  if (mission.slices.length < 2) return null;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex justify-between gap-3 text-sm text-fg-soft">
        <span>
          {mission.slices.filter((slice) => slice.state === "filled").length} of{" "}
          {mission.slices.length} slices filled
        </span>
        {mission.nextSliceAt && <Countdown until={mission.nextSliceAt} label="Next in" />}
      </div>
      <div className="mt-3 grid auto-cols-fr grid-flow-col gap-1">
        {mission.slices.map((slice) => (
          <span
            key={slice.index}
            data-state={slice.state}
            title={
              slice.price
                ? `Slice ${slice.index + 1}: ${formatPrice(slice.price)}, ${slice.vsMidBps?.toFixed(1)} bps from mid`
                : `Slice ${slice.index + 1}: ${slice.state}`
            }
            className="a-slice num-sm overflow-hidden rounded-md border border-line py-1 text-center text-[11px] whitespace-nowrap"
          >
            {slice.price ? formatPrice(slice.price) : slice.index + 1}
          </span>
        ))}
      </div>
    </div>
  );
}
