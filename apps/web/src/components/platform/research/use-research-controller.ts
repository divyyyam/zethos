"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { fetchPolicies, type PolicySummary } from "../../../lib/engine/policies";
import { fetchDiagnosis, fetchPolicyDetail } from "../../../lib/engine/research-types";
import { platformConfig } from "../../../lib/platform-config";

export function useResearchController() {
  const sample = !platformConfig.engineUrl;
  const [selectedId, setSelectedId] = useState<string>("p-20261101-leadlag1");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const policiesQuery = useQuery({
    queryKey: ["engine", "policies"],
    queryFn: () => fetchPolicies(),
    retry: false,
    refetchInterval: 30000,
  });

  // Select default policy once policies load
  useEffect(() => {
    if (policiesQuery.data && policiesQuery.data.length > 0) {
      const exists = policiesQuery.data.some((p) => p.id === selectedId);
      if (!exists) {
        // Prefer canary, then incumbent, then first policy
        const canary = policiesQuery.data.find((p) => p.status === "canary");
        const incumbent = policiesQuery.data.find((p) => p.status === "incumbent");
        const fallback = canary?.id ?? incumbent?.id ?? policiesQuery.data[0]?.id;
        if (fallback) setSelectedId(fallback);
      }
    }
  }, [policiesQuery.data, selectedId]);

  const detailQuery = useQuery({
    queryKey: ["engine", "policy", selectedId],
    queryFn: () => fetchPolicyDetail(selectedId),
    enabled: Boolean(selectedId),
    retry: false,
    refetchInterval: 30000,
  });

  const diagnosisQuery = useQuery({
    queryKey: ["engine", "diagnosis"],
    queryFn: () => fetchDiagnosis(),
    retry: false,
    refetchInterval: 30000,
  });

  const filteredPolicies: PolicySummary[] = useMemo(() => {
    const list = policiesQuery.data ?? [];
    if (statusFilter === "all") return list;
    return list.filter((p) => p.status === statusFilter);
  }, [policiesQuery.data, statusFilter]);

  const refresh = () => {
    void policiesQuery.refetch();
    void detailQuery.refetch();
    void diagnosisQuery.refetch();
  };

  return {
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
  };
}

export type ResearchController = ReturnType<typeof useResearchController>;
