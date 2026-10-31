"use client";
import { ArrowDown, ArrowRight, ArrowUpRight, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { formatUnits } from "viem";
import { settlementReady, swapPhaseLabel } from "../../../hooks/platform/use-swap-execution";
import { formatNumber, platformConfig, shortAddress } from "../../../lib/platform-config";
import { ExternalLink, Modal, TokenIcon } from "../primitives";
import type { SwapPageContentState } from "./use-swap-controller";

type Props = Pick<
  SwapPageContentState,
  | "from"
  | "to"
  | "setAmount"
  | "review"
  | "setReview"
  | "reviewedQuote"
  | "reviewedRequest"
  | "now"
  | "account"
  | "isShadow"
  | "outputDecimals"
  | "execution"
  | "sample"
  | "wrongNetwork"
  | "amountValue"
  | "out"
>;

export function SwapReview({
  from,
  to,
  setAmount,
  review,
  setReview,
  reviewedQuote,
  reviewedRequest,
  now,
  account,
  isShadow,
  outputDecimals,
  execution,
  sample,
  wrongNetwork,
  amountValue,
  out,
}: Props) {
  return (
    <Modal
      open={review}
      onClose={() => {
        if (!execution.busy) setReview(false);
      }}
      title={
        execution.phase === "confirmed"
          ? "Swap complete"
          : sample
            ? "Your swap preview"
            : "Review your swap"
      }
      className="p-review-modal"
    >
      <div className="p-review-content">
        <h2>
          {execution.phase === "confirmed"
            ? "Swap complete"
            : sample
              ? "Swap preview"
              : "Review swap"}
        </h2>
        <p className="p-review-sub">
          {sample
            ? "Sample prices. This is not an executable quote."
            : isShadow
              ? "Paper fill. No funds move and no wallet transaction is requested."
              : "Check the amounts before continuing in your wallet."}
        </p>
        <div className="p-review-amount">
          <TokenIcon symbol={from.symbol} />
          <div>
            <span>You pay</span>
            <strong>
              {formatNumber(amountValue, 6)} {from.symbol}
            </strong>
          </div>
        </div>
        <div className="p-review-arrow">
          <ArrowDown size={15} />
        </div>
        <div className="p-review-amount">
          <TokenIcon symbol={to.symbol} />
          <div>
            <span>You receive</span>
            <strong>
              {reviewedQuote && outputDecimals !== undefined
                ? formatNumber(
                    Number(formatUnits(BigInt(reviewedQuote.quote.amountOut), outputDecimals)),
                    6,
                  )
                : formatNumber(out || 0, 6)}{" "}
              {to.symbol}
            </strong>
          </div>
        </div>
        <div className="p-review-meta">
          <div>
            <span>Network</span>
            <strong>{platformConfig.chain.name}</strong>
          </div>
          <div>
            <span>Price protection</span>
            <strong>
              <ShieldCheck size={12} />
              {isShadow ? "Paper vault checks" : "On-chain check"}
            </strong>
          </div>
          <div>
            <span>Approval limit</span>
            <strong>{isShadow ? "No approval needed" : "This swap only"}</strong>
          </div>
          {account.address && (
            <div>
              <span>Your wallet</span>
              <strong>{shortAddress(account.address)}</strong>
            </div>
          )}
        </div>
        {execution.error && (
          <p className="p-form-error" role="alert">
            {execution.error}
          </p>
        )}
        {execution.hash && (
          <div className="p-review-tx">
            <ExternalLink href={`${platformConfig.explorer}/tx/${execution.hash}`}>
              {execution.phase === "confirmed" ? "View transaction" : "View transaction"}
            </ExternalLink>
          </div>
        )}
        {sample ? (
          <Link
            href="/stats"
            className="p-button p-button-primary p-full"
            onClick={() => setReview(false)}
          >
            View insights
            <ArrowUpRight size={15} />
          </Link>
        ) : execution.phase === "confirmed" ? (
          <button
            type="button"
            className="p-button p-button-primary p-full"
            onClick={() => {
              setReview(false);
              setAmount("");
              execution.reset();
            }}
          >
            New swap
            <ArrowRight size={15} />
          </button>
        ) : (
          <button
            type="button"
            className="p-button p-button-primary p-full"
            disabled={
              (!isShadow && !settlementReady) ||
              !reviewedQuote ||
              execution.busy ||
              !reviewedRequest ||
              (reviewedQuote ? Number(reviewedQuote.quote.expiry) * 1000 <= now : true) ||
              wrongNetwork ||
              !account.address ||
              account.address.toLowerCase() !== reviewedQuote?.quote.taker.toLowerCase()
            }
            onClick={() => {
              if (reviewedQuote && reviewedRequest)
                void execution.execute(reviewedQuote, reviewedRequest);
            }}
          >
            {execution.busy && <LoaderCircle size={16} className="p-spin" />}
            {isShadow
              ? execution.busy
                ? "Filling paper quote…"
                : reviewedQuote && Number(reviewedQuote.quote.expiry) * 1000 <= now
                  ? "Quote expired · close and refresh"
                  : "Paper fill"
              : !settlementReady
                ? "Live settlement opens with the vault"
                : swapPhaseLabel[execution.phase]}
          </button>
        )}
        <p className="p-wallet-footnote">
          <ShieldCheck size={13} />
          {sample
            ? "No transaction will be submitted."
            : isShadow
              ? "Paper settlement only. No funds move."
              : "Your wallet will ask you to approve each transaction."}
        </p>
      </div>
    </Modal>
  );
}
