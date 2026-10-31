"use client";
import {
  ArrowDownUp,
  ArrowLeftRight,
  ChevronDown,
  Info,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { failureMessage } from "../../../lib/engine/sdk";
import { formatNumber, formatUsd } from "../../../lib/platform-config";
import { PriceAnatomy } from "../price-anatomy";
import { BrandMark, StatusDot, TokenIcon } from "../primitives";
import type { SwapPageContentState } from "./use-swap-controller";

type Props = Pick<
  SwapPageContentState,
  | "from"
  | "to"
  | "amount"
  | "setAmount"
  | "setPicker"
  | "setSettings"
  | "account"
  | "openWallet"
  | "openNetwork"
  | "isShadow"
  | "balance"
  | "amountId"
  | "sample"
  | "wrongNetwork"
  | "request"
  | "quote"
  | "live"
  | "out"
  | "poolOut"
  | "saving"
  | "savingPct"
  | "ttl"
  | "validAmount"
  | "hasLowGas"
  | "blocked"
  | "flip"
  | "openReview"
  | "action"
  | "formNotice"
>;

export function SwapForm({
  from,
  to,
  amount,
  setAmount,
  setPicker,
  setSettings,
  account,
  openWallet,
  openNetwork,
  isShadow,
  balance,
  amountId,
  sample,
  wrongNetwork,
  request,
  quote,
  live,
  out,
  poolOut,
  saving,
  savingPct,
  ttl,
  validAmount,
  hasLowGas,
  blocked,
  flip,
  openReview,
  action,
  formNotice,
}: Props) {
  return (
    <section className="p-swap-card p-card" aria-labelledby="swap-form-title">
      <div className="p-card-header">
        <div className="p-swap-card-title">
          <h2 id="swap-form-title">Swap</h2>
          <span className={`p-pill ${sample ? "p-pill-neutral" : ""}`}>
            <StatusDot />
            {sample ? "Preview prices" : isShadow ? "Paper quote" : "Firm quote"}
          </span>
        </div>
        <div className="p-card-actions">
          <Link className="p-text-button" href="/agent">
            <Sparkles size={14} />
            Agent mode
          </Link>
          <button
            type="button"
            className="p-icon-button"
            aria-label="Swap preferences"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </div>
      <div className="p-amount-box">
        <div className="p-amount-label">
          <label htmlFor={amountId}>You pay</label>
          <span>
            {isShadow
              ? "Paper · no wallet funds used"
              : `Balance: ${balance.data ? formatNumber(Number(balance.data.formatted), 5) : "—"}`}
            {account.isConnected && balance.data && balance.data.value > 0n && (
              <button type="button" onClick={() => setAmount(balance.data.formatted)}>
                Max
              </button>
            )}
          </span>
        </div>
        <div className="p-amount-entry">
          <input
            id={amountId}
            aria-describedby={`${amountId}-help`}
            value={amount}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0"
            onChange={(event) => {
              if (/^\d*\.?\d*$/.test(event.target.value) && event.target.value.length <= 60)
                setAmount(event.target.value);
            }}
          />
          <button
            type="button"
            className="p-token-select"
            aria-label={`Choose token to pay, ${from.symbol}`}
            onClick={() => setPicker("from")}
          >
            <TokenIcon symbol={from.symbol} />
            <span>{from.symbol}</span>
            <ChevronDown size={15} />
          </button>
        </div>
        <span id={`${amountId}-help`} className="p-amount-usd">
          {sample && validAmount ? `≈ ${formatUsd(Number(amount) * from.samplePrice)}` : from.name}
        </span>
      </div>
      <div className="p-flip-row">
        <button type="button" aria-label="Reverse swap direction" onClick={flip}>
          <ArrowDownUp size={17} />
        </button>
      </div>
      <div className="p-amount-box p-amount-receive">
        <div className="p-amount-label">
          <span>You receive</span>
          <span>
            {sample
              ? "Illustrative quote"
              : quote.isFetching
                ? "Updating price…"
                : live
                  ? "Price guaranteed by quote"
                  : "Awaiting quote"}
          </span>
        </div>
        <div className="p-amount-entry">
          <output
            aria-label="Amount you receive"
            className={quote.isFetching ? "p-quote-stale" : ""}
          >
            {out !== null && out > 0 ? formatNumber(out, to.symbol === "WETH" ? 6 : 4) : "—"}
          </output>
          <button
            type="button"
            className="p-token-select"
            aria-label={`Choose token to receive, ${to.symbol}`}
            onClick={() => setPicker("to")}
          >
            <TokenIcon symbol={to.symbol} />
            <span>{to.symbol}</span>
            <ChevronDown size={15} />
          </button>
        </div>
        <span className="p-amount-usd">
          {sample && out ? `≈ ${formatUsd(out * to.samplePrice)}` : to.name}
        </span>
      </div>
      <div className="p-price-compare">
        <div>
          <span>
            <BrandMark className="size-3.5" />
            Zethos
          </span>
          <strong>
            {out ? `${formatNumber(out, to.symbol === "WETH" ? 6 : 4)} ${to.symbol}` : "—"}
          </strong>
        </div>
        <div>
          <span>
            <ArrowLeftRight size={13} />
            On-chain pools
          </span>
          <span>
            {poolOut
              ? `${formatNumber(poolOut, to.symbol === "WETH" ? 6 : 4)} ${to.symbol}`
              : live?.route === "paper"
                ? "No venue with depth for this size"
                : "—"}
          </span>
        </div>
        {saving > 0 && (
          <div className="p-saving-line">
            <span>
              <Plus size={13} />
              You receive more
            </span>
            <strong>
              {formatNumber(saving, 5)} {to.symbol}
              <small>+{formatNumber(savingPct, 2)}%</small>
            </strong>
          </div>
        )}
      </div>
      {live && (
        <details className="p-quote-anatomy">
          <summary>Why this price</summary>
          <PriceAnatomy
            breakdown={live.breakdown}
            vsMidBps={live.route === "paper" ? live.vsMidBps : 0}
          />
        </details>
      )}
      {live?.breakdown.tier !== "normal" && live && (
        <p className="p-card-footnote">
          {live.breakdown.tier === "probation"
            ? "New takers get shorter quotes until they have a few fills."
            : "Your recent fills moved against the vault; quotes are shorter and wider."}
        </p>
      )}
      {formNotice && (
        <p className="p-form-error" role="alert">
          {formNotice}
        </p>
      )}
      {quote.isError && !sample && (
        <p className="p-form-error" role="alert">
          {quote.error instanceof Error ? quote.error.message : failureMessage(quote.error)}
        </p>
      )}
      {hasLowGas && (
        <div className="p-gas-note">
          <Info size={14} />
          <span>Your wallet has less than 0.05 HSK available for network fees.</span>
        </div>
      )}
      {quote.data?.route === "hskswap" ? (
        <p className="p-card-footnote">
          {action}: {quote.data.venue}. {quote.data.reason}
        </p>
      ) : (
        <button
          type="button"
          className="p-button p-button-primary p-swap-action"
          disabled={
            account.isConnected &&
            !wrongNetwork &&
            (blocked || (!sample && (!request || (!live && !quote.isError))))
          }
          onClick={() => {
            if (!account.isConnected) openWallet();
            else if (wrongNetwork) openNetwork();
            else if (quote.isError || (live && ttl <= 0)) void quote.refetch();
            else openReview();
          }}
        >
          {quote.isFetching ? (
            <LoaderCircle size={16} className="p-spin" />
          ) : !account.isConnected ? (
            <Wallet size={16} />
          ) : (
            <ArrowLeftRight size={16} />
          )}
          {action}
        </button>
      )}
      <div className="p-quote-caption">
        <ShieldCheck size={12} />
        <span>
          {sample
            ? "Sample prices. No funds move in preview mode."
            : isShadow
              ? "Paper settlement. No approval or wallet transaction."
              : "Output protected by the signed quote and vault checks."}
        </span>
        {live && (
          <button
            type="button"
            onClick={() => void quote.refetch()}
            disabled={quote.isFetching}
            aria-label="Refresh quote"
          >
            <RefreshCw size={11} />
            {ttl}s
          </button>
        )}
      </div>
    </section>
  );
}
