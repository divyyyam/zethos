"use client";

import {
  describeClamp,
  describeReference,
  describeTerm,
  describeTtl,
  type PolicySpec,
} from "../../../lib/engine/research-types";
import styles from "./research.module.css";

export function PolicySpecView({ spec }: { spec: PolicySpec | undefined }) {
  if (!spec) {
    return (
      <div className="d-card">
        <div className="d-card-head">
          <div>
            <h2>Strategy details</h2>
            <p>The idea behind the candidate and how it prices a trade.</p>
          </div>
        </div>
        <p className="d-empty-line">Select a strategy to see its specification.</p>
      </div>
    );
  }

  const referenceDescription = describeReference(spec.reference);
  const ttlDescription = describeTtl(spec.ttl);
  const clampDescription = describeClamp(spec.clamp);

  return (
    <div className="d-card">
      <div className="d-card-head">
        <div>
          <h2>Strategy details</h2>
          <p>
            <span className="font-mono">{spec.id}</span> · Challenges {spec.parent}
          </p>
        </div>
        <span className="p-pill p-pill-neutral">{spec.pairs.join(", ")}</span>
      </div>

      <div className={styles.inset}>
        <span className={styles.eyebrow}>What this strategy tests</span>
        <p>{spec.hypothesis}</p>
      </div>

      <dl className={styles.parameters}>
        <div>
          <dt>Reference price</dt>
          <dd>{referenceDescription}</dd>
        </div>
        <div>
          <dt>Spread limits</dt>
          <dd>{clampDescription}</dd>
        </div>
        <div>
          <dt>Quote lifetime</dt>
          <dd>{ttlDescription}</dd>
        </div>
      </dl>

      <details className={styles.details} key={spec.id}>
        <summary>Pricing components and safeguards · {spec.terms.length} components</summary>
        {spec.rejectIf && Object.keys(spec.rejectIf).length > 0 && (
          <div className="mt-4">
            <h3 className={styles.eyebrow}>When quotes are refused</h3>
            <ul className={styles.terms}>
              {spec.rejectIf.maxSigma1 !== undefined && (
                <li>Reject if 1-second volatility exceeds {spec.rejectIf.maxSigma1}</li>
              )}
              {spec.rejectIf.minSources !== undefined && (
                <li>Reject if healthy feed venues drop below {spec.rejectIf.minSources}</li>
              )}
              {spec.rejectIf.leadDivergenceBps !== undefined && (
                <li>
                  Reject if lead venue divergence exceeds {spec.rejectIf.leadDivergenceBps} bps
                </li>
              )}
            </ul>
          </div>
        )}

        <h3 className={`${styles.eyebrow} mt-4`}>Pricing components, in order</h3>
        <ol className={styles.terms}>
          {spec.terms.map((term) => {
            const readableLine = describeTerm(term);
            return <li key={term.kind}>{readableLine}</li>;
          })}
        </ol>
      </details>
    </div>
  );
}
