"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zethosVaultAbi } from "@zethos/shared";
import { useEffect, useState } from "react";
import { type Abi, erc20Abi, formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import { getAccount, getWalletClient } from "wagmi/actions";
import { sampleDecisions, samplePnl } from "../../../content/platform.mock";
import { useEngineStatus, useVaultOwner } from "../../../hooks/platform/use-platform";
import { EngineError, engine, engineRequest } from "../../../lib/engine/client";
import { platformConfig, platformTokens } from "../../../lib/platform-config";
import { wagmiConfig } from "../../../lib/wagmi";
import { useToast } from "../primitives";

export function useOperatorDashboard({
  preview,
  onSessionExpired,
}: {
  preview: boolean;
  onExit: () => void;
  onSessionExpired: () => void;
}) {
  const [period, setPeriod] = useState("today");
  const [confirmControl, setConfirmControl] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [controlPhase, setControlPhase] = useState<"idle" | "signing" | "confirming">("idle");
  const [controlError, setControlError] = useState<string | null>(null);
  const status = useEngineStatus();
  const shadow = status.data?.mode === "shadow";
  const client = usePublicClient({ chainId: platformConfig.chain.id });
  const owner = useVaultOwner();
  const queryClient = useQueryClient();
  const notify = useToast();
  const pnl = useQuery({
    queryKey: ["engine", "pnl", period],
    enabled: !preview,
    retry: false,
    refetchInterval: 30000,
    queryFn: ({ signal }) => engine.pnl(period, signal),
  });
  const decisions = useQuery({
    queryKey: ["engine", "decisions"],
    enabled: !preview,
    retry: false,
    refetchInterval: 15000,
    queryFn: ({ signal }) => engine.decisions(signal),
  });
  const inventory = useQuery({
    queryKey: ["vault-inventory", platformConfig.chain.id, platformConfig.vaultAddress],
    enabled: Boolean(!preview && !shadow && platformConfig.vaultAddress && client),
    staleTime: 10000,
    refetchInterval: 20000,
    retry: false,
    queryFn: async () => {
      if (!client || !platformConfig.vaultAddress)
        throw new Error("Vault inventory is not available.");
      const vaultAddress = platformConfig.vaultAddress;
      return Promise.all(
        platformTokens.map(async (token) => {
          if (!token.address) throw new Error("This asset is not configured for the network.");
          const [value, decimals] = await Promise.all([
            client.readContract({
              address: token.address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [vaultAddress],
            }),
            client.readContract({
              address: token.address,
              abi: erc20Abi,
              functionName: "decimals",
            }),
          ]);
          return { symbol: token.symbol, amount: formatUnits(value, decimals) };
        }),
      );
    },
  });
  useEffect(() => {
    if (
      [pnl.error, decisions.error].some(
        (error) => error instanceof EngineError && error.status === 401,
      )
    )
      onSessionExpired();
  }, [pnl.error, decisions.error, onSessionExpired]);
  const scale = period === "7d" ? 5.2 : period === "all" ? 16.5 : 1;
  const profit = preview
    ? {
        total: samplePnl.total * scale,
        spreadCapture: samplePnl.spreadCapture * scale,
        inventory: samplePnl.inventory * scale,
        arbitrage: samplePnl.arbitrage * scale,
        gas: samplePnl.gas * scale,
      }
    : pnl.data;
  const journal = preview ? sampleDecisions : decisions.data;
  const paused = !preview && status.data?.paused;
  const abi: Abi = zethosVaultAbi;
  const controlName = paused ? "unpause" : "pause";
  const canControl =
    (!preview &&
      owner.isOwner &&
      Boolean(
        platformConfig.vaultAddress &&
          status.data &&
          abi.some((entry) => entry.type === "function" && entry.name === controlName),
      )) ||
    (!preview && shadow && owner.isOwner && Boolean(status.data));
  const control = async () => {
    if (!canControl || controlPhase !== "idle") return;
    setControlError(null);
    setControlPhase("signing");
    try {
      if (shadow) {
        await engineRequest(`/operator/${paused ? "resume" : "pause"}`, { method: "POST" });
        await queryClient.invalidateQueries({ queryKey: ["engine", "status"] });
        setConfirmControl(false);
        notify({ title: paused ? "Paper quoting resumed" : "Paper vault paused", tone: "success" });
        return;
      }
      if (!client || !platformConfig.vaultAddress)
        throw new Error("The live vault is not configured.");
      const currentOwner = await owner.refetch();
      const account = getAccount(wagmiConfig);
      if (
        !account.address ||
        account.chainId !== platformConfig.chain.id ||
        currentOwner.data?.toLowerCase() !== account.address.toLowerCase()
      )
        throw new Error("Reconnect the vault owner’s wallet on the correct network.");
      const simulation = await client.simulateContract({
        account: account.address,
        address: platformConfig.vaultAddress,
        abi,
        functionName: controlName,
      });
      const latest = getAccount(wagmiConfig);
      if (latest.address !== account.address || latest.chainId !== account.chainId)
        throw new Error("Your wallet changed. Review the action again.");
      const wallet = await getWalletClient(wagmiConfig, { chainId: platformConfig.chain.id });
      const hash = await wallet.writeContract(simulation.request);
      setControlPhase("confirming");
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 });
      if (receipt.status !== "success")
        throw new Error("The vault action reverted. Check the explorer before retrying.");
      await queryClient.invalidateQueries({ queryKey: ["engine", "status"] });
      setConfirmControl(false);
      notify({
        title: paused ? "Vault resumed" : "Vault paused",
        tone: "success",
        href: `${platformConfig.explorer}/tx/${hash}`,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setControlError(
        /rejected|denied|4001/i.test(message)
          ? "Action cancelled in your wallet."
          : message.length < 200
            ? message
            : "The vault action couldn’t be completed.",
      );
    } finally {
      setControlPhase("idle");
    }
  };
  const feedPairs = preview
    ? [
        {
          pair: "HSK/USDT",
          feed: "healthy",
          mid: 0.082,
          gapPct: 0.23,
          spreadBid: 0.08,
          spreadAsk: 0.08,
        },
        {
          pair: "ETH/USDT",
          feed: "healthy",
          mid: 2500,
          gapPct: 0.18,
          spreadBid: 0.06,
          spreadAsk: 0.06,
        },
      ]
    : (status.data?.pairs ?? []).map((pair) => ({
        pair: pair.pair,
        feed: pair.health,
        mid: pair.mid ?? 0,
        gapPct: null,
        spreadBid: (pair.halfSpread?.sell ?? 0) * 100,
        spreadAsk: (pair.halfSpread?.buy ?? 0) * 100,
      }));
  return {
    period,
    setPeriod,
    confirmControl,
    setConfirmControl,
    confirmReset,
    setConfirmReset,
    controlPhase,
    setControlPhase,
    controlError,
    setControlError,
    status,
    shadow,
    owner,
    queryClient,
    notify,
    pnl,
    decisions,
    inventory,
    profit,
    journal,
    paused,
    canControl,
    control,
    feedPairs,
  };
}
export type OperatorDashboardState = ReturnType<typeof useOperatorDashboard>;
