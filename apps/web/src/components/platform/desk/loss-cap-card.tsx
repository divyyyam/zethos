"use client";

import { AlertTriangle } from "lucide-react";
import { formatUsdOrUnavailable, type Mandate } from "../../../lib/engine/desk-types";

export function LossCapCard({
  mandate,
  observedLossUsd,
  valuationStale,
}: {
  mandate: Mandate | undefined;
  observedLossUsd: number | null;
  valuationStale: boolean;
}) {
  const maxLossUsd = mandate?.loss.maxOperatingLossUsd;
  const usagePct =
    observedLossUsd !== null && maxLossUsd !== undefined && maxLossUsd > 0
      ? ((observedLossUsd / maxLossUsd) * 100).toFixed(1)
      : null;

  const remainingUsd =
    observedLossUsd !== null && maxLossUsd !== undefined
      ? Math.max(0, maxLossUsd - observedLossUsd)
      : null;

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div className="flex items-center justify-between gap-2">
          <h2>Operating-Loss Budget</h2>
          {valuationStale && (
            <span
              className="p-pill p-pill-neutral flex items-center gap-1 text-amber-400"
              title="Valuation is stale — loss usage reflects prior price updates"
            >
              <AlertTriangle size={13} aria-hidden />
              Valuation stale
            </span>
          )}
        </div>
        <p>Epoch operating-loss limit: automatic engine pause triggered upon breach</p>
      </div>

      <div className="p-metrics-grid">
        <div className="p-metric">
          <span>Operating-Loss Cap</span>
          <strong>{formatUsdOrUnavailable(maxLossUsd)}</strong>
          <small>Configured mandate limit</small>
        </div>
        <div className="p-metric">
          <span>Observed Loss Usage</span>
          <strong>{formatUsdOrUnavailable(observedLossUsd)}</strong>
          <small>{usagePct !== null ? `${usagePct}% of cap consumed` : "Unavailable"}</small>
        </div>
        <div className="p-metric">
          <span>Remaining Budget</span>
          <strong>{formatUsdOrUnavailable(remainingUsd)}</strong>
          <small>Before risk-gate pause</small>
        </div>
      </div>
    </div>
  );
}
