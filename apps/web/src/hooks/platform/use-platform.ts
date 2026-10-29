"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, parseAbi } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { engine } from "../../lib/engine/client";
import { type PlatformToken, platformConfig } from "../../lib/platform-config";

export function useEngineStatus() {
  return useQuery({
    queryKey: ["engine", "status"],
    queryFn: ({ signal }) => engine.status(signal),
    enabled: Boolean(platformConfig.engineUrl),
    staleTime: 10000,
    refetchInterval: 15000,
    retry: false,
  });
}
export function useTokenBalance(token: PlatformToken) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: platformConfig.chain.id });
  return useQuery({
    queryKey: ["token-balance", platformConfig.chain.id, token.address, address],
    enabled: Boolean(token.address && address && client),
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
      if (symbol.toUpperCase() !== token.symbol || decimals > 36)
        throw new Error("The configured token doesn’t match this asset.");
      return { value, decimals, symbol, formatted: formatUnits(value, decimals) };
    },
  });
}
const ownershipAbi = parseAbi(["function owner() view returns (address)"]);
export function useVaultOwner() {
  const client = usePublicClient({ chainId: platformConfig.chain.id });
  const { address } = useAccount();
  const query = useQuery({
    queryKey: ["vault-owner", platformConfig.chain.id, platformConfig.vaultAddress],
    enabled: Boolean(client && platformConfig.vaultAddress),
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
  return {
    ...query,
    isOwner: Boolean(address && query.data && address.toLowerCase() === query.data.toLowerCase()),
  };
}

/** One public stream per app shell. Events invalidate typed REST queries; no trading runs here. */
export function useEngineStream() {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!platformConfig.engineUrl) return;
    let disposed = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let flush: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const pending = new Set<string>();
    const connect = () => {
      if (disposed) return;
      const url = new URL(`${platformConfig.engineUrl}/stream`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onopen = () => {
        failures = 0;
        setConnected(true);
      };
      socket.onmessage = ({ data }) => {
        try {
          const message: unknown = JSON.parse(String(data));
          if (!message || typeof message !== "object" || !("type" in message)) return;
          const keys: Record<string, string[]> = {
            price: ["stats", "status"],
            fill: ["fills", "stats", "status", "pnl"],
            arb: ["stats", "decisions", "pnl", "status"],
            decision: ["decisions"],
            risk: ["status"],
            params: ["params", "status"],
          };
          for (const key of keys[String(message.type)] || []) pending.add(key);
          if (!flush)
            flush = setTimeout(() => {
              for (const key of pending)
                void queryClient.invalidateQueries({ queryKey: ["engine", key] });
              pending.clear();
              flush = undefined;
            }, 500);
        } catch {
          /* Ignore frames that are not public engine events. */
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (disposed) return;
        setConnected(false);
        retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** failures++));
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      if (flush) clearTimeout(flush);
      socket?.close();
    };
  }, [queryClient]);
  return connected;
}
