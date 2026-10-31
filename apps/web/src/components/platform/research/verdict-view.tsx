"use client";

import { Check, X } from "lucide-react";
import type { EvaluationReport } from "../../../lib/engine/research-types";
import styles from "./research.module.css";

export function VerdictView({ report }: { report: EvaluationReport | null | undefined }) {
  if (!report?.verdict) {
    return (
      <div className="d-card">
        <div className="d-card-head">
          <div>
            <h2>Qualification</h2>
            <p>The checks a strategy must pass before a canary trial.</p>
          </div>
        </div>
        <div className={styles.empty}>
          <span className="p-pill p-pill-neutral">Pending Evaluation</span>
          <p>This candidate has not been evaluated and is not yet qualified for a canary trial.</p>
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
        <div>
          <h2>Qualification</h2>
          <p>Every check must pass before a candidate can enter a canary trial.</p>
        </div>
        <span
          className={`p-pill ${styles.status} ${qualified ? "p-pill-success" : styles.rejected}`}
        >
          {qualified ? "Qualified" : "Rejected"}
        </span>
      </div>

      <div className="p-table-wrap">
        <table className={`p-table ${styles.table}`} aria-label="Qualification verdict rules table">
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
                      <strong className={styles.ruleTitle}>{ruleTitle}</strong>
                      <span className={`font-mono text-xs ${styles.muted}`}>{reason.rule}</span>
                      {reason.detail ? (
                        <span className={styles.ruleDetail}>{reason.detail}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`p-pill ${styles.status} ${reason.passed ? "p-pill-success" : styles.rejected}`}
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
                  <td className="font-mono">{formatValue(reason.candidate)}</td>
                  <td className={`font-mono ${styles.muted}`}>{formatValue(reason.incumbent)}</td>
                  <td className={`font-mono ${styles.muted}`}>{formatValue(reason.threshold)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
