"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useEngineStream } from "../../../hooks/platform/use-platform";
import { zethos } from "../../../lib/engine/sdk";

export function useArenaController() {
  const connected = useEngineStream();
  const [filter, setFilter] = useState("");
  const arena = useQuery({
    queryKey: ["engine", "arena"],
    queryFn: () => {
      if (!zethos) throw new Error("Configure NEXT_PUBLIC_ENGINE_URL to open the paper Arena.");
      return zethos.arena();
    },
    enabled: Boolean(zethos),
    refetchInterval: 15000,
    retry: false,
  });
  const takers = useQuery({
    queryKey: ["engine", "arenaTakers"],
    queryFn: () => {
      if (!zethos) throw new Error("Engine is not configured");
      return zethos.arenaTakers({ limit: 100 });
    },
    enabled: Boolean(zethos),
    refetchInterval: 15000,
    retry: false,
  });
  const fills = useQuery({
    queryKey: ["engine", "fills", "arena", arena.data?.epoch],
    queryFn: () => {
      if (!zethos || !arena.data) throw new Error("Engine is not configured");
      return zethos.fills({ limit: 100, epoch: arena.data.epoch });
    },
    enabled: Boolean(zethos && arena.data),
    refetchInterval: 15000,
    retry: false,
  });
  const decisions = useQuery({
    queryKey: ["engine", "decisions"],
    queryFn: () => {
      if (!zethos) throw new Error("Engine is not configured");
      return zethos.decisions({ limit: 100 });
    },
    enabled: Boolean(zethos),
    refetchInterval: 15000,
    retry: false,
  });
  const refresh = () => {
    void arena.refetch();
    void takers.refetch();
    void fills.refetch();
    void decisions.refetch();
  };
  const error = arena.error ?? takers.error ?? fills.error ?? decisions.error;
  return { connected, filter, setFilter, arena, takers, fills, decisions, refresh, error };
}
export type ArenaPageContentState = ReturnType<typeof useArenaController>;
