"use client";
import {
  formatBps,
  formatPrice,
  MARKOUT_HORIZONS,
  type Mission,
  missionTotals,
} from "../../../lib/agent/runtime";
import { platformConfig } from "../../../lib/platform-config";
import { ExternalLink } from "../primitives";

export function Result({ mission }: { mission: Mission }) {
  const totals = missionTotals(mission);
  if (totals.filled === 0) return null;
  const last = mission.slices.filter((slice) => slice.state === "filled").at(-1);
  return (
    <dl className="mt-5 grid gap-x-block gap-y-4 border-t border-line pt-4 sm:grid-cols-2">
      <div>
        <dt className="text-sm text-fg-soft">Average price</dt>
        <dd className="num mt-1.5 text-[max(1.75rem,calc(var(--cw)*0.026))]">
          {totals.avgPrice === null ? "—" : formatPrice(totals.avgPrice)}
        </dd>
        <dd className="mt-1 text-sm text-fg-soft">
          {totals.costBps === null
            ? "Arrival mid unknown"
            : `${totals.costBps.toFixed(1)} bps from arrival mid`}
        </dd>
      </div>
      <div>
        <dt className="text-sm text-fg-soft">Mid versus your fill price, after</dt>
        <dd className="mt-2 flex gap-4">
          {MARKOUT_HORIZONS.map((horizon) => {
            const value = last?.markouts[horizon];
            return (
              <span key={horizon} className="grid">
                <small className="text-[13px] text-fg-soft">{horizon}s</small>
                <span className="num-sm text-[15px]">
                  {value === undefined ? "…" : formatBps(value)}
                </span>
              </span>
            );
          })}
        </dd>
      </div>
      {mission.slices
        .filter((slice) => slice.fill && !slice.fill.paper && slice.fill.txHash)
        .map((slice) => (
          <div key={slice.index}>
            <dt className="text-sm text-fg-soft">Settled transaction</dt>
            <dd>
              <ExternalLink href={`${platformConfig.explorer}/tx/${slice.fill?.txHash}`}>
                View on explorer
              </ExternalLink>
            </dd>
          </div>
        ))}
    </dl>
  );
}
