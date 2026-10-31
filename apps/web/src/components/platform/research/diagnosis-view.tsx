"use client";

import { AlertCircle } from "lucide-react";
import { formatFractionAsPct, formatUsdOrUnavailable } from "../../../lib/engine/desk-types";
import type { DiagnosisResponse } from "../../../lib/engine/research-types";

const CAUSE_TITLES: Record<string, { title: string; blurb: string }> = {
  stale_reference: {
    title: "Stale Reference",
    blurb: "Lead venue moved before the engine fused mid caught up",
  },
  selective_execution: {
    title: "Selective Execution",
    blurb: "Taker executed late in the quote window following a favorable market move",
  },
  adverse_size: {
    title: "Adverse Size",
    blurb: "Losses concentrated disproportionately in large trade sizes",
  },
  inventory_imbalance: {
    title: "Inventory Imbalance",
    blurb: "Loss originated from holding residual inventory rather than immediate markout",
  },
};

export function DiagnosisView({
  diagnosis,
  isLoading,
  isError,
}: {
  diagnosis: DiagnosisResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isError) {
    return (
      <div className="d-card">
        <div className="d-card-head">
          <h2>Loss Attribution Diagnosis</h2>
          <p>Real-time cause attribution across losing executions</p>
        </div>
        <div className="py-4 text-center text-neutral-400 bg-neutral-900/30 border border-neutral-800 rounded">
          <AlertCircle size={20} className="mx-auto mb-2 text-neutral-500" aria-hidden />
          <p className="text-sm font-medium">Diagnosis data unavailable</p>
          <p className="text-xs text-neutral-500 mt-1">
            The loss attribution endpoint is currently unreachable or unpopulated.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !diagnosis) {
    return (
      <div className="d-card">
        <div className="d-card-head">
          <h2>Loss Attribution Diagnosis</h2>
          <p>Real-time cause attribution across losing executions</p>
        </div>
        <p className="text-sm text-neutral-400 py-4">Loading attribution diagnosis...</p>
      </div>
    );
  }

  const causesList = Object.entries(diagnosis.causes);

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2>Loss Attribution Diagnosis</h2>
            <p>
              Attributed causes for losing fills in the current analysis window (Total:{" "}
              <b>{formatUsdOrUnavailable(diagnosis.totalLossUsd)}</b>)
            </p>
          </div>
          <span className="p-pill p-pill-neutral text-xs">S6 Attribution Model</span>
        </div>
      </div>

      {/* Visual Cause Share Breakdown */}
      <div className="mb-5">
        <div className="flex h-3 w-full rounded-full overflow-hidden bg-neutral-800 mb-2">
          {causesList.map(([causeKey, item], index) => {
            const colors = ["bg-amber-500", "bg-purple-500", "bg-cyan-500", "bg-emerald-500"];
            const color = colors[index % colors.length];
            return (
              <div
                key={causeKey}
                className={color}
                style={{ width: `${Math.max(0, Math.min(100, item.share * 100))}%` }}
                title={`${causeKey}: ${(item.share * 100).toFixed(1)}%`}
              />
            );
          })}
        </div>
      </div>

      {/* Causes Table */}
      <div className="p-table-wrap mb-5">
        <table className="p-table text-xs" aria-label="Loss causes attribution table">
          <thead>
            <tr>
              <th scope="col">Attributed Cause</th>
              <th scope="col">Attributed Share</th>
              <th scope="col">Attributed Loss</th>
              <th scope="col">Fill Count</th>
              <th scope="col">Example Fill IDs</th>
            </tr>
          </thead>
          <tbody>
            {causesList.map(([causeKey, item]) => {
              const meta = CAUSE_TITLES[causeKey] ?? {
                title: causeKey.replaceAll("_", " "),
                blurb: "Attributed trading loss cause",
              };

              return (
                <tr key={causeKey}>
                  <td>
                    <div>
                      <strong className="text-neutral-200 block">{meta.title}</strong>
                      <span className="text-neutral-400 text-xs">{meta.blurb}</span>
                    </div>
                  </td>
                  <td>
                    <strong className="text-neutral-100 font-mono">
                      {formatFractionAsPct(item.share)}
                    </strong>
                  </td>
                  <td>
                    <span className="text-rose-400 font-mono font-medium">
                      {formatUsdOrUnavailable(item.usd)}
                    </span>
                  </td>
                  <td>{item.fillCount} fills</td>
                  <td>
                    <div className="flex flex-wrap gap-1 font-mono text-xs">
                      {item.exampleFillIds.length === 0 ? (
                        <span className="text-neutral-500">—</span>
                      ) : (
                        item.exampleFillIds.map((fillId) => (
                          <span
                            key={fillId}
                            className="bg-neutral-800/80 px-1.5 py-0.5 rounded text-neutral-300"
                          >
                            {fillId}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Breakdown Evidence Samples (if available) */}
      {diagnosis.breakdown && diagnosis.breakdown.length > 0 && (
        <div className="border-t border-neutral-800 pt-3">
          <h3 className="text-xs uppercase tracking-wider text-neutral-400 mb-2 font-medium">
            Evidence Samples From Tape
          </h3>
          <div className="space-y-2 text-xs">
            {diagnosis.breakdown.map((item) => (
              <div
                key={item.fillId}
                className="bg-neutral-900/40 border border-neutral-800/60 rounded p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <span className="font-mono text-neutral-300 font-semibold">{item.fillId}</span>{" "}
                  <span className="text-neutral-500">
                    ({item.pair} {item.side})
                  </span>
                  <p className="text-neutral-400 text-xs mt-0.5">
                    Notional: {formatUsdOrUnavailable(item.notionalUsd)} · Loss:{" "}
                    <span className="text-rose-400 font-mono">
                      {formatUsdOrUnavailable(item.lossUsd)}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-xs">
                  <span className="text-neutral-500">Causes:</span>
                  {item.matchedCauses.map((c) => (
                    <span key={c} className="p-pill p-pill-neutral text-xs">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
