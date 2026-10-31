"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Arena, Status } from "@zethos/sdk";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { erc20Abi, formatUnits, parseAbi } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { zethos } from "../../lib/engine/sdk";
import { type PlatformToken, platformConfig } from "../../lib/platform-config";

export function useEngineStatus() {
  return useQuery({
    queryKey: ["engine", "status"],
    queryFn: () => {
      if (!zethos) throw new Error("The live service isn’t connected yet.");
      return zethos.status();
    },
    enabled: Boolean(zethos),
    staleTime: 10000,
    refetchInterval: 15000,
    retry: false,
  });
}
export function useTokenBalance(token: PlatformToken, enabled = true) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: platformConfig.chain.id });
  return useQuery({
    queryKey: ["token-balance", platformConfig.chain.id, token.address, address],
    enabled: enabled && Boolean(token.address && address && client),
    refetchInterval: 20000,
    staleTime: 10000,
    retry: 1,
    queryFn: async () => {
      if (!token.address || !address || !client)
        throw new Error("Connect a wallet to read your token balance.");
      const [value, decimals, symbol] = await Promise.all([
        client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        client.readContract({ address: token.address, abi: erc20Abi, functionName: "decimals" }),
        client.readContract({ address: token.address, abi: erc20Abi, functionName: "symbol" }),
      ]);
      if (symbol.toUpperCase() !== token.label.toUpperCase() || decimals > 36)
        throw new Error("The configured token doesn’t match this asset.");
      return { value, decimals, symbol, formatted: formatUnits(value, decimals) };
    },
  });
}
const ownershipAbi = parseAbi(["function owner() view returns (address)"]);
export function useVaultOwner() {
  const status = useEngineStatus();
  const client = usePublicClient({ chainId: platformConfig.chain.id });
  const { address } = useAccount();
  const query = useQuery({
    queryKey: ["vault-owner", platformConfig.chain.id, platformConfig.vaultAddress],
    enabled: Boolean(status.data?.mode !== "shadow" && client && platformConfig.vaultAddress),
    staleTime: 30000,
    retry: false,
    queryFn: async () => {
      if (!client || !platformConfig.vaultAddress) throw new Error("The vault is not configured.");
      return client.readContract({
        address: platformConfig.vaultAddress,
        abi: ownershipAbi,
        functionName: "owner",
      });
    },
  });
  const paperOwner = status.data?.mode === "shadow" ? status.data.operator : null;
  const owner = status.data?.mode === "shadow" ? paperOwner : query.data;
  return {
    ...query,
    data: owner,
    refetch: async () =>
      status.data?.mode === "shadow"
        ? { data: (await status.refetch()).data?.operator ?? null }
        : query.refetch(),
    isOwner: Boolean(address && owner && address.toLowerCase() === owner.toLowerCase()),
  };
}

/** One public stream per app shell. Events invalidate typed REST queries; no trading runs here. */
function useConnectEngineStream() {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!zethos) return;
    let flush: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    const invalidate = (keys: string[]) => {
      for (const key of keys) pending.add(key);
      flush ??= setTimeout(() => {
        for (const key of pending)
          void queryClient.invalidateQueries({ queryKey: ["engine", key] });
        pending.clear();
        flush = undefined;
      }, 500);
    };
    // Price frames arrive every heartbeat; refetching on each would spend the engine's request
    // budget. Status polls on its own interval instead.
    const unsubscribe = zethos.stream({
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      price: ({ pair, mid, health, ts }) =>
        queryClient.setQueryData<Status>(["engine", "status"], (previous) =>
          previous
            ? {
                ...previous,
                pairs: previous.pairs.map((p) =>
                  p.pair === pair
                    ? { ...p, mid, health, updatedAt: ts, halted: p.halted || health === "down" }
                    : p,
                ),
              }
            : previous,
        ),
      fill: () => invalidate(["fills", "arenaTakers"]),
      decision: () => invalidate(["decisions"]),
      risk: ({ paused, riskState, halted }) =>
        queryClient.setQueryData<Status>(["engine", "status"], (previous) =>
          previous
            ? {
                ...previous,
                paused,
                riskState,
                pairs: previous.pairs.map((p) => ({
                  ...p,
                  halted: halted.includes(p.pair) || p.health === "down",
                })),
              }
            : previous,
        ),
      takerTier: () => invalidate(["arenaTakers", "decisions"]),
      params: () => invalidate(["status"]),
      arena: ({ arena }) =>
        queryClient.setQueryData<Arena>(["engine", "arena"], (previous) =>
          previous
            ? {
                ...previous,
                ...arena,
                series: arena.valuationStale
                  ? previous.series
                  : (previous.epoch === arena.epoch
                      ? [
                          ...previous.series,
                          { t: Date.now(), equity: arena.equityUsd, byFlow: arena.byFlow },
                        ]
                      : []
                    ).slice(-1800),
              }
            : previous,
        ),
    });
    return () => {
      if (flush) clearTimeout(flush);
      unsubscribe();
    };
  }, [queryClient]);
  return connected;
}

const StreamContext = createContext(false);
export function EngineStreamProvider({ children }: { children: ReactNode }) {
  const connected = useConnectEngineStream();
  return createElement(StreamContext.Provider, { value: connected }, children);
}
export function useEngineStream() {
  return useContext(StreamContext);
}
