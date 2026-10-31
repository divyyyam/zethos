"use client";
import { ChevronDown } from "lucide-react";
import { BrandMark } from "../primitives";
import type { OperatorDashboardState } from "./use-operator-dashboard";

type Props = Pick<OperatorDashboardState, "decisions" | "journal"> & { preview: boolean };

export function OperatorJournal({ preview, decisions, journal }: Props) {
  return (
    <section className="p-card p-journal-card" aria-labelledby="journal-title">
      <div className="p-card-header">
        <div>
          <h2 id="journal-title">Decision log</h2>
          <p>A clear reason behind every move.</p>
        </div>
        <span className="p-pill p-pill-neutral">
          {preview ? "Sample decisions" : "Decision log"}
        </span>
      </div>
      {journal?.length ? (
        <div className="p-journal-list">
          {journal.map((decision) => (
            <details key={decision.id}>
              <summary>
                <span className="p-decision-mark">
                  <BrandMark className="size-4" />
                </span>
                <span className="p-decision-copy">
                  <small>{decision.type}</small>
                  <strong>{decision.reason}</strong>
                </span>
                <time
                  dateTime={new Date(
                    decision.ts > 1e12 ? decision.ts : decision.ts * 1000,
                  ).toISOString()}
                >
                  {new Intl.DateTimeFormat("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Kolkata",
                  }).format(decision.ts > 1e12 ? decision.ts : decision.ts * 1000)}{" "}
                  IST
                </time>
                <ChevronDown size={14} />
              </summary>
              <div className="p-decision-detail">
                <p>
                  {preview
                    ? "This example illustrates a recorded decision. Live entries come directly from the engine’s decision log."
                    : decision.reason}
                </p>
                {decision.inputs && <pre>{JSON.stringify(decision.inputs, null, 2)}</pre>}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <p className="p-journal-empty">
          {decisions.isFetching
            ? "Reading the latest decisions…"
            : "Zethos’s recorded decisions will appear here."}
        </p>
      )}
    </section>
  );
}
