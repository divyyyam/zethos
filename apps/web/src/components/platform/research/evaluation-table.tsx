"use client";

import { formatFractionAsPct, formatUsdOrUnavailable } from "../../../lib/engine/desk-types";
import type { EvaluationReport } from "../../../lib/engine/research-types";

export function EvaluationTable({ report }: { report: EvaluationReport | null | undefined }) {
  if (!report) {
    return (
      <div className="d-card">
        <div className="d-card-head">
          <h2>Evaluation Benchmark Results</h2>
          <p>Candidate versus incumbent benchmark comparison</p>
        </div>
        <div className="py-6 text-center text-neutral-400 bg-neutral-900/30 border border-neutral-800 rounded">
          <p className="text-sm font-medium">Missing evaluation report</p>
          <p className="text-xs text-neutral-500 mt-1">
            This candidate has not yet completed evaluation against benchmark datasets.
          </p>
        </div>
      </div>
    );
  }

  const { candidateId, incumbentId, datasets, results } = report;

  // Group datasets by kind: dev, scenario, heldout
  const datasetKinds: Array<{ kind: "dev" | "scenario" | "heldout"; label: string }> = [
    { kind: "dev", label: "In-Sample Dev Replays" },
    { kind: "scenario", label: "Stress & Attack Scenarios" },
    { kind: "heldout", label: "Out-of-Sample Held-Out Replays" },
  ];

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2>Evaluation Benchmark Results</h2>
            <p>
              Candidate (<b>{candidateId}</b>) vs Incumbent (<b>{incumbentId}</b>) across replay
              partitions
            </p>
          </div>
          <span className="p-pill p-pill-neutral text-xs">Paper Replay Benchmarks</span>
        </div>
      </div>

      <div className="space-y-6">
        {datasetKinds.map(({ kind, label }) => {
          const kindDatasets = datasets.filter((d) => d.kind === kind);
          if (kindDatasets.length === 0) return null;

          return (
            <div
              key={kind}
              className="border border-neutral-800/80 rounded-md p-3.5 bg-neutral-900/20"
            >
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs uppercase tracking-wider font-semibold text-neutral-300 flex items-center gap-2">
                  <span
                    className={`inline-block size-2 rounded-full ${
                      kind === "heldout"
                        ? "bg-amber-400"
                        : kind === "scenario"
                          ? "bg-purple-400"
                          : "bg-cyan-400"
                    }`}
                  />
                  {label}
                </h3>
                <span className="text-xs text-neutral-500 font-mono">kind: {kind}</span>
              </div>

              {kindDatasets.map((ds) => {
                const dsResults = results[ds.name];
                const candidate = dsResults?.[candidateId];
                const incumbent = dsResults?.[incumbentId];

                if (!candidate) {
                  return (
                    <p key={ds.name} className="text-xs text-neutral-400 py-2">
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
                    <div className="flex items-center justify-between text-xs py-1.5 px-2 bg-neutral-800/40 rounded mb-1.5">
                      <strong className="text-neutral-200">{ds.name}</strong>
                      <span className="text-neutral-400">
                        {ds.requests ?? candidate.fills} requests / fills
                      </span>
                    </div>

                    <div className="p-table-wrap">
                      <table
                        className="p-table text-xs"
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
                          <tr className="bg-cyan-950/10">
                            <td>
                              <strong className="text-cyan-300">Candidate ({candidateId})</strong>
                            </td>
                            <td>
                              <strong
                                className={
                                  candidate.netUsd >= 0 ? "text-emerald-400" : "text-rose-400"
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
                            <tr className="text-neutral-400">
                              <td>Incumbent ({incumbentId})</td>
                              <td
                                className={
                                  incumbent.netUsd >= 0 ? "text-emerald-500" : "text-rose-500"
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
                            <tr className="border-t border-neutral-800 font-medium">
                              <td className="text-neutral-400 italic">Advantage / Delta</td>
                              <td className={netDelta >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                {netDelta >= 0
                                  ? `+${formatUsdOrUnavailable(netDelta)}`
                                  : formatUsdOrUnavailable(netDelta)}
                              </td>
                              <td className="text-neutral-400">—</td>
                              <td className={ddDelta <= 0 ? "text-emerald-400" : "text-rose-400"}>
                                {ddDelta <= 0
                                  ? `${(ddDelta * 100).toFixed(2)}%`
                                  : `+${(ddDelta * 100).toFixed(2)}%`}
                              </td>
                              <td className="text-neutral-400">
                                {(candidate.avgHalfSpreadBps - incumbent.avgHalfSpreadBps).toFixed(
                                  1,
                                )}{" "}
                                bps
                              </td>
                              <td className="text-neutral-400">
                                {(
                                  (candidate.honestFillRate - incumbent.honestFillRate) *
                                  100
                                ).toFixed(1)}
                                %
                              </td>
                              <td className="text-neutral-400">
                                {((candidate.rejectRate - incumbent.rejectRate) * 100).toFixed(1)}%
                              </td>
                              <td className="text-neutral-400">
                                {candidate.attackerTakeUsd !== undefined &&
                                incumbent.attackerTakeUsd !== undefined
                                  ? formatUsdOrUnavailable(
                                      candidate.attackerTakeUsd - incumbent.attackerTakeUsd,
                                    )
                                  : "—"}
                              </td>
                              <td className="text-neutral-400">—</td>
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

      <p className="text-xs text-neutral-400 mt-4 border-t border-neutral-800 pt-3">
        * All evaluation metrics are paper simulations evaluated against historical and replayed
        market tape; they do not represent live-money guarantees or settled transaction performance.
      </p>
    </div>
  );
}
