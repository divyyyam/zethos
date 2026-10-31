"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { formatFractionAsPct, formatPct, type Mandate } from "../../../lib/engine/desk-types";
import type { PolicySummary } from "../../../lib/engine/policies";

export function ActivePoliciesCard({
  mandate,
  incumbent,
  canary,
}: {
  mandate: Mandate | undefined;
  incumbent: PolicySummary | undefined;
  canary: PolicySummary | undefined;
}) {
  const canaryMaxAllocationPct = formatPct(mandate?.canary.maxAllocationPct);
  const minFillsBeforePromote = mandate?.canary.minFillsBeforePromote ?? "Unavailable";
  const retireDrawdownPct = formatFractionAsPct(mandate?.canary.retireDrawdownPct);
  const retireFillRateDrop = formatFractionAsPct(mandate?.canary.retireFillRateDrop);

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div className="flex items-center justify-between gap-2">
          <h2>Active Strategy Policies</h2>
          <Link href="/research" className="p-text-link">
            Open Research <ArrowUpRight size={13} aria-hidden />
          </Link>
        </div>
        <p>Incumbent production policy and challenging canary allocation</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Incumbent Policy */}
        <div className="p-metric p-metric-featured">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-neutral-200">Incumbent Policy</span>
            <span className="p-pill p-pill-success">Incumbent</span>
          </div>
          <strong className="text-sm font-mono text-neutral-100 my-1">
            {incumbent?.id ?? "None active"}
          </strong>
          <small>
            Allocation:{" "}
            <b>
              {incumbent?.allocationPct !== undefined
                ? formatPct(incumbent.allocationPct)
                : canary?.allocationPct !== undefined
                  ? formatPct(100 - canary.allocationPct)
                  : "100.0%"}
            </b>
          </small>
          {incumbent?.hypothesis && (
            <p className="text-xs text-neutral-400 mt-2 line-clamp-2">{incumbent.hypothesis}</p>
          )}
        </div>

        {/* Canary Policy */}
        <div className="p-metric">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-neutral-200">Canary Challenger</span>
            <span className={`p-pill ${canary ? "p-pill-neutral" : "p-pill-neutral opacity-50"}`}>
              {canary ? "Canary" : "No Canary"}
            </span>
          </div>
          {canary ? (
            <>
              <strong className="text-sm font-mono text-neutral-100 my-1">{canary.id}</strong>
              <small>
                Allocation: <b>{formatPct(canary.allocationPct)}</b> (Cap: {canaryMaxAllocationPct})
              </small>
              {canary.hypothesis && (
                <p className="text-xs text-neutral-400 mt-2 line-clamp-2">{canary.hypothesis}</p>
              )}
            </>
          ) : (
            <>
              <strong className="text-sm text-neutral-400 my-1">None Active</strong>
              <small>All quote flow routes to the incumbent policy</small>
              <p className="text-xs text-neutral-400 mt-2">
                Canary allocation cap: {canaryMaxAllocationPct}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Canary Mandate Safeguards */}
      <div className="border-t border-neutral-800 pt-3">
        <h3 className="text-xs uppercase tracking-wider text-neutral-400 mb-2 font-medium">
          Canary Lifecycle Safeguards (Mandate)
        </h3>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div>
            <dt className="text-neutral-400">Max Allocation</dt>
            <dd className="font-mono text-neutral-200 font-medium">{canaryMaxAllocationPct}</dd>
          </div>
          <div>
            <dt className="text-neutral-400">Min Fills to Promote</dt>
            <dd className="font-mono text-neutral-200 font-medium">{minFillsBeforePromote}</dd>
          </div>
          <div>
            <dt className="text-neutral-400">Retire Drawdown</dt>
            <dd className="font-mono text-neutral-200 font-medium">{retireDrawdownPct}</dd>
          </div>
          <div>
            <dt className="text-neutral-400">Retire Fill-Rate Drop</dt>
            <dd className="font-mono text-neutral-200 font-medium">{retireFillRateDrop}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
