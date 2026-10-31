"use client";

import {
  describeClamp,
  describeReference,
  describeTerm,
  describeTtl,
  type PolicySpec,
} from "../../../lib/engine/research-types";

export function PolicySpecView({ spec }: { spec: PolicySpec | undefined }) {
  if (!spec) {
    return (
      <div className="d-card">
        <div className="d-card-head">
          <h2>Policy Specification</h2>
          <p>Deterministic pricing function configuration</p>
        </div>
        <p className="text-neutral-400 text-sm py-4">No policy specification selected</p>
      </div>
    );
  }

  const referenceDescription = describeReference(spec.reference);
  const ttlDescription = describeTtl(spec.ttl);
  const clampDescription = describeClamp(spec.clamp);

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2>Policy Specification: {spec.id}</h2>
            <p>Challenges parent: {spec.parent}</p>
          </div>
          <span className="text-xs text-neutral-400 font-mono">Pairs: {spec.pairs.join(", ")}</span>
        </div>
      </div>

      <div className="bg-neutral-900/60 border border-neutral-800 rounded-md p-3.5 mb-5">
        <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider block mb-1">
          Hypothesis
        </span>
        <p className="text-sm text-neutral-200">{spec.hypothesis}</p>
      </div>

      {/* Structural Bounds & Parameters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5 text-xs">
        <div className="bg-neutral-900/40 border border-neutral-800/80 rounded p-3">
          <span className="text-neutral-400 block mb-1">Reference Mid Pricing</span>
          <strong className="text-neutral-200 font-medium">{referenceDescription}</strong>
        </div>
        <div className="bg-neutral-900/40 border border-neutral-800/80 rounded p-3">
          <span className="text-neutral-400 block mb-1">Spread Clamp Limits</span>
          <strong className="text-neutral-200 font-medium font-mono">{clampDescription}</strong>
        </div>
        <div className="bg-neutral-900/40 border border-neutral-800/80 rounded p-3">
          <span className="text-neutral-400 block mb-1">Quote TTL Scaling</span>
          <strong className="text-neutral-200 font-medium">{ttlDescription}</strong>
        </div>
      </div>

      {/* Reject Rules If Present */}
      {spec.rejectIf && Object.keys(spec.rejectIf).length > 0 && (
        <div className="bg-neutral-900/30 border border-neutral-800/60 rounded p-3 mb-5 text-xs">
          <span className="text-neutral-400 block mb-1 font-semibold">
            Pre-Quote Rejection Guards
          </span>
          <ul className="list-disc list-inside text-neutral-300 space-y-0.5">
            {spec.rejectIf.maxSigma1 !== undefined && (
              <li>Reject if 1-second volatility exceeds {spec.rejectIf.maxSigma1}</li>
            )}
            {spec.rejectIf.minSources !== undefined && (
              <li>Reject if healthy feed venues drop below {spec.rejectIf.minSources}</li>
            )}
            {spec.rejectIf.leadDivergenceBps !== undefined && (
              <li>Reject if lead venue divergence exceeds {spec.rejectIf.leadDivergenceBps} bps</li>
            )}
          </ul>
        </div>
      )}

      {/* Terms and Components List - One readable line per component */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-neutral-400 mb-2 font-medium">
          Pricing Terms & Defense Components ({spec.terms.length})
        </h3>
        <ol className="space-y-2 text-xs">
          {spec.terms.map((term, index) => {
            const readableLine = describeTerm(term);
            return (
              <li
                key={term.kind}
                className="flex items-start gap-2 bg-neutral-900/40 border border-neutral-800/60 rounded px-3 py-2"
              >
                <span className="font-mono text-neutral-500 font-bold shrink-0">{index + 1}.</span>
                <span className="text-neutral-200 font-medium">{readableLine}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
