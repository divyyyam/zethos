"use client";

import { formatPct, formatUsdOrUnavailable, type Mandate } from "../../../lib/engine/desk-types";

export function ServiceCapsCard({ mandate }: { mandate: Mandate | undefined }) {
  const buckets = mandate?.service.maxHalfSpreadBps ?? [];
  const minQuoteNotionalUsd = mandate?.service.minQuoteNotionalUsd;
  const uptimeTargetPct = mandate?.service.uptimeTargetPct;

  return (
    <div className="d-card">
      <div className="d-card-head">
        <h2>Service Spread & Uptime Targets</h2>
        <p>Mandate service commitments: maximum half-spreads by size and uptime target</p>
      </div>

      <div className="p-metrics-grid mb-4">
        <div className="p-metric">
          <span>Minimum Quote Size</span>
          <strong>{formatUsdOrUnavailable(minQuoteNotionalUsd)}</strong>
          <small>Required quote floor</small>
        </div>
        <div className="p-metric">
          <span>Uptime Target</span>
          <strong>{formatPct(uptimeTargetPct)}</strong>
          <small>Configured service target</small>
        </div>
        <div className="p-metric">
          <span>Observed Uptime</span>
          <strong>Unavailable</strong>
          <small title="Tape capture rate measures external flow ingest, not desk uptime">
            Distinct from tape capture rate
          </small>
        </div>
      </div>

      <div className="p-table-wrap">
        <table className="p-table" aria-label="Service spread caps by size bucket table">
          <thead>
            <tr>
              <th scope="col">Size Bucket (Max Notional)</th>
              <th scope="col">Max Allowed Half-Spread</th>
              <th scope="col">Observed Compliance</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {buckets.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-4 text-neutral-400">
                  No service buckets configured
                </td>
              </tr>
            ) : (
              buckets.map((bucket) => {
                const maxSpreadBps = bucket.maxBps;
                const maxSpreadPct = (maxSpreadBps / 100).toFixed(2);

                return (
                  <tr key={bucket.maxNotionalUsd}>
                    <td>
                      <strong>Up to {formatUsdOrUnavailable(bucket.maxNotionalUsd)}</strong>
                    </td>
                    <td>
                      {maxSpreadBps} bps ({maxSpreadPct}%)
                    </td>
                    <td>
                      <span
                        className="text-neutral-400 text-xs"
                        title="Normal-tier status spread is not measured compliance for every size bucket"
                      >
                        Unavailable
                      </span>
                    </td>
                    <td>
                      <span className="p-pill p-pill-neutral">Target</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-400 mt-3">
        * Measured compliance per size bucket requires multi-notional execution sampling. Indicative
        normal-tier spreads are not substituted for size-bucket verification.
      </p>
    </div>
  );
}
