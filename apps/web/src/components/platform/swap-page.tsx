"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { formatUnits, parseEther, parseUnits } from "viem";
import { useAccount, useBalance } from "wagmi";
import { useEngineStatus, useTokenBalance } from "../../hooks/platform/use-platform";
import {
  settlementReady,
  swapPhaseLabel,
  useSwapExecution,
} from "../../hooks/platform/use-swap-execution";
import { engine } from "../../lib/engine/client";
import type { QuoteRequest, VaultQuote } from "../../lib/engine/types";
import {
  formatNumber,
  formatUsd,
  type PlatformToken,
  platformConfig,
  platformTokens,
  shortAddress,
  tokenBySymbol,
} from "../../lib/platform-config";
import { useWallet } from "../wallet/wallet-provider";
import { Assistant } from "./assistant";
import { BrandMark, EmptyState, ExternalLink, Modal, StatusDot, TokenIcon } from "./primitives";

function TokenPicker({
  open,
  selected,
  onSelect,
  onClose,
}: {
  open: boolean;
  selected: PlatformToken;
  onSelect: (token: PlatformToken) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const id = useId();
  useEffect(() => {
    if (open) setSearch("");
  }, [open]);
  const tokens = platformTokens.filter((token) =>
    `${token.symbol} ${token.name} ${token.address || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <Modal open={open} onClose={onClose} title="Choose a token" className="p-token-modal">
      <div className="p-token-picker">
        <p className="p-eyebrow">A FEW WELL-CHOSEN ASSETS</p>
        <h2>Choose a token.</h2>
        <label className="p-search" htmlFor={id}>
          <Search size={17} aria-hidden />
          <input
            id={id}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or address"
            autoComplete="off"
          />
        </label>
        <div className="p-token-list">
          {tokens.map((token) => (
            <button
              type="button"
              key={token.symbol}
              onClick={() => {
                onSelect(token);
                onClose();
              }}
            >
              <TokenIcon symbol={token.symbol} />
              <span>
                <strong>{token.symbol}</strong>
                <small>{token.name}</small>
              </span>
              {selected.symbol === token.symbol ? (
                <Check size={17} className="p-success-text" aria-label="Selected" />
              ) : (
                <span className="p-token-network">HashKey</span>
              )}
            </button>
          ))}
          {tokens.length === 0 && (
            <p className="p-no-results">
              No matching asset. Zethos currently supports USDT, WHSK, and WETH.
            </p>
          )}
        </div>
        <p className="p-token-picker-note">
          <ShieldCheck size={14} aria-hidden />
          Only assets supported by the vault appear here.
        </p>
      </div>
    </Modal>
  );
}

export function SwapPageContent() {
  const [from, setFrom] = useState(tokenBySymbol("USDT"));
  const [to, setTo] = useState(tokenBySymbol("WHSK"));
  const [amount, setAmount] = useState("1000");
  const [debouncedAmount, setDebouncedAmount] = useState(amount);
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [settings, setSettings] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [review, setReview] = useState(false);
  const [reviewedQuote, setReviewedQuote] = useState<VaultQuote | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [now, setNow] = useState(0);
  const account = useAccount();
  const { openWallet, openNetwork } = useWallet();
  const balance = useTokenBalance(from);
  const outputBalance = useTokenBalance(to);
  const status = useEngineStatus();
  const execution = useSwapExecution();
  const native = useBalance({
    ...(account.address ? { address: account.address } : {}),
    chainId: platformConfig.chain.id,
    query: { enabled: Boolean(account.address), refetchInterval: 20000 },
  });
  const amountId = useId();
  const sample = !platformConfig.engineUrl;
  const wrongNetwork = account.isConnected && account.chainId !== platformConfig.chain.id;
  const amountValue = Number(debouncedAmount || "0");
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedAmount(amount), 400);
    return () => clearTimeout(timeout);
  }, [amount]);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      setAutoRefresh(localStorage.getItem("zethos.auto-refresh") !== "false");
    } catch {
      /* Preferences are optional. */
    }
  }, []);
  const inputValidation = useMemo(() => {
    if (!balance.data || !debouncedAmount || !Number.isFinite(amountValue) || amountValue <= 0)
      return { raw: 0n, error: null };
    if ((debouncedAmount.split(".")[1]?.length || 0) > balance.data.decimals)
      return {
        raw: 0n,
        error: `${from.symbol} supports up to ${balance.data.decimals} decimal places.`,
      };
    try {
      const raw = parseUnits(debouncedAmount, balance.data.decimals);
      return {
        raw,
        error:
          !sample && raw > balance.data.value
            ? `Your ${from.symbol} balance is lower than this amount.`
            : null,
      };
    } catch {
      return { raw: 0n, error: "Enter a valid token amount." };
    }
  }, [balance.data, debouncedAmount, amountValue, from.symbol, sample]);
  const request: QuoteRequest | null =
    account.address &&
    from.address &&
    to.address &&
    inputValidation.raw > 0n &&
    !inputValidation.error &&
    !wrongNetwork &&
    outputBalance.data
      ? {
          taker: account.address,
          tokenIn: from.address,
          tokenOut: to.address,
          amountIn: inputValidation.raw.toString(),
        }
      : null;
  const quote = useQuery({
    queryKey: ["engine", "quote", platformConfig.chain.id, request],
    queryFn: ({ signal }) => {
      if (!request) throw new Error("Choose an amount and connect your wallet.");
      return engine.quote(request, signal);
    },
    enabled: Boolean(request && !sample),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data;
      return autoRefresh && data?.route === "conduit"
        ? Math.max(1000, data.expiresAt * 1000 - Date.now() - 1000)
        : false;
    },
  });
  const sampleOut =
    Number.isFinite(amountValue) && amountValue > 0
      ? ((amountValue * from.samplePrice) / to.samplePrice) * 0.9992
      : 0;
  const live = quote.data?.route === "conduit" ? quote.data : null;
  const out = sample
    ? sampleOut
    : quote.data && outputBalance.data
      ? Number(
          formatUnits(
            BigInt(quote.data.route === "conduit" ? quote.data.conduitOut : quote.data.hskswapOut),
            outputBalance.data.decimals,
          ),
        )
      : null;
  const poolOut = sample
    ? ((amountValue * from.samplePrice) / to.samplePrice) * 0.978
    : live && outputBalance.data
      ? Number(formatUnits(BigInt(live.hskswapOut), outputBalance.data.decimals))
      : null;
  const saving = out !== null && poolOut !== null ? Math.max(0, out - poolOut) : 0;
  const savingPct = live?.savingPct ?? (sample && poolOut && out ? (out / poolOut - 1) * 100 : 0);
  const ttl = live ? Math.max(0, Math.ceil(live.expiresAt - now / 1000)) : 0;
  const validAmount = Boolean(amountValue > 0 && Number.isFinite(amountValue));
  const hasLowGas = account.isConnected && native.data && native.data.value < parseEther("0.05");
  const inputChanged = amount !== debouncedAmount;
  const blocked =
    !validAmount ||
    Boolean(inputValidation.error) ||
    quote.isFetching ||
    inputChanged ||
    Boolean(status.data?.paused);
  const chooseToken = (token: PlatformToken) => {
    execution.reset();
    if (picker === "from") {
      if (token.symbol === to.symbol) setTo(from);
      setFrom(token);
    } else {
      if (token.symbol === from.symbol) setFrom(to);
      setTo(token);
    }
  };
  const flip = () => {
    setFrom(to);
    setTo(from);
    if (out && out > 0) setAmount(String(Number(out.toFixed(8))));
    execution.reset();
  };
  const openReview = () => {
    execution.reset();
    setReviewedQuote(live);
    setReview(true);
  };
  let action = "Review swap";
  if (!account.isConnected) action = "Connect wallet to swap";
  else if (wrongNetwork) action = "Switch to HashKey Chain";
  else if (!validAmount) action = "Enter an amount";
  else if (status.data?.paused) action = "Vault is paused";
  else if (inputValidation.error)
    action = inputValidation.raw > 0n ? `Not enough ${from.symbol}` : "Check the amount";
  else if (sample) action = "View swap preview";
  else if (!from.address || !to.address) action = "This pair isn’t available yet";
  else if (balance.isPending || outputBalance.isPending) action = "Reading your balances…";
  else if (balance.isError || outputBalance.isError) action = "Token balance unavailable";
  else if (quote.isFetching || inputChanged) action = "Finding your price…";
  else if (quote.isError) action = "Try a fresh quote";
  else if (quote.data?.route === "hskswap") action = "Better on HSKSwap";
  else if (live && ttl <= 0) action = "Refresh expired quote";
  const formNotice =
    inputValidation.error ||
    (balance.isError && account.isConnected
      ? "We couldn’t read this token balance. Check the network and try again."
      : null);
  const poolHref = `https://app.hskswap.com/#/swap?${new URLSearchParams({ inputCurrency: from.address || "", outputCurrency: to.address || "" })}`;
  return (
    <>
      <div className="p-swap-layout">
        <div className="p-swap-intro">
          <p className="p-eyebrow">A LITTLE MORE IN YOUR WALLET</p>
          <h1>
            Your next swap,
            <br />
            at a better price.
          </h1>
          <p className="p-swap-description">
            The exchange price you expect.
            <br />
            The on-chain freedom you came for.
          </p>
          <div
            className="p-quote-journey"
            role="img"
            aria-label="Exchange prices are quoted by Zethos and settled in your wallet"
          >
            <div className="p-journey-source">
              <span className="p-journey-symbol">
                <Layers3 size={22} strokeWidth={1.3} />
              </span>
              <span>
                Exchange
                <br />
                <strong>order books</strong>
              </span>
            </div>
            <div className="p-journey-link">
              <span />
              <ArrowRight size={13} />
            </div>
            <div className="p-journey-agent">
              <BrandMark className="size-7" />
              <span>zethos agent</span>
              <small>
                <StatusDot />
                Always looking closer
              </small>
            </div>
            <div className="p-journey-link">
              <span />
              <ArrowRight size={13} />
            </div>
            <div className="p-journey-destination">
              <span className="p-journey-symbol">
                <Wallet size={22} strokeWidth={1.3} />
              </span>
              <span>
                Your wallet
                <br />
                <strong>on HashKey</strong>
              </span>
            </div>
          </div>
          <div className="p-swap-promises">
            <div>
              <span>
                <ShieldCheck size={17} strokeWidth={1.5} />
              </span>
              <p>
                <strong>A price with a promise.</strong>Every live quote is checked against HSKSwap
                before it settles.
              </p>
            </div>
            <div>
              <span>
                <LockKeyhole size={17} strokeWidth={1.5} />
              </span>
              <p>
                <strong>Your keys. Your call.</strong>Quotes are signed. Swaps are atomic. You
                approve every move.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="p-assistant-entry"
            onClick={() => setAssistantOpen(true)}
          >
            <span>
              <Sparkles size={17} />
            </span>
            <div>
              <strong>A little guidance?</strong>
              <small>Ask Zethos about your next swap.</small>
            </div>
            <ArrowUpRight size={17} />
          </button>
        </div>
        <div className="p-swap-workspace">
          <section className="p-swap-card p-card" aria-labelledby="swap-form-title">
            <div className="p-card-header">
              <div className="p-swap-card-title">
                <h2 id="swap-form-title">Let’s make a swap.</h2>
                <span className={`p-pill ${sample ? "p-pill-neutral" : ""}`}>
                  <StatusDot />
                  {sample ? "Preview prices" : "Firm quote"}
                </span>
              </div>
              <button
                type="button"
                className="p-icon-button"
                aria-label="Swap preferences"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={18} />
              </button>
            </div>
            <div className="p-amount-box">
              <div className="p-amount-label">
                <label htmlFor={amountId}>You pay</label>
                <span>
                  Balance: {balance.data ? formatNumber(Number(balance.data.formatted), 5) : "—"}
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
                {sample && validAmount
                  ? `≈ ${formatUsd(Number(amount) * from.samplePrice)}`
                  : from.name}
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
                  HSKSwap
                </span>
                <span>
                  {poolOut
                    ? `${formatNumber(poolOut, to.symbol === "WETH" ? 6 : 4)} ${to.symbol}`
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
            {formNotice && (
              <p className="p-form-error" role="alert">
                {formNotice}
              </p>
            )}
            {quote.isError && !sample && (
              <p className="p-form-error" role="alert">
                {quote.error.message}
              </p>
            )}
            {hasLowGas && (
              <div className="p-gas-note">
                <Info size={14} />
                <span>Your wallet has less than 0.05 HSK available for network fees.</span>
              </div>
            )}
            {quote.data?.route === "hskswap" ? (
              <a
                className="p-button p-button-primary p-swap-action"
                href={poolHref}
                target="_blank"
                rel="noreferrer noopener"
              >
                {action}
                <ArrowUpRight size={15} />
              </a>
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
                  : "Never worse than HSKSwap, checked on-chain."}
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
          <div className="p-under-swap">
            <LockKeyhole size={12} />
            <span>One signed quote. One atomic settlement.</span>
            <span className="p-under-swap-dot">·</span>
            <span>All yours.</span>
          </div>
        </div>
      </div>
      <section className="p-recent-section" aria-labelledby="recent-swaps-title">
        <div className="p-card-header">
          <div>
            <p className="p-eyebrow">A CLEAR TRAIL, ALWAYS</p>
            <h2 id="recent-swaps-title">Your recent swaps.</h2>
          </div>
          <span className="p-pill p-pill-neutral">
            <ReceiptText size={11} />
            On-chain activity
          </span>
        </div>
        <RecentSwaps />
      </section>
      <TokenPicker
        open={Boolean(picker)}
        selected={picker === "from" ? from : to}
        onSelect={chooseToken}
        onClose={() => setPicker(null)}
      />
      <Modal
        open={settings}
        onClose={() => setSettings(false)}
        title="Swap preferences"
        className="p-settings-modal"
      >
        <div className="p-settings-content">
          <p className="p-eyebrow">SETTLE IN</p>
          <h2>Your preferences.</h2>
          <p>Firm quotes make a few things simpler.</p>
          <div className="p-preference">
            <div>
              <strong>Price protection</strong>
              <p>Your settled output must beat the pool price.</p>
            </div>
            <span className="p-pill p-pill-success">
              <ShieldCheck size={12} />
              Always on
            </span>
          </div>
          <div className="p-preference">
            <div>
              <strong>Automatic quote refresh</strong>
              <p>Keep your price current while you decide.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoRefresh}
              aria-label="Automatic quote refresh"
              className={`p-toggle ${autoRefresh ? "on" : ""}`}
              onClick={() => {
                setAutoRefresh(!autoRefresh);
                try {
                  localStorage.setItem("zethos.auto-refresh", String(!autoRefresh));
                } catch {
                  /* Local storage may be unavailable. */
                }
              }}
            >
              <span />
            </button>
          </div>
          <div className="p-preference">
            <div>
              <strong>Token approval</strong>
              <p>Approve only what this swap needs.</p>
            </div>
            <span className="p-pill p-pill-neutral">Exact amount</span>
          </div>
          <div className="p-settings-note">
            <LockKeyhole size={16} />
            <p>Your quoted output is fixed. No slippage slider, no unlimited approvals.</p>
          </div>
        </div>
      </Modal>
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
          <div className={`p-review-icon ${execution.phase === "confirmed" ? "success" : ""}`}>
            {execution.phase === "confirmed" ? (
              <CheckCheck size={27} />
            ) : (
              <ArrowLeftRight size={25} />
            )}
          </div>
          <p className="p-eyebrow">
            {sample
              ? "A LOOK AT WHAT’S NEXT"
              : execution.phase === "confirmed"
                ? "RIGHT WHERE IT BELONGS"
                : "ONE LAST LOOK"}
          </p>
          <h2>
            {execution.phase === "confirmed"
              ? "All settled."
              : sample
                ? "Your swap, previewed."
                : "Looking good."}
          </h2>
          <p className="p-review-sub">
            {sample
              ? "An illustration of the Zethos experience. This is not an executable quote."
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
                {reviewedQuote && outputBalance.data
                  ? formatNumber(
                      Number(
                        formatUnits(BigInt(reviewedQuote.conduitOut), outputBalance.data.decimals),
                      ),
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
                On-chain check
              </strong>
            </div>
            <div>
              <span>Approval limit</span>
              <strong>This swap only</strong>
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
                {execution.phase === "confirmed"
                  ? "View your settled swap"
                  : "Track your transaction"}
              </ExternalLink>
            </div>
          )}
          {sample ? (
            <Link
              href="/stats"
              className="p-button p-button-primary p-full"
              onClick={() => setReview(false)}
            >
              Explore market insights
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
              A fresh start
              <ArrowRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              className="p-button p-button-primary p-full"
              disabled={
                !settlementReady ||
                !reviewedQuote ||
                execution.busy ||
                wrongNetwork ||
                !account.address ||
                account.address.toLowerCase() !== reviewedQuote?.quote.taker.toLowerCase()
              }
              onClick={() => {
                if (reviewedQuote) void execution.execute(reviewedQuote);
              }}
            >
              {execution.busy && <LoaderCircle size={16} className="p-spin" />}
              {!settlementReady
                ? "Live settlement opens with the vault"
                : swapPhaseLabel[execution.phase]}
            </button>
          )}
          <p className="p-wallet-footnote">
            <ShieldCheck size={13} />
            {sample
              ? "No transaction will be submitted."
              : "Your wallet will ask you to approve each transaction."}
          </p>
        </div>
      </Modal>
      <Assistant
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onUseQuote={(input) => {
          setFrom(tokenBySymbol(input.from));
          setTo(tokenBySymbol(input.to));
          setAmount(input.amount);
          setAssistantOpen(false);
        }}
      />
    </>
  );
}

function RecentSwaps() {
  const { address, isConnected } = useAccount();
  const { openWallet } = useWallet();
  const query = useQuery({
    queryKey: ["engine", "fills", address],
    queryFn: ({ signal }) => engine.fills(address || "", signal),
    enabled: Boolean(address && platformConfig.engineUrl),
    retry: false,
  });
  if (!isConnected)
    return (
      <div className="p-card">
        <EmptyState
          icon={<ReceiptText size={21} strokeWidth={1.3} />}
          title="A fresh page for your first swap."
          action={
            <button type="button" className="p-text-button" onClick={openWallet}>
              Connect to see your activity
              <ArrowUpRight size={13} />
            </button>
          }
        >
          Every fill, every saving, all in one place.
        </EmptyState>
      </div>
    );
  if (query.isError)
    return (
      <div className="p-card">
        <EmptyState
          icon={<ReceiptText size={21} />}
          title="Your activity is taking a moment."
          action={
            <button type="button" className="p-text-button" onClick={() => void query.refetch()}>
              Try again
              <RefreshCw size={12} />
            </button>
          }
        >
          We couldn’t load your recent swaps. Your funds are unaffected.
        </EmptyState>
      </div>
    );
  if (!query.data?.length)
    return (
      <div className="p-card">
        <EmptyState
          icon={
            query.isFetching ? (
              <LoaderCircle size={21} className="p-spin" />
            ) : (
              <ReceiptText size={21} strokeWidth={1.3} />
            )
          }
          title={query.isFetching ? "Looking up your swaps." : "Your next chapter starts here."}
        >
          {query.isFetching
            ? "Fetching your confirmed on-chain activity."
            : "Your confirmed Zethos swaps will appear here once live trading begins."}
        </EmptyState>
      </div>
    );
  return (
    <div className="p-card p-table-wrap">
      <table className="p-table">
        <thead>
          <tr>
            <th scope="col">Pair</th>
            <th scope="col">Filled</th>
            <th scope="col">Saving vs pool</th>
            <th scope="col">Settlement</th>
          </tr>
        </thead>
        <tbody>
          {query.data.map((fill) => (
            <tr key={fill.id}>
              <td>{fill.pair}</td>
              <td>
                {new Date(fill.ts > 1e12 ? fill.ts : fill.ts * 1000).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </td>
              <td className="p-success-text">+{formatNumber(fill.savingPct)}%</td>
              <td>
                <ExternalLink href={`${platformConfig.explorer}/tx/${fill.txHash}`}>
                  {shortAddress(fill.txHash)}
                </ExternalLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
