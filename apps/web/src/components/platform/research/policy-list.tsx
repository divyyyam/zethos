"use client";

import { CheckCircle2, ChevronRight, Filter } from "lucide-react";
import {
  POLICY_STATUSES,
  type PolicyLifecycleStatus,
  type PolicySummary,
} from "../../../lib/engine/policies";
import styles from "./research.module.css";

const STATUS_BADGE_CLASSES: Record<PolicyLifecycleStatus, string> = {
  incumbent: "p-pill-success",
  canary: styles.canary ?? "p-pill-neutral",
  qualified: "p-pill-success",
  rejected: styles.rejected ?? "p-pill-neutral",
  draft: "p-pill-neutral",
  retired: "p-pill-neutral",
};

export function PolicyList({
  policies,
  selectedId,
  onSelect,
  statusFilter,
  onFilterChange,
  isLoading,
}: {
  policies: PolicySummary[];
  selectedId: string;
  onSelect: (id: string) => void;
  statusFilter: string;
  onFilterChange: (status: string) => void;
  isLoading: boolean;
}) {
  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div>
          <h2>Strategy library</h2>
          <p>Explore candidates, canary trials, and the current strategy.</p>
        </div>

        <div className={styles.filter}>
          <Filter size={14} aria-hidden />
          <select
            value={statusFilter}
            onChange={(e) => onFilterChange(e.target.value)}
            aria-label="Filter policies by status"
          >
            <option value="all">All statuses</option>
            {POLICY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="p-table-wrap">
        <table className={`p-table ${styles.table}`} aria-label="Policy pipeline registry table">
          <thead>
            <tr>
              <th scope="col">Policy ID</th>
              <th scope="col">Status</th>
              <th scope="col">Parent</th>
              <th scope="col">Hypothesis</th>
              <th scope="col">Created</th>
              <th scope="col" className={styles.right}>
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className={styles.muted}>
                  Loading policy registry...
                </td>
              </tr>
            ) : policies.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.muted}>
                  No policies found matching filter
                </td>
              </tr>
            ) : (
              policies.map((policy) => {
                const isSelected = policy.id === selectedId;
                const badgeClass = STATUS_BADGE_CLASSES[policy.status] ?? "p-pill-neutral";

                return (
                  <tr
                    key={policy.id}
                    className={`${styles.registryRow} ${isSelected ? styles.selected : ""}`}
                    onClick={() => onSelect(policy.id)}
                  >
                    <td>
                      <div className={styles.policyId}>
                        {isSelected && <CheckCircle2 size={13} aria-hidden />}
                        <strong className="font-mono text-xs">{policy.id}</strong>
                      </div>
                    </td>
                    <td>
                      <span className={`p-pill ${styles.status} ${badgeClass}`}>
                        {policy.status}
                      </span>
                    </td>
                    <td>
                      <span className={`font-mono text-xs ${styles.muted}`}>{policy.parent}</span>
                    </td>
                    <td>
                      <p className={`${styles.hypothesis} line-clamp-2`} title={policy.hypothesis}>
                        {policy.hypothesis}
                      </p>
                    </td>
                    <td>
                      <time
                        className={styles.date}
                        dateTime={new Date(policy.createdAt).toISOString()}
                      >
                        {formatDate(policy.createdAt)}
                      </time>
                    </td>
                    <td className={styles.right}>
                      <button
                        type="button"
                        className={styles.inspect}
                        aria-pressed={isSelected}
                        aria-label={`Inspect policy ${policy.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(policy.id);
                        }}
                      >
                        {isSelected ? "Inspecting" : "Inspect"}
                        <ChevronRight size={12} aria-hidden />
                      </button>
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
