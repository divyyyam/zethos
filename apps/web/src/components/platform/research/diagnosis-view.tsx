"use client";

import { AlertCircle } from "lucide-react";
import { formatFractionAsPct, formatUsdOrUnavailable } from "../../../lib/engine/desk-types";
import type { DiagnosisResponse } from "../../../lib/engine/research-types";
import styles from "./research.module.css";

const CAUSE_TITLES: Record<string, { title: string; blurb: string; color: string }> = {
  stale_reference: {
    title: "Stale reference",
    blurb: "Lead venue moved before the engine fused mid caught up",
    color: "var(--p-accent)",
  },
  selective_execution: {
    title: "Selective execution",
    blurb: "Taker executed late in the quote window following a favorable market move",
    color: "var(--color-periwinkle)",
  },
  adverse_size: {
    title: "Adverse size",
    blurb: "Losses concentrated disproportionately in large trade sizes",
    color: "var(--p-warning)",
  },
  inventory_imbalance: {
    title: "Inventory imbalance",
    blurb: "Loss originated from holding residual inventory rather than immediate markout",
    color: "var(--p-success)",
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
          <div>
            <h2>Where losses come from</h2>
            <p>Causes and example fills from the current analysis window.</p>
          </div>
        </div>
        <div className={styles.empty}>
          <AlertCircle size={20} aria-hidden />
          <strong>Loss breakdown unavailable</strong>
          <p>The loss attribution endpoint is currently unreachable or unpopulated.</p>
        </div>
      </div>
    );
  }

  if (isLoading || !diagnosis) {
    return (
      <div className="d-card">
        <div className="d-card-head">
          <div>
            <h2>Where losses come from</h2>
            <p>Causes and example fills from the current analysis window.</p>
          </div>
        </div>
        <p className="d-empty-line">Loading the loss breakdown...</p>
      </div>
    );
  }

  const causesList = Object.entries(diagnosis.causes);

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div>
          <h2>Where losses come from</h2>
          <p>Causes and example fills from the current analysis window.</p>
        </div>
        <span className="p-pill p-pill-neutral">
          {formatUsdOrUnavailable(diagnosis.totalLossUsd)} attributed loss
        </span>
      </div>

      {/* Visual Cause Share Breakdown */}
      <div className={styles.lossBar} aria-hidden>
        {causesList.map(([causeKey, item]) => {
          return (
            <span
              key={causeKey}
              style={{
                width: `${Math.max(0, Math.min(100, item.share * 100))}%`,
                backgroundColor: CAUSE_TITLES[causeKey]?.color ?? "var(--p-accent)",
              }}
            />
          );
        })}
      </div>

      {/* Causes Table */}
      <div className="p-table-wrap mb-5">
        <table className={`p-table ${styles.table}`} aria-label="Loss causes attribution table">
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
                      <strong className={styles.causeLabel}>
                        <span
                          className={styles.dot}
                          style={{
                            backgroundColor: CAUSE_TITLES[causeKey]?.color ?? "var(--p-accent)",
                          }}
                          aria-hidden
                        />
                        {meta.title}
                      </strong>
                      <span className={styles.ruleDetail}>{meta.blurb}</span>
                    </div>
                  </td>
                  <td>
                    <strong className="font-mono">{formatFractionAsPct(item.share)}</strong>
                  </td>
                  <td>
                    <span className={`font-mono ${styles.negative}`}>
                      {formatUsdOrUnavailable(item.usd)}
                    </span>
                  </td>
                  <td>{item.fillCount} fills</td>
                  <td>
                    <div className="flex flex-wrap gap-1 font-mono text-xs">
                      {item.exampleFillIds.length === 0 ? (
                        <span className={styles.muted}>—</span>
                      ) : (
                        item.exampleFillIds.map((fillId) => (
                          <span key={fillId} className={styles.fillId}>
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
        <details className={styles.details}>
          <summary>Example fills · {diagnosis.breakdown.length} records</summary>
          <div className={`${styles.stack} mt-3 text-xs`}>
            {diagnosis.breakdown.map((item) => (
              <div
                key={item.fillId}
                className={`${styles.inset} flex flex-col sm:flex-row sm:items-center justify-between gap-2`}
              >
                <div>
                  <span className="font-mono font-medium">{item.fillId}</span>{" "}
                  <span className={styles.muted}>
                    ({item.pair} {item.side})
                  </span>
                  <p className={styles.muted}>
                    Notional: {formatUsdOrUnavailable(item.notionalUsd)} · Loss:{" "}
                    <span className={`font-mono ${styles.negative}`}>
                      {formatUsdOrUnavailable(item.lossUsd)}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={styles.muted}>Causes:</span>
                  {item.matchedCauses.map((c) => (
                    <span key={c} className={`p-pill p-pill-neutral ${styles.status}`}>
                      {CAUSE_TITLES[c]?.title ?? c.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
