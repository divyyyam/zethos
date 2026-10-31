"use client";
import { Activity, ArrowLeft, ArrowUpRight, LoaderCircle, Pause, Play } from "lucide-react";
import type { samplePnl } from "../../../content/platform.mock";
import { engineRequest } from "../../../lib/engine/client";
import { formatNumber, formatUsd } from "../../../lib/platform-config";
import { Modal, StatusDot, TokenIcon } from "../primitives";
import { InfoMark } from "./info-mark";
import { OperatorInventory } from "./operator-inventory";
import { OperatorJournal } from "./operator-journal";
import { OperatorOverview } from "./operator-overview";
import { useOperatorDashboard } from "./use-operator-dashboard";

export function OperatorDashboard({
  preview,
  onExit,
  onSessionExpired,
}: {
  preview: boolean;
  onExit: () => void;
  onSessionExpired: () => void;
}) {
  const {
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
  } = useOperatorDashboard({ preview, onExit, onSessionExpired });

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
      <OperatorOverview
        setConfirmControl={setConfirmControl}
        setConfirmReset={setConfirmReset}
        setControlError={setControlError}
        status={status}
        shadow={shadow}
        owner={owner}
        inventory={inventory}
        paused={paused}
        canControl={canControl}
        preview={preview}
      />
      <OperatorInventory status={status} shadow={shadow} inventory={inventory} preview={preview} />
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
      <OperatorJournal decisions={decisions} journal={journal} preview={preview} />
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
