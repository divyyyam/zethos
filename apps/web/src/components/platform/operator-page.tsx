"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zethosVaultAbi } from "@zethos/shared";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Command,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { type Abi, erc20Abi, formatUnits } from "viem";
import { createSiweMessage } from "viem/siwe";
import { useAccount, usePublicClient, useSignMessage } from "wagmi";
import { getAccount, getWalletClient } from "wagmi/actions";
import { sampleDecisions, sampleInventory, samplePnl } from "../../content/platform.mock";
import { useEngineStatus, useVaultOwner } from "../../hooks/platform/use-platform";
import { EngineError, engine, engineRequest, object } from "../../lib/engine/client";
import {
  formatNumber,
  formatUsd,
  platformConfig,
  platformTokens,
  shortAddress,
} from "../../lib/platform-config";
import { wagmiConfig } from "../../lib/wagmi";
import { ConnectWalletButton, useWallet } from "../wallet/wallet-provider";
import { BrandMark, Modal, StatusDot, TokenIcon, useToast } from "./primitives";

export function OperatorPageContent() {
  const account = useAccount();
  const status = useEngineStatus();
  const owner = useVaultOwner();
  const [preview, setPreview] = useState(false);
  const [actor, setActor] = useState<{ address: string; chain: number; expires: number } | null>(
    null,
  );
  const [phase, setPhase] = useState<"idle" | "nonce" | "signature" | "verification">("idle");
  const [error, setError] = useState<string | null>(null);
  const { signMessageAsync } = useSignMessage();
  const { openNetwork, openWallet } = useWallet();
  const authorized = Boolean(
    actor &&
      actor.address.toLowerCase() === account.address?.toLowerCase() &&
      actor.chain === account.chainId &&
      actor.expires > Date.now() &&
      owner.isOwner,
  );
  useEffect(() => {
    if (
      actor &&
      (actor.address.toLowerCase() !== account.address?.toLowerCase() ||
        actor.chain !== account.chainId)
    ) {
      setActor(null);
      setError(null);
    }
  }, [account.address, account.chainId, actor]);
  useEffect(() => {
    const timer = setInterval(() => {
      setActor((current) => (current && current.expires <= Date.now() ? null : current));
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  const signIn = async () => {
    const address = account.address;
    if (!address || !platformConfig.engineUrl || !owner.isOwner || phase !== "idle") return;
    const assertWallet = () => {
      const current = getAccount(wagmiConfig);
      if (
        current.address?.toLowerCase() !== address.toLowerCase() ||
        current.chainId !== platformConfig.chain.id
      )
        throw new Error("Your wallet or network changed. Please start sign-in again.");
    };
    setError(null);
    setPhase("nonce");
    try {
      assertWallet();
      const ownership = await owner.refetch();
      if (ownership.data?.toLowerCase() !== address.toLowerCase())
        throw new Error("This wallet is not the current vault owner.");
      const result = object(await engineRequest("/auth/nonce"));
      if (typeof result.nonce !== "string" || !/^[a-zA-Z0-9]{8,}$/.test(result.nonce))
        throw new Error("The sign-in service returned an invalid challenge.");
      assertWallet();
      const issuedAt = new Date();
      const message = createSiweMessage({
        address,
        chainId: platformConfig.chain.id,
        domain: window.location.host,
        uri: window.location.origin,
        version: "1",
        nonce: result.nonce,
        statement:
          "Sign in to the Zethos operator workspace. This does not authorize a transaction.",
        issuedAt,
        expirationTime: new Date(issuedAt.getTime() + 15 * 60000),
      });
      setPhase("signature");
      const signature = await signMessageAsync({ message });
      assertWallet();
      setPhase("verification");
      const session = object(
        await engineRequest("/auth/verify", {
          method: "POST",
          body: JSON.stringify({ message, signature }),
        }),
      );
      assertWallet();
      if (typeof session.expiresAt !== "number")
        throw new Error("The sign-in service returned an invalid session.");
      setActor({ address, chain: platformConfig.chain.id, expires: session.expiresAt });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Sign-in couldn’t be completed.";
      setError(
        /rejected|denied|4001/i.test(message)
          ? "Sign-in cancelled in your wallet. You can try again when you’re ready."
          : message.length < 250
            ? message
            : "Sign-in couldn’t be completed. Please try again.",
      );
    } finally {
      setPhase("idle");
    }
  };
  if (preview || authorized)
    return (
      <OperatorDashboard
        preview={preview}
        onExit={() => {
          setPreview(false);
          setActor(null);
          if (platformConfig.engineUrl)
            void engineRequest("/auth/logout", { method: "POST" }).catch(() => {});
        }}
        onSessionExpired={() => {
          setActor(null);
          setError("Your operator session has expired. Sign in again to continue.");
        }}
      />
    );
  const wrongNetwork = account.isConnected && account.chainId !== platformConfig.chain.id;
  const notOwner = account.isConnected && owner.data && !owner.isOwner;
  return (
    <div className="p-operator-gate">
      <section className="p-card p-access-card" aria-labelledby="operator-access-title">
        <h2 id="operator-access-title">Operator access</h2>
        <p>
          {notOwner
            ? "This wallet isn’t the current vault owner. Connect the owner wallet to continue."
            : !platformConfig.vaultAddress && status.data?.mode !== "shadow"
              ? "Operator access opens with the vault deployment. You can explore a read-only preview in the meantime."
              : status.data?.mode === "shadow" && !status.data.operator
                ? "Paper operator access is not configured. Set OPERATOR_ADDRESS and SESSION_SECRET in the engine."
                : !account.isConnected
                  ? "Connect the vault owner’s wallet to open your workspace."
                  : owner.isPending
                    ? "Checking the vault’s current owner…"
                    : owner.isError
                      ? "We couldn’t verify ownership right now. Check the vault’s network and try again."
                      : !platformConfig.engineUrl
                        ? "Your owner wallet is verified. Operator sign-in opens when the live service is connected."
                        : "Your wallet is verified as the owner. Sign a message to start your operator session."}
        </p>
        {account.address && (
          <div className="p-access-wallet">
            <Fingerprint size={15} />
            <span>{shortAddress(account.address)}</span>
            <small>{owner.isOwner ? "Owner verified" : "Connected wallet"}</small>
          </div>
        )}
        {!account.isConnected ? (
          <ConnectWalletButton label="Connect owner wallet" className="p-full" />
        ) : wrongNetwork ? (
          <button type="button" className="p-button p-button-primary p-full" onClick={openNetwork}>
            Switch to {platformConfig.chain.name}
            <ArrowUpRight size={15} />
          </button>
        ) : owner.isOwner && platformConfig.engineUrl ? (
          <button
            type="button"
            className="p-button p-button-primary p-full"
            onClick={() => void signIn()}
            disabled={phase !== "idle"}
          >
            {phase !== "idle" ? (
              <LoaderCircle size={15} className="p-spin" />
            ) : (
              <Fingerprint size={16} />
            )}
            {phase === "nonce"
              ? "Preparing your sign-in…"
              : phase === "signature"
                ? "Check your wallet…"
                : phase === "verification"
                  ? "Verifying your session…"
                  : "Sign in as operator"}
          </button>
        ) : (
          <button type="button" className="p-button p-button-secondary p-full" onClick={openWallet}>
            Manage connected wallet
            <ArrowUpRight size={15} />
          </button>
        )}
        {owner.isError && (
          <button
            type="button"
            className="p-text-button p-owner-retry"
            onClick={() => void owner.refetch()}
          >
            Check owner again
            <RefreshCw size={12} />
          </button>
        )}
        {error && (
          <p className="p-form-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="p-access-preview" onClick={() => setPreview(true)}>
          View read-only preview
          <ArrowRight size={14} />
        </button>
        <div className="p-access-footnote">
          <LockKeyhole size={12} />
          Preview is read-only. Your wallet stays in control.
        </div>
      </section>
    </div>
  );
}

function OperatorDashboard({
  preview,
  onExit,
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
  return (
    <>
      <div className="p-page-heading">
        <div>
          <h1>Operator</h1>
        </div>
        <div className="p-page-tools">
          <span className={`p-pill ${preview ? "p-pill-neutral" : "p-pill-success"}`}>
            <StatusDot tone={preview ? "neutral" : "success"} />
            {preview ? "Read-only preview" : "Owner workspace"}
          </span>
          <button
            type="button"
            className="p-icon-button"
            onClick={onExit}
            aria-label={preview ? "Exit workspace preview" : "Lock operator workspace"}
          >
            <ArrowLeft size={17} />
          </button>
        </div>
      </div>
      {preview && (
        <div className="p-preview-banner">
          <span>
            <InfoMark />
            <strong>A look inside your future workspace.</strong> All figures here are samples.
            Vault controls stay off.
          </span>
          <button type="button" onClick={onExit}>
            Exit preview
            <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      {!preview && (status.isError || pnl.isError || decisions.isError || inventory.isError) && (
        <div className="p-form-error" role="alert">
          Some live data is unavailable. Missing values stay blank until the service responds.
        </div>
      )}
      <div className="p-operator-overview">
        <div>
          <span className="p-overview-icon">
            <Command size={21} strokeWidth={1.5} />
          </span>
          <div>
            <span>Vault status</span>
            <strong>
              {preview
                ? "Normal operation"
                : status.data
                  ? paused
                    ? "Vault paused"
                    : status.data.riskState
                  : "Awaiting status"}
            </strong>
          </div>
        </div>
        <div>
          <span>Vault value</span>
          <strong>
            {preview
              ? "$48,000.00"
              : status.data?.equityUsd != null
                ? formatUsd(status.data.equityUsd)
                : "—"}
          </strong>
        </div>
        <div>
          <span>Assets under management</span>
          <strong>
            {preview
              ? "3 assets"
              : shadow
                ? "3 paper assets"
                : inventory.data
                  ? `${inventory.data.length} assets`
                  : "—"}
          </strong>
        </div>
        <button
          type="button"
          className="p-button p-button-secondary"
          disabled={!canControl}
          onClick={() => {
            setControlError(null);
            setConfirmControl(true);
          }}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? "Resume vault" : "Pause vault"}
        </button>
        {!preview && shadow && (
          <button
            type="button"
            className="p-button p-button-secondary"
            disabled={!owner.isOwner}
            onClick={() => {
              setControlError(null);
              setConfirmReset(true);
            }}
          >
            Reset paper Arena
          </button>
        )}
      </div>
      <section aria-labelledby="inventory-title">
        <div className="p-section-heading">
          <h2 id="inventory-title">Inventory</h2>
          <span>Vault inventory</span>
        </div>
        <div className="p-inventory-grid">
          {platformTokens.map((token) => {
            const sampleAsset = sampleInventory.find((asset) => asset.symbol === token.symbol);
            const metadata = status.data?.pairs
              .flatMap((p) => [p.base, p.quote])
              .find((t) => t.symbol === token.symbol);
            const paperAmount = status.data?.inventory[token.symbol];
            const liveAsset =
              shadow && metadata && paperAmount !== undefined
                ? {
                    symbol: token.symbol,
                    amount: formatUnits(BigInt(paperAmount), metadata.decimals),
                  }
                : inventory.data?.find((asset) => asset.symbol === token.symbol);
            return (
              <div className="p-card p-inventory-card" key={token.symbol}>
                <div className="p-card-header">
                  <div className="p-inventory-token">
                    <TokenIcon symbol={token.symbol} />
                    <div>
                      <strong>{token.symbol}</strong>
                      <small>{token.name}</small>
                    </div>
                  </div>
                  <span className="p-pill p-pill-neutral">
                    {preview && sampleAsset ? `${sampleAsset.share}%` : "On-chain"}
                  </span>
                </div>
                <strong className="p-inventory-value">
                  {preview && sampleAsset
                    ? formatUsd(sampleAsset.value)
                    : liveAsset
                      ? `${formatNumber(Number(liveAsset.amount), 5)} ${token.symbol}`
                      : "—"}
                </strong>
                <div className="p-inventory-band">
                  <span />
                  <span />
                  <span />
                  {preview && sampleAsset && (
                    <i style={{ left: `${Math.max(20, Math.min(80, sampleAsset.share))}%` }} />
                  )}
                </div>
                <div className="p-inventory-band-label">
                  <span>Minimum band</span>
                  <span>{preview ? "Within range" : "On-chain balance"}</span>
                  <span>Maximum band</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <div className="p-operator-mid">
        <section className="p-card p-pnl-card" aria-labelledby="pnl-title">
          <div className="p-card-header">
            <div>
              <h2 id="pnl-title">P&amp;L</h2>
            </div>
            <fieldset className="p-segmented" aria-label="P&L period">
              {[
                { value: "today", label: "Today" },
                { value: "7d", label: "7 days" },
                { value: "all", label: "All" },
              ].map((option) => (
                <button
                  type="button"
                  key={option.value}
                  aria-pressed={period === option.value}
                  onClick={() => setPeriod(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </fieldset>
          </div>
          <div className="p-pnl-total">
            <span>Net performance</span>
            <strong className={profit && profit.total < 0 ? "p-error-text" : "p-success-text"}>
              {profit
                ? `${profit.total >= 0 ? "+" : "−"}${formatUsd(Math.abs(profit.total))}`
                : "—"}
            </strong>
          </div>
          <div className="p-pnl-breakdown">
            {[
              { key: "spreadCapture", label: "Spread capture" },
              { key: "arbitrage", label: "Arbitrage" },
              { key: "inventory", label: "Inventory mark-to-market" },
              { key: "gas", label: "Network fees" },
            ].map(({ key, label }) => {
              const value = profit?.[key as keyof typeof samplePnl];
              return (
                <div key={key}>
                  <span>{label}</span>
                  <div className="p-pnl-bar">
                    <span
                      className={value !== undefined && value < 0 ? "negative" : ""}
                      style={{
                        width:
                          value !== undefined
                            ? `${Math.min(100, (Math.abs(value) / Math.max(1, Math.abs(profit?.spreadCapture || 1))) * 100)}%`
                            : "0%",
                      }}
                    />
                  </div>
                  <strong
                    className={value !== undefined && value < 0 ? "p-error-text" : "p-success-text"}
                  >
                    {value === undefined
                      ? "—"
                      : `${value < 0 ? "−" : "+"}${formatUsd(Math.abs(value))}`}
                  </strong>
                </div>
              );
            })}
          </div>
        </section>
        <section className="p-card p-reference-card" aria-labelledby="feeds-title">
          <div className="p-card-header">
            <div>
              <h2 id="feeds-title">Reference feeds</h2>
            </div>
            <span className="p-feed-icon">
              <Activity size={20} />
            </span>
          </div>
          {feedPairs.length ? (
            feedPairs.map((pair) => (
              <div className="p-reference-pair" key={pair.pair}>
                <div>
                  <TokenIcon symbol={pair.pair.includes("ETH") ? "WETH" : "WHSK"} />
                  <strong>{pair.pair.replace("/", " / ")}</strong>
                  <span>
                    <StatusDot tone={/healthy|ok|live/i.test(pair.feed) ? "success" : "warning"} />
                    {pair.feed}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Reference mid</dt>
                    <dd>{formatNumber(pair.mid, pair.pair.includes("ETH") ? 2 : 5)} USDT</dd>
                  </div>
                  <div>
                    <dt>Pool gap</dt>
                    <dd>{pair.gapPct === null ? "No venue" : `${formatNumber(pair.gapPct)}%`}</dd>
                  </div>
                  <div>
                    <dt>Bid / ask spread</dt>
                    <dd>
                      {formatNumber(pair.spreadBid)}% / {formatNumber(pair.spreadAsk)}%
                    </dd>
                  </div>
                </dl>
              </div>
            ))
          ) : (
            <div className="p-reference-empty">
              Reference feeds will appear when the engine is available.
            </div>
          )}
          <p className="p-card-footnote">
            {preview
              ? "Sample reference data for the workspace preview."
              : "Feed health and spreads reported by the pricing engine."}
          </p>
        </section>
      </div>
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
      <Modal
        open={confirmControl}
        onClose={() => {
          if (controlPhase === "idle") setConfirmControl(false);
        }}
        title={paused ? "Resume vault" : "Pause vault"}
        className="p-control-modal"
      >
        <div className="p-control-content">
          <span className="p-control-icon">
            {paused ? <Play size={24} /> : <Pause size={24} />}
          </span>
          <h2>{paused ? "Resume quoting?" : "Pause quoting?"}</h2>
          <p>
            {shadow
              ? "This changes the paper engine only. No wallet transaction or funds transfer occurs."
              : paused
                ? "Your wallet will confirm an on-chain transaction to resume the vault."
                : "Pausing stops new settlements through the vault. Your wallet will confirm the on-chain transaction."}
          </p>
          {controlError && (
            <p className="p-form-error" role="alert">
              {controlError}
            </p>
          )}
          <button
            type="button"
            className="p-button p-button-primary p-full"
            disabled={!canControl || controlPhase !== "idle"}
            onClick={() => void control()}
          >
            {controlPhase !== "idle" && <LoaderCircle size={15} className="p-spin" />}
            {controlPhase === "signing"
              ? "Confirm in your wallet…"
              : controlPhase === "confirming"
                ? "Waiting for confirmation…"
                : paused
                  ? "Resume vault"
                  : "Pause vault"}
          </button>
        </div>
      </Modal>
      <Modal
        open={confirmReset}
        title="Reset paper Arena"
        onClose={() => {
          if (controlPhase === "idle") setConfirmReset(false);
        }}
        className="p-control-modal"
      >
        <div className="p-control-content">
          <h2>Start a fresh paper epoch?</h2>
          <p>
            This resets paper inventory and P&amp;L. Previous fills stay in history, tagged with
            their epoch. Outstanding paper quotes will no longer fill.
          </p>
          {controlError && (
            <p className="p-form-error" role="alert">
              {controlError}
            </p>
          )}
          <button
            type="button"
            className="p-button p-button-primary p-full"
            disabled={controlPhase !== "idle"}
            onClick={async () => {
              setControlPhase("confirming");
              try {
                await engineRequest("/operator/arena-reset", { method: "POST" });
                await queryClient.invalidateQueries({ queryKey: ["engine"] });
                setConfirmReset(false);
                notify({ title: "Paper Arena reset", tone: "success" });
              } catch (cause) {
                setControlError(
                  cause instanceof Error ? cause.message : "Could not reset paper Arena",
                );
              } finally {
                setControlPhase("idle");
              }
            }}
          >
            Reset paper inventory
          </button>
        </div>
      </Modal>
    </>
  );
}
function InfoMark() {
  return <ShieldCheck size={15} aria-hidden />;
}
