"use client";

import { Check, X } from "lucide-react";
import type { EvaluationReport } from "../../../lib/engine/research-types";

export function VerdictView({ report }: { report: EvaluationReport | null | undefined }) {
  if (!report?.verdict) {
    return (
      <div className="d-card">
        <div className="d-card-head">
          <h2>Qualification Verdict</h2>
          <p>Mandate qualification gates and promotion criteria</p>
        </div>
        <div className="py-4 text-center text-neutral-400">
          <span className="p-pill p-pill-neutral">Pending Evaluation</span>
          <p className="text-xs text-neutral-400 mt-2">
            This candidate does not yet have a qualification report. Do not treat un-evaluated
            candidates as qualified.
          </p>
        </div>
      </div>
    );
  }

  const { qualified, reasons } = report.verdict;

  const formatValue = (val: number | string | boolean | undefined) => {
    if (val === undefined || val === null) return "—";
    if (typeof val === "boolean") return val ? "True" : "False";
    if (typeof val === "number") {
      // If it looks like a fraction between -1 and 1 (and not 0), format with 4 decimal places
      if (Math.abs(val) > 0 && Math.abs(val) < 1) {
        return `${(val * 100).toFixed(2)}%`;
      }
      return val.toFixed(2);
    }
    return String(val);
  };

  const RULE_LABELS: Record<string, string> = {
    must_beat_held_out: "Must beat incumbent on out-of-sample held-out dataset",
    max_drawdown_delta: "Max drawdown delta within tolerance against incumbent",
    min_honest_fill_rate: "Minimum honest-taker fill rate preserved",
    max_reject_rate: "Maximum quote reject rate ceiling",
    honest_fill_tolerance: "Honest fill drop tolerance",
  };

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2>Qualification Verdict</h2>
            <p>Mandate qualification rules: all rules must pass to qualify for canary</p>
          </div>
          <span
            className={`p-pill text-xs font-semibold px-3 py-1 ${
              qualified
                ? "p-pill-success border border-emerald-500/50"
                : "p-pill-neutral text-rose-400 border border-rose-800/80 bg-rose-950/20"
            }`}
          >
            {qualified ? "QUALIFIED" : "REJECTED"}
          </span>
        </div>
      </div>

      <div className="p-table-wrap">
        <table className="p-table text-xs" aria-label="Qualification verdict rules table">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Status</th>
              <th scope="col">Candidate Value</th>
              <th scope="col">Incumbent Value</th>
              <th scope="col">Mandate Threshold</th>
            </tr>
          </thead>
          <tbody>
            {reasons.map((reason) => {
              const ruleTitle = RULE_LABELS[reason.rule] ?? reason.rule.replaceAll("_", " ");
              return (
                <tr key={reason.rule}>
                  <td>
                    <div>
                      <strong className="text-neutral-200 block">{ruleTitle}</strong>
                      <span className="font-mono text-neutral-400 text-xs">{reason.rule}</span>
                      {reason.detail ? (
                        <span className="text-neutral-400 text-xs block mt-1">{reason.detail}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded text-xs ${
                        reason.passed
                          ? "text-emerald-400 bg-emerald-950/30 border border-emerald-800/40"
                          : "text-rose-400 bg-rose-950/30 border border-rose-800/40"
                      }`}
                    >
                      {reason.passed ? (
                        <>
                          <Check size={12} aria-hidden />
                          Passed
                        </>
                      ) : (
                        <>
                          <X size={12} aria-hidden />
                          Failed
                        </>
                      )}
                    </span>
                  </td>
                  <td className="font-mono text-neutral-100">{formatValue(reason.candidate)}</td>
                  <td className="font-mono text-neutral-400">{formatValue(reason.incumbent)}</td>
                  <td className="font-mono text-neutral-400">{formatValue(reason.threshold)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
