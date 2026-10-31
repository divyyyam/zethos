"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useEngineStatus } from "../../../hooks/platform/use-platform";
import {
  computeObservedInventoryShares,
  fetchMandate,
  type ObservedPairInventory,
} from "../../../lib/engine/desk-types";
import { fetchPolicies, type PolicySummary } from "../../../lib/engine/policies";
import { zethos } from "../../../lib/engine/sdk";
import { platformConfig } from "../../../lib/platform-config";

export function useDeskController() {
  const sample = !platformConfig.engineUrl;
  const status = useEngineStatus();

  const arena = useQuery({
    queryKey: ["engine", "arena"],
    queryFn: () => {
      if (!zethos) throw new Error("Engine is not configured");
      return zethos.arena();
    },
    enabled: Boolean(zethos),
    refetchInterval: 15000,
    retry: false,
  });

  const mandate = useQuery({
    queryKey: ["engine", "mandate"],
    queryFn: () => fetchMandate(),
    retry: false,
    refetchInterval: 30000,
  });

  const policies = useQuery({
    queryKey: ["engine", "policies"],
    queryFn: () => fetchPolicies(),
    retry: false,
    refetchInterval: 30000,
  });

  const observedInventory: ObservedPairInventory[] = useMemo(() => {
    const pairs = status.data?.pairs ?? [];
    const inventory = status.data?.inventory ?? {};
    return computeObservedInventoryShares(pairs, inventory);
  }, [status.data?.pairs, status.data?.inventory]);

  const incumbentPolicy: PolicySummary | undefined = useMemo(() => {
    return policies.data?.find((p) => p.status === "incumbent");
  }, [policies.data]);

  const canaryPolicy: PolicySummary | undefined = useMemo(() => {
    return policies.data?.find((p) => p.status === "canary");
  }, [policies.data]);

  // Observed operating loss calculation:
  // Epoch loss in paper vault is adverse P&L (if net P&L < 0, loss is |pnl|)
  const observedLossUsd: number | null = useMemo(() => {
    if (!arena.data?.pnl) return null;
    const totalPnl = arena.data.pnl.total;
    return totalPnl < 0 ? Math.abs(totalPnl) : 0;
  }, [arena.data?.pnl]);

  const valuationStale = Boolean(arena.data?.valuationStale);

  const refresh = () => {
    void status.refetch();
    void arena.refetch();
    void mandate.refetch();
    void policies.refetch();
  };

  const error = mandate.error ?? status.error ?? arena.error ?? policies.error;

  return {
    sample,
    status,
    arena,
    mandate,
    policies,
    observedInventory,
    incumbentPolicy,
    canaryPolicy,
    observedLossUsd,
    valuationStale,
    refresh,
    error,
  };
}

export type DeskController = ReturnType<typeof useDeskController>;
