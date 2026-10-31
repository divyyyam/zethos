"use client";

import { RefreshCw } from "lucide-react";
import { failureMessage } from "../../../lib/engine/sdk";
import { StatusDot } from "../primitives";
import { CanaryStatsView } from "./canary-stats-view";
import { DiagnosisView } from "./diagnosis-view";
import { EvaluationTable } from "./evaluation-table";
import { PolicyList } from "./policy-list";
import { PolicySpecView } from "./policy-spec-view";
import styles from "./research.module.css";
import { useResearchController } from "./use-research-controller";
import { VerdictView } from "./verdict-view";

export function ResearchPage() {
  const {
    sample,
    selectedId,
    setSelectedId,
    statusFilter,
    setStatusFilter,
    policiesQuery,
    filteredPolicies,
    detailQuery,
    diagnosisQuery,
    refresh,
  } = useResearchController();

  const policyDetail = detailQuery.data;
  const isCanary = policyDetail?.status === "canary";

  return (
    <div className={styles.page}>
      <div className="p-page-heading">
        <div>
          <h1>Strategy Research</h1>
          <p>How the desk tests and improves its trading strategies.</p>
        </div>
        <div className="p-page-tools">
          <span className="p-pill p-pill-neutral">
            <StatusDot />
            {sample ? "Sample research data" : "Paper evaluation pipeline"}
          </span>
          <button
            type="button"
            className="p-icon-button"
            aria-label="Refresh research data"
            onClick={refresh}
          >
            <RefreshCw size={16} aria-hidden />
          </button>
        </div>
      </div>

      {/* Global alert if policies query fails and not in sample mode */}
      {policiesQuery.isError && !sample && (
        <p role="alert" className="p-form-error mb-4">
          {failureMessage(policiesQuery.error)}{" "}
          <button
            type="button"
            className="p-text-button"
            onClick={() => void policiesQuery.refetch()}
          >
            Try again
          </button>
        </p>
      )}

      <div className={styles.stack}>
        {/* Policy Registry List */}
        <PolicyList
          policies={filteredPolicies}
          selectedId={selectedId}
          onSelect={setSelectedId}
          statusFilter={statusFilter}
          onFilterChange={setStatusFilter}
          isLoading={policiesQuery.isLoading}
        />

        {/* Selected Policy Specification */}
        <PolicySpecView spec={policyDetail?.spec} />

        {/* Evaluation Benchmark Table (Candidate vs Incumbent grouped by dev, scenario, heldout) */}
        <EvaluationTable report={policyDetail?.report} />

        {/* Qualification Verdict */}
        <VerdictView report={policyDetail?.report} />

        {/* Canary Counterfactual Telemetry (if canary) */}
        <CanaryStatsView canaryStats={policyDetail?.canaryStats} isCanary={isCanary} />

        {/* Loss Attribution Diagnosis (S6) */}
        <DiagnosisView
          diagnosis={diagnosisQuery.data}
          isLoading={diagnosisQuery.isLoading}
          isError={diagnosisQuery.isError}
        />
      </div>
    </div>
  );
}
