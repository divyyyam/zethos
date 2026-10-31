"use client";

import { AlertTriangle } from "lucide-react";
import {
  formatFractionAsPct,
  formatUsdOrUnavailable,
  type Mandate,
  type ObservedPairInventory,
} from "../../../lib/engine/desk-types";
import { formatNumber } from "../../../lib/platform-config";
import { StatusDot } from "../primitives";

export function InventoryBandCard({
  mandate,
  observed,
  valuationStale,
}: {
  mandate: Mandate | undefined;
  observed: ObservedPairInventory[];
  valuationStale: boolean;
}) {
  const minSharePct = formatFractionAsPct(mandate?.inventory.minShare);
  const maxSharePct = formatFractionAsPct(mandate?.inventory.maxShare);

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div className="flex items-center justify-between gap-2">
          <h2>Inventory Band Compliance</h2>
          {valuationStale && (
            <span
              className="p-pill p-pill-neutral flex items-center gap-1 text-amber-400"
              title="Valuation is stale — exchange prices may lag real-time inventory values"
            >
              <AlertTriangle size={13} aria-hidden />
              Valuation stale
            </span>
          )}
        </div>
        <p>Hard inventory boundaries: trades that would breach the band are rejected</p>
      </div>

      <div className="p-metrics-grid mb-4">
        <div className="p-metric">
          <span>Configured Minimum Share</span>
          <strong>{minSharePct}</strong>
          <small>Hard lower bound</small>
        </div>
        <div className="p-metric">
          <span>Target Share</span>
          <strong>50.0%</strong>
          <small>Balanced inventory</small>
        </div>
        <div className="p-metric">
          <span>Configured Maximum Share</span>
          <strong>{maxSharePct}</strong>
          <small>Hard upper bound</small>
        </div>
      </div>

      <div className="p-table-wrap">
        <table className="p-table" aria-label="Observed inventory compliance table">
          <thead>
            <tr>
              <th scope="col">Pair</th>
              <th scope="col">Observed Base Units</th>
              <th scope="col">Valuation (USD)</th>
              <th scope="col">Observed Share</th>
              <th scope="col">Band Compliance</th>
            </tr>
          </thead>
          <tbody>
            {observed.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-4 text-neutral-400">
                  No inventory observations available
                </td>
              </tr>
            ) : (
              observed.map((item) => {
                const min = mandate?.inventory.minShare;
                const max = mandate?.inventory.maxShare;
                const isCompliant =
                  item.baseShare !== null &&
                  min !== undefined &&
                  max !== undefined &&
                  item.baseShare >= min &&
                  item.baseShare <= max;
                const hasBreached =
                  item.baseShare !== null &&
                  min !== undefined &&
                  max !== undefined &&
                  (item.baseShare < min || item.baseShare > max);

                const statusTone = isCompliant ? "success" : hasBreached ? "warning" : "neutral";

                return (
                  <tr key={item.pair}>
                    <td>
                      <strong>{item.pair}</strong>
                    </td>
                    <td>
                      {formatNumber(item.baseUnits, 4)} {item.baseSymbol}
                    </td>
                    <td>{formatUsdOrUnavailable(item.baseUsd)}</td>
                    <td>
                      <strong>{formatFractionAsPct(item.baseShare)}</strong>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot tone={statusTone} />
                        {item.baseShare === null
                          ? "Unavailable"
                          : isCompliant
                            ? "In band"
                            : "Breached"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
