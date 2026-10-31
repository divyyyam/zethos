"use client";

import { formatFractionAsPct, formatUsdOrUnavailable } from "../../../lib/engine/desk-types";
import type { EvaluationReport } from "../../../lib/engine/research-types";
import styles from "./research.module.css";

export function EvaluationTable({ report }: { report: EvaluationReport | null | undefined }) {
  if (!report) {
    return (
      <div className="d-card">
        <div className="d-card-head">
          <div>
            <h2>Replay results</h2>
            <p>Compare the candidate with the current strategy on the same market data.</p>
          </div>
        </div>
        <div className={styles.empty}>
          <strong>No replay results yet</strong>
          <p>This candidate has not yet completed evaluation against the benchmark datasets.</p>
        </div>
      </div>
    );
  }

  const { candidateId, incumbentId, datasets, results } = report;

  // Group datasets by kind: dev, scenario, heldout
  const datasetKinds: Array<{ kind: "dev" | "scenario" | "heldout"; label: string }> = [
    { kind: "dev", label: "Development replays" },
    { kind: "scenario", label: "Stress and attack scenarios" },
    { kind: "heldout", label: "Held-out replays" },
  ];

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div>
          <h2>Replay results</h2>
          <p>
            Candidate <b>{candidateId}</b> against incumbent <b>{incumbentId}</b>.
          </p>
        </div>
        <span className="p-pill p-pill-neutral">Paper evaluation</span>
      </div>

      <div className={styles.stack}>
        {datasetKinds.map(({ kind, label }) => {
          const kindDatasets = datasets.filter((d) => d.kind === kind);
          if (kindDatasets.length === 0) return null;

          return (
            <div key={kind} className={styles.benchmark}>
              <h3>
                <span className={styles.dot} data-kind={kind} aria-hidden />
                {label}
              </h3>

              {kindDatasets.map((ds) => {
                const dsResults = results[ds.name];
                const candidate = dsResults?.[candidateId];
                const incumbent = dsResults?.[incumbentId];

                if (!candidate) {
                  return (
                    <p key={ds.name} className={styles.muted}>
                      No results recorded for dataset {ds.name}
                    </p>
                  );
                }

                const netDelta = incumbent ? candidate.netUsd - incumbent.netUsd : null;
                const ddDelta = incumbent
                  ? candidate.maxDrawdownPct - incumbent.maxDrawdownPct
                  : null;

                return (
                  <div key={ds.name} className="mb-4 last:mb-0">
                    <div className={styles.datasetHead}>
                      <strong>{ds.name}</strong>
                      <span>{ds.requests ?? candidate.fills} requests / fills</span>
                    </div>

                    <div className="p-table-wrap">
                      <table
                        className={`p-table ${styles.table}`}
                        aria-label={`Results table for ${ds.name}`}
                      >
                        <thead>
                          <tr>
                            <th scope="col">Policy</th>
                            <th scope="col">Net P&L (USD)</th>
                            <th scope="col">Spread P&L</th>
                            <th scope="col">Max Drawdown</th>
                            <th scope="col">Avg Half-Spread</th>
                            <th scope="col">Fill Rate</th>
                            <th scope="col">Reject Rate</th>
                            <th scope="col">Attacker Take</th>
                            <th scope="col">Fills</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Candidate Row */}
                          <tr className={styles.candidate}>
                            <td>
                              <strong className={styles.accent}>Candidate ({candidateId})</strong>
                            </td>
                            <td>
                              <strong
                                className={
                                  candidate.netUsd >= 0 ? styles.positive : styles.negative
                                }
                              >
                                {formatUsdOrUnavailable(candidate.netUsd)}
                              </strong>
                            </td>
                            <td>{formatUsdOrUnavailable(candidate.spreadCaptureUsd)}</td>
                            <td>{formatFractionAsPct(candidate.maxDrawdownPct, 2)}</td>
                            <td>{candidate.avgHalfSpreadBps.toFixed(1)} bps</td>
                            <td>{formatFractionAsPct(candidate.honestFillRate)}</td>
                            <td>{formatFractionAsPct(candidate.rejectRate)}</td>
                            <td>{formatUsdOrUnavailable(candidate.attackerTakeUsd)}</td>
                            <td>{candidate.fills}</td>
                          </tr>

                          {/* Incumbent Row (if present) */}
                          {incumbent && (
                            <tr className={styles.muted}>
                              <td>Incumbent ({incumbentId})</td>
                              <td
                                className={
                                  incumbent.netUsd >= 0 ? styles.positive : styles.negative
                                }
                              >
                                {formatUsdOrUnavailable(incumbent.netUsd)}
                              </td>
                              <td>{formatUsdOrUnavailable(incumbent.spreadCaptureUsd)}</td>
                              <td>{formatFractionAsPct(incumbent.maxDrawdownPct, 2)}</td>
                              <td>{incumbent.avgHalfSpreadBps.toFixed(1)} bps</td>
                              <td>{formatFractionAsPct(incumbent.honestFillRate)}</td>
                              <td>{formatFractionAsPct(incumbent.rejectRate)}</td>
                              <td>{formatUsdOrUnavailable(incumbent.attackerTakeUsd)}</td>
                              <td>{incumbent.fills}</td>
                            </tr>
                          )}

                          {/* Delta Summary Row */}
                          {incumbent && netDelta !== null && ddDelta !== null && (
                            <tr>
                              <td className={styles.muted}>Difference</td>
                              <td className={netDelta >= 0 ? styles.positive : styles.negative}>
                                {netDelta >= 0
                                  ? `+${formatUsdOrUnavailable(netDelta)}`
                                  : formatUsdOrUnavailable(netDelta)}
                              </td>
                              <td className={styles.muted}>—</td>
                              <td className={ddDelta <= 0 ? styles.positive : styles.negative}>
                                {ddDelta <= 0
                                  ? `${(ddDelta * 100).toFixed(2)}%`
                                  : `+${(ddDelta * 100).toFixed(2)}%`}
                              </td>
                              <td className={styles.muted}>
                                {(candidate.avgHalfSpreadBps - incumbent.avgHalfSpreadBps).toFixed(
                                  1,
                                )}{" "}
                                bps
                              </td>
                              <td className={styles.muted}>
                                {(
                                  (candidate.honestFillRate - incumbent.honestFillRate) *
                                  100
                                ).toFixed(1)}
                                %
                              </td>
                              <td className={styles.muted}>
                                {((candidate.rejectRate - incumbent.rejectRate) * 100).toFixed(1)}%
                              </td>
                              <td className={styles.muted}>
                                {candidate.attackerTakeUsd !== undefined &&
                                incumbent.attackerTakeUsd !== undefined
                                  ? formatUsdOrUnavailable(
                                      candidate.attackerTakeUsd - incumbent.attackerTakeUsd,
                                    )
                                  : "—"}
                              </td>
                              <td className={styles.muted}>—</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <p className={styles.footer}>
        Results are paper simulations on historical and replayed market data. They do not represent
        settled trades or guarantee future performance.
      </p>
    </div>
  );
}
