"use client";

import { formatFractionAsPct, formatUsdOrUnavailable } from "../../../lib/engine/desk-types";
import type { CanaryCounterfactual } from "../../../lib/engine/research-types";
import styles from "./research.module.css";

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
          <div>
            <h2>Canary performance</h2>
            <p>Observed trial results against what the incumbent would have quoted.</p>
          </div>
        </div>
        <div className={styles.empty}>
          <strong>No canary results yet</strong>
          <p>Results appear as quotes are priced and settled in shadow mode.</p>
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
        <div>
          <h2>Canary performance</h2>
          <p>Observed trial results against what the incumbent would have quoted.</p>
        </div>
        <span className="p-pill p-pill-neutral">Paper shadow canary</span>
      </div>

      <div className={`p-metrics-grid ${styles.metrics}`}>
        <div className="p-metric">
          <span>Observed fills</span>
          <strong className={styles.metricValue}>{canaryStats.observedFills}</strong>
          <small>Counterfactual incumbent: {canaryStats.counterfactualFills ?? "—"} fills</small>
        </div>
        <div className="p-metric">
          <span>Canary P&L</span>
          <strong
            className={`${styles.metricValue} ${canaryStats.observedPnlUsd >= 0 ? styles.positive : styles.negative}`}
          >
            {formatUsdOrUnavailable(canaryStats.observedPnlUsd)}
          </strong>
          <small>Counterfactual: {formatUsdOrUnavailable(canaryStats.counterfactualPnlUsd)}</small>
        </div>
        <div className="p-metric">
          <span>P&L advantage</span>
          <strong
            className={`${styles.metricValue} ${pnlDelta === null ? styles.muted : pnlDelta >= 0 ? styles.positive : styles.negative}`}
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
          <span>Fill rate drop</span>
          <strong className={styles.metricValue}>
            {formatFractionAsPct(canaryStats.fillRateDrop)}
          </strong>
          <small>Taker fill rate drop</small>
        </div>
      </div>
    </div>
  );
}
