"use client";

import { CheckCircle2, ChevronRight, Filter } from "lucide-react";
import {
  POLICY_STATUSES,
  type PolicyLifecycleStatus,
  type PolicySummary,
} from "../../../lib/engine/policies";

const STATUS_BADGE_CLASSES: Record<PolicyLifecycleStatus, string> = {
  incumbent: "p-pill-success",
  canary: "p-pill-neutral font-semibold text-cyan-400 border border-cyan-800/60",
  qualified: "p-pill-success border border-emerald-800/60",
  rejected: "p-pill-neutral text-rose-400 border border-rose-900/60",
  draft: "p-pill-neutral text-neutral-400 border border-neutral-700",
  retired: "p-pill-neutral opacity-60 text-neutral-500",
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2>Policy Registry</h2>
            <p>Autonomous strategy pipeline: candidates, canaries, and incumbent</p>
          </div>

          <div className="flex items-center gap-2">
            <Filter size={14} className="text-neutral-400" aria-hidden />
            <select
              className="bg-neutral-900 border border-neutral-700 text-xs rounded px-2.5 py-1 text-neutral-200 focus:outline-none focus:border-neutral-500"
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
      </div>

      <div className="p-table-wrap">
        <table className="p-table" aria-label="Policy pipeline registry table">
          <thead>
            <tr>
              <th scope="col">Policy ID</th>
              <th scope="col">Status</th>
              <th scope="col">Parent</th>
              <th scope="col">Hypothesis</th>
              <th scope="col">Created</th>
              <th scope="col" className="text-right">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="text-center py-6 text-neutral-400">
                  Loading policy registry...
                </td>
              </tr>
            ) : policies.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-6 text-neutral-400">
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
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-neutral-800/40 hover:bg-neutral-800/60"
                        : "hover:bg-neutral-900/40"
                    }`}
                    onClick={() => onSelect(policy.id)}
                  >
                    <td>
                      <div className="flex items-center gap-1.5">
                        {isSelected && (
                          <CheckCircle2 size={13} className="text-cyan-400 shrink-0" aria-hidden />
                        )}
                        <strong className="font-mono text-xs">{policy.id}</strong>
                      </div>
                    </td>
                    <td>
                      <span className={`p-pill ${badgeClass} capitalize text-xs`}>
                        {policy.status}
                      </span>
                    </td>
                    <td>
                      <span className="font-mono text-xs text-neutral-400">{policy.parent}</span>
                    </td>
                    <td className="max-w-xs md:max-w-md">
                      <p
                        className="text-xs text-neutral-300 line-clamp-2"
                        title={policy.hypothesis}
                      >
                        {policy.hypothesis}
                      </p>
                    </td>
                    <td>
                      <time className="text-xs text-neutral-400 whitespace-nowrap">
                        {formatDate(policy.createdAt)}
                      </time>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className={`text-xs px-2.5 py-1 rounded inline-flex items-center gap-1 ${
                          isSelected
                            ? "bg-cyan-900/40 text-cyan-300 border border-cyan-700/50"
                            : "text-neutral-400 hover:text-neutral-200"
                        }`}
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
