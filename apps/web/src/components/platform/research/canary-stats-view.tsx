"use client";

import { formatFractionAsPct, formatUsdOrUnavailable } from "../../../lib/engine/desk-types";
import type { CanaryCounterfactual } from "../../../lib/engine/research-types";

export function CanaryStatsView({
  canaryStats,
  isCanary,
}: {
  canaryStats: CanaryCounterfactual | null | undefined;
  isCanary: boolean;
}) {
  if (!isCanary) {
    return null;
  }

  if (!canaryStats) {
    return (
      <div className="d-card">
        <div className="d-card-head">
          <h2>Canary Counterfactual Performance</h2>
          <p>Live shadow execution compared against what the incumbent would have quoted</p>
        </div>
        <div className="py-4 text-center text-neutral-400 bg-neutral-900/30 border border-neutral-800 rounded">
          <p className="text-sm font-medium">No live counterfactual stats recorded yet</p>
          <p className="text-xs text-neutral-500 mt-1">
            Telemetry begins accumulating as quotes are priced and settled in shadow mode.
          </p>
        </div>
      </div>
    );
  }

  const pnlDelta =
    canaryStats.counterfactualPnlUsd !== undefined
      ? canaryStats.observedPnlUsd - canaryStats.counterfactualPnlUsd
      : null;

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2>Canary Counterfactual Telemetry</h2>
            <p>Live execution compared counterfactually against incumbent benchmark</p>
          </div>
          <span className="p-pill p-pill-neutral text-xs">Paper Shadow Canary</span>
        </div>
      </div>

      <div className="p-metrics-grid">
        <div className="p-metric">
          <span>Observed Fills</span>
          <strong>{canaryStats.observedFills}</strong>
          <small>Counterfactual incumbent: {canaryStats.counterfactualFills ?? "—"} fills</small>
        </div>
        <div className="p-metric">
          <span>Observed Canary P&L</span>
          <strong
            className={canaryStats.observedPnlUsd >= 0 ? "text-emerald-400" : "text-rose-400"}
          >
            {formatUsdOrUnavailable(canaryStats.observedPnlUsd)}
          </strong>
          <small>Counterfactual: {formatUsdOrUnavailable(canaryStats.counterfactualPnlUsd)}</small>
        </div>
        <div className="p-metric">
          <span>Counterfactual P&L Edge</span>
          <strong
            className={pnlDelta !== null && pnlDelta >= 0 ? "text-emerald-400" : "text-rose-400"}
          >
            {pnlDelta !== null
              ? pnlDelta >= 0
                ? `+${formatUsdOrUnavailable(pnlDelta)}`
                : formatUsdOrUnavailable(pnlDelta)
              : "Unavailable"}
          </strong>
          <small>Advantage vs incumbent</small>
        </div>
        <div className="p-metric">
          <span>Fill Rate Delta</span>
          <strong>{formatFractionAsPct(canaryStats.fillRateDrop)}</strong>
          <small>Taker fill rate drop</small>
        </div>
      </div>
    </div>
  );
}
