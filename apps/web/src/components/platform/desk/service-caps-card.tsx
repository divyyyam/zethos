"use client";

import {
  type DeskCompliance,
  formatUsdOrUnavailable,
  type Mandate,
} from "../../../lib/engine/desk-types";

export function ServiceCapsCard({
  mandate,
  compliance,
}: {
  mandate: Mandate | undefined;
  compliance?: DeskCompliance;
}) {
  const buckets = mandate?.service.maxHalfSpreadBps ?? [];
  const minQuoteNotionalUsd = mandate?.service.minQuoteNotionalUsd;

  return (
    <div className="d-card">
      <div className="d-card-head">
        <h2>Service Spread Targets</h2>
        <p>Mandate service commitments: maximum half-spreads by size</p>
      </div>

      <div className="p-metrics-grid mb-4">
        <div className="p-metric">
          <span>Minimum Quote Size</span>
          <strong>{formatUsdOrUnavailable(minQuoteNotionalUsd)}</strong>
          <small>Required quote floor</small>
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
                const measured = compliance?.sizeBucketCompliance?.find(
                  (b) => b.maxNotionalUsd === bucket.maxNotionalUsd,
                );
                const quotes = measured?.quotes ?? 0;
                const avg = measured?.observedAvgHalfSpreadBps;
                const max = measured?.observedMaxHalfSpreadBps;

                return (
                  <tr key={bucket.maxNotionalUsd}>
                    <td>
                      <strong>Up to {formatUsdOrUnavailable(bucket.maxNotionalUsd)}</strong>
                    </td>
                    <td>
                      {maxSpreadBps} bps ({maxSpreadPct}%)
                    </td>
                    <td>
                      {measured && quotes > 0 && typeof avg === "number" ? (
                        <span className="font-mono text-xs">
                          avg {avg.toFixed(1)} bps
                          {typeof max === "number" ? ` · max ${max.toFixed(1)} bps` : ""} · {quotes}{" "}
                          {quotes === 1 ? "quote" : "quotes"}
                        </span>
                      ) : (
                        <span className="text-neutral-400 text-xs">
                          {measured ? "No quotes yet this epoch" : "Unavailable"}
                        </span>
                      )}
                    </td>
                    <td>
                      {measured?.compliant === true ? (
                        <span className="p-pill p-pill-success">Compliant</span>
                      ) : measured?.compliant === false ? (
                        <span className="p-pill text-rose-400">Breach</span>
                      ) : (
                        <span className="p-pill p-pill-neutral">Target</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-400 mt-3">
        * Measured from every signed quote this epoch: price against the fused mid at quote time,
        the same measure the execution layer enforces.
      </p>
    </div>
  );
}
