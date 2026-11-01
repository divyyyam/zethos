"use client";

import { useQueryClient } from "@tanstack/react-query";
import type {
  Fill,
  Pair,
  PairStatus,
  QuoteRequest,
  SignedQuoteResponse,
  Status,
  Verification,
} from "@zethos/sdk";
import { resolveQuoteIntent } from "@zethos/sdk";
import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { getAccount } from "wagmi/actions";
import { useEngineStatus, useTokenBalance } from "../../../hooks/platform/use-platform";
import type { Mandate } from "../../../lib/engine/desk-types";
import { failureMessage, zethos } from "../../../lib/engine/sdk";
import { settleOnChain } from "../../../lib/engine/settle-on-chain";
import {
  formatNumber,
  platformConfig,
  type TokenSymbol,
  tokenBySymbol,
} from "../../../lib/platform-config";
import { wagmiConfig } from "../../../lib/wagmi";
import { useWallet } from "../../wallet/wallet-provider";
import { ExternalLink } from "../primitives";
import { Select } from "../select";
import { venueLabel } from "../venue-label";

type Result = {
  quote: SignedQuoteResponse;
  request: QuoteRequest;
  pair: PairStatus;
  side: "buy" | "sell";
  status: Status;
  verification: Verification;
};
type Preset = "normal" | "over" | "under";
const terms = [
  ["base", "Base spread", "The desk’s standing margin"],
  ["vol", "Price movement", "Allows for changing market prices"],
  ["inventory", "Inventory balance", "Balances the vault’s holdings"],
  ["toxicity", "Taker risk", "Adjusts for the taker’s trading behaviour"],
  ["degraded", "Reduced price sources", "Allows for fewer healthy venues"],
] as const;
const sides = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
] as const;
const label = (token: PairStatus["base"]) => token.label ?? token.symbol;
const pct = (fraction: number) => `${formatNumber(fraction * 100, 4)}%`;

function ticketOf({ quote, pair, side }: Result) {
  const input = side === "buy" ? pair.quote : pair.base;
  const output = side === "buy" ? pair.base : pair.quote;
  const amountIn = formatUnits(BigInt(quote.quote.amountIn), input.decimals);
  const amountOut = formatUnits(BigInt(quote.quote.amountOut), output.decimals);
  const price =
    side === "buy" ? Number(amountIn) / Number(amountOut) : Number(amountOut) / Number(amountIn);
  return { input, output, amountIn, amountOut, price };
}

function Balance({ token }: { token: PairStatus["base"] }) {
  const balance = useTokenBalance({
    ...tokenBySymbol(token.symbol as TokenSymbol),
    address: token.address,
    label: label(token),
  });
  return (
    <p>
      {label(token)} balance:{" "}
      {balance.data?.formatted ?? (balance.isPending ? "Loading…" : "Unavailable")}
    </p>
  );
}

export function DeskTester({ mandate }: { mandate: Mandate | undefined }) {
  const status = useEngineStatus();
  const wallet = useAccount();
  const { openWallet, openNetwork } = useWallet();
  const queries = useQueryClient();
  const [pairName, setPairName] = useState<Pair>("HSK/USDT");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("25");
  const [result, setResult] = useState<Result | null>(null);
  const [fill, setFill] = useState<Fill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const ticketRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const pair = status.data?.pairs.find((p) => p.pair === pairName);
  const sold = pair && (side === "buy" ? pair.quote : pair.base);
  const remaining = result
    ? Math.max(0, Math.ceil(Number(result.quote.quote.expiry) - now / 1000))
    : 0;
  useEffect(() => {
    if (!result) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [result]);
  const quoteId = result?.quote.id;
  useEffect(() => {
    if (!quoteId) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ticketRef.current?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
  }, [quoteId]);
  const reset = () => {
    setResult(null);
    setFill(null);
    setError(null);
  };

  async function requestQuote(preset?: Preset) {
    if (!wallet.address) {
      openWallet();
      return;
    }
    if (!zethos || running.current) return;
    running.current = true;
    setBusy(true);
    reset();
    try {
      const current = await zethos.status();
      const selected = current.pairs.find((p) => p.pair === pairName);
      if (!selected) throw new Error("This pair is unavailable.");
      const inputToken = side === "buy" ? selected.quote : selected.base;
      let size = amount;
      if (preset === "over") {
        const cap = selected.vaultRoutes?.[side].maxAmountIn;
        if (cap === undefined) throw new Error("This mode has no on-chain route cap to test.");
        size = formatUnits(BigInt(cap) + 10n ** BigInt(inputToken.decimals), inputToken.decimals);
      } else if (preset === "under") {
        size = formatUnits(1n, inputToken.decimals);
      } else if (preset === "normal") {
        size =
          side === "sell" && selected.mid
            ? (25 / selected.mid).toFixed(Math.min(inputToken.decimals, 6))
            : "25";
      }
      setAmount(size);
      const request = resolveQuoteIntent(
        { taker: wallet.address, pair: pairName, side, amount: size },
        current,
      );
      const quote = await zethos.quote(request);
      if (quote.route === "hskswap") throw new Error(quote.reason);
      const verification = await zethos.verifyQuote(quote, request);
      setNow(Date.now());
      setResult({ quote, request, pair: selected, side, status: current, verification });
      if (verification.ok)
        queries.setQueryData(["desk", "verifiedQuote", wallet.address], {
          quoteId: quote.id,
          route: quote.route,
        });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name !== "ZethosError"
          ? cause.message
          : failureMessage(cause),
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function settle() {
    if (!zethos || !result || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const { quote, request } = result;
      const account = getAccount(wagmiConfig);
      if (account.address?.toLowerCase() !== request.taker.toLowerCase())
        throw new Error("Your wallet changed. Get a new quote.");
      if (account.chainId !== platformConfig.chain.id)
        throw new Error(`Wrong network. Switch to ${platformConfig.chain.name}.`);
      if (Number(quote.quote.expiry) - Date.now() / 1000 < 5)
        throw new Error("This quote has expired or is nearly expired. Get a new signed quote.");
      const current = await zethos.status();
      if (current.paused) throw new Error("The vault is paused.");
      if (
        quote.route === "conduit" &&
        (current.mode !== "live" ||
          current.verifyingContract.toLowerCase() !== platformConfig.vaultAddress?.toLowerCase())
      )
        throw new Error("The configured vault does not match the live engine.");
      const verification = await zethos.verifyQuote(quote, request);
      if (!verification.ok)
        throw new Error(
          `Local verification failed: ${verification.reasons.join(", ")}. Get a new quote.`,
        );
      const settled =
        quote.route === "paper"
          ? await zethos.paperFill(quote, request)
          : await settleOnChain(quote, {
              pair: result.pair.pair,
              side: result.side,
              price: ticketOf(result).price,
              flow: "user",
            });
      setFill(settled);
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["token-balance"] }),
        ...["fills", "status", "arena", "arenaTakers"].map((key) =>
          queries.invalidateQueries({ queryKey: ["engine", key] }),
        ),
      ]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : failureMessage(cause);
      setError(
        /rejected|denied|4001/i.test(message)
          ? "Transaction cancelled in your wallet. No further transaction will be requested."
          : message.length < 300
            ? message
            : "Settlement could not complete. Check your wallet and get a new quote.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const checks: Array<{ name: string; pass: boolean | null; detail: string }> = [];
  if (result) {
    const q = result.quote;
    const input = result.side === "buy" ? result.pair.quote : result.pair.base;
    const notional =
      Number(formatUnits(BigInt(q.quote.amountIn), input.decimals)) *
      (result.side === "buy" ? 1 : q.breakdown.mid);
    const bucket = mandate?.service.maxHalfSpreadBps
      .slice()
      .sort((a, b) => a.maxNotionalUsd - b.maxNotionalUsd)
      .find((b) => notional <= b.maxNotionalUsd);
    const cap = result.pair.vaultRoutes?.[result.side];
    checks.push(
      {
        name: "Pair in mandate",
        pass: mandate ? mandate.pairs.includes(result.pair.pair) : null,
        detail: result.pair.pair,
      },
      {
        name: "Spread against size bucket",
        pass: bucket ? q.vsMidBps <= bucket.maxBps : null,
        detail: bucket
          ? `${pct(q.vsMidBps / 10000)} cost; limit ${pct(bucket.maxBps / 10000)} for up to $${formatNumber(bucket.maxNotionalUsd)}`
          : "No matching mandate bucket available",
      },
      {
        name: "Size against route cap",
        pass: cap ? cap.enabled && BigInt(q.quote.amountIn) <= BigInt(cap.maxAmountIn) : null,
        detail: cap
          ? `${formatUnits(BigInt(q.quote.amountIn), input.decimals)} / ${formatUnits(BigInt(cap.maxAmountIn), input.decimals)} ${label(input)}`
          : "No on-chain route cap for this paper quote",
      },
      {
        name: "Vault not paused",
        pass: !result.status.paused,
        detail: result.status.paused ? "Paused at quote request" : "Open at quote request",
      },
      {
        name: "Local signature and quote checks",
        pass: result.verification.ok,
        detail: result.verification.ok
          ? `Verified against ${result.verification.trust === "chain" ? "the on-chain vault signer" : "the paper signer"}`
          : result.verification.reasons.join(", "),
      },
    );
  }

  const ticket = result && ticketOf(result);
  const passedChecks = checks.filter((check) => check.pass === true).length;
  const failedChecks = checks.filter((check) => check.pass === false).length;
  const checkSummary = failedChecks
    ? `${failedChecks} of ${checks.length} failed`
    : `${passedChecks} of ${checks.length} passed`;
  const errorAlert = (
    <p role="alert" className="p-form-error">
      {error}
    </p>
  );

  return (
    <section className="d-card mb-6" id="test-the-desk" aria-label="Test the desk">
      <div className="d-card-head">
        <h2>Test the desk</h2>
        <p>Request a signed price, inspect the checks, then choose whether to settle.</p>
      </div>
      {!zethos ? (
        <p>Connect an engine to test real quotes.</p>
      ) : (
        <>
          <form
            className="d-desk-form"
            onSubmit={(event) => {
              event.preventDefault();
              void requestQuote();
            }}
          >
            <div className="p-select-field">
              <span>Pair</span>
              <Select
                ariaLabel="Desk pair"
                value={pairName}
                disabled={busy}
                options={(status.data?.pairs ?? []).map((p) => ({
                  value: p.pair,
                  label: `${label(p.base)} / ${label(p.quote)}`,
                }))}
                onChange={(next) => {
                  setPairName(next);
                  reset();
                }}
              />
            </div>
            <div className="p-select-field">
              <span>Side</span>
              <Select
                ariaLabel="Desk side"
                value={side}
                disabled={busy}
                options={sides}
                onChange={(next) => {
                  setSide(next);
                  reset();
                }}
              />
            </div>
            <label>
              Amount{sold ? ` (${label(sold)})` : ""}
              <input
                aria-label="Desk amount"
                className="p-search"
                inputMode="decimal"
                value={amount}
                disabled={busy}
                onChange={(event) => {
                  setAmount(event.target.value);
                  reset();
                }}
              />
            </label>
            <button type="submit" className="p-button p-button-primary" disabled={busy || !pair}>
              {busy ? "Working…" : wallet.address ? "Get signed quote" : "Connect wallet"}
            </button>
          </form>
          <div className="flex flex-wrap gap-2 my-4">
            {(
              [
                ["normal", "Normal trade"],
                ["over", "Over the route cap"],
                ["under", "Under the minimum"],
              ] as const
            ).map(([preset, text]) => (
              <button
                key={preset}
                type="button"
                className="p-button p-button-secondary"
                disabled={busy || !pair || (preset === "over" && !pair.vaultRoutes)}
                onClick={() => void requestQuote(preset)}
              >
                {text}
              </button>
            ))}
          </div>
          {error && !result && errorAlert}
          {wallet.isConnected && wallet.chainId !== platformConfig.chain.id && (
            <p role="alert">
              Wrong network.{" "}
              <button type="button" className="p-text-button" onClick={openNetwork}>
                Switch to {platformConfig.chain.name}
              </button>
            </p>
          )}
          {result && ticket && (
            <div className="d-quote" key={result.quote.id} aria-live="polite">
              <div className="d-quote-ticket" ref={ticketRef}>
                <div className="d-quote-head">
                  <span className="p-pill">
                    {result.quote.route === "paper"
                      ? "Paper quote · no tokens move"
                      : result.status.mode === "live"
                        ? `Live vault quote${result.status.chainId === 133 ? " · testnet" : ""}`
                        : "Vault quote"}
                  </span>
                  {!fill && (
                    <span role="status" className="d-quote-expiry" data-urgent={remaining < 10}>
                      {remaining > 0
                        ? `Quote expires in ${remaining}s`
                        : "Quote expired. Get a new signed quote."}
                    </span>
                  )}
                </div>
                <dl className="d-quote-terms">
                  <div>
                    <dt>You pay</dt>
                    <dd title={ticket.amountIn}>
                      {formatNumber(Number(ticket.amountIn), 6)} {label(ticket.input)}
                    </dd>
                  </div>
                  <div>
                    <dt>You receive</dt>
                    <dd title={ticket.amountOut}>
                      {formatNumber(Number(ticket.amountOut), 6)} {label(ticket.output)}
                    </dd>
                  </div>
                  <div>
                    <dt>Price</dt>
                    <dd>
                      {formatNumber(ticket.price, 8)} {label(result.pair.quote)}
                    </dd>
                  </div>
                  <div>
                    <dt>Cost against mid</dt>
                    <dd>{pct(result.quote.vsMidBps / 10000)}</dd>
                  </div>
                  <div>
                    <dt>Checks</dt>
                    <dd data-failed={failedChecks > 0}>{checkSummary}</dd>
                  </div>
                </dl>
                {error && errorAlert}
                {!fill && (
                  <button
                    type="button"
                    className="p-button p-button-primary d-quote-cta"
                    disabled={
                      busy ||
                      remaining < 5 ||
                      !result.verification.ok ||
                      checks.some((c) => c.pass === false)
                    }
                    onClick={() => void settle()}
                  >
                    {busy
                      ? "Waiting for settlement…"
                      : result.quote.route === "paper"
                        ? "Fill paper quote"
                        : "Settle from wallet"}
                  </button>
                )}
                {fill && (
                  <div role="status" className="d-quote-settled">
                    <p>
                      {fill.paper
                        ? "Paper fill complete. No tokens moved."
                        : "Swap settled on-chain."}
                    </p>
                    {fill.txHash && (
                      <ExternalLink href={`${platformConfig.explorer}/tx/${fill.txHash}`}>
                        View transaction
                      </ExternalLink>
                    )}
                    <Balance token={result.pair.base} />
                    <Balance token={result.pair.quote} />
                  </div>
                )}
              </div>
              <details className="d-quote-detail">
                <summary>
                  <h3>1. Where the price came from</h3>
                  <span>Fused mid {formatNumber(result.quote.breakdown.mid, 8)}</span>
                </summary>
                <div className="p-table-wrap">
                  <table className="p-table">
                    <thead>
                      <tr>
                        <th>Venue</th>
                        <th>Mid</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.quote.breakdown.sources.map((source) => (
                        <tr key={source.venue}>
                          <td>{venueLabel(source.venue)}</td>
                          <td>
                            {source.status === "down" ? "Unavailable" : formatNumber(source.mid, 8)}
                          </td>
                          <td>{source.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  Fused mid: {formatNumber(result.quote.breakdown.mid, 8)}. Pricing reference:{" "}
                  {formatNumber(result.quote.breakdown.ref, 8)}.
                </p>
              </details>
              <details className="d-quote-detail">
                <summary>
                  <h3>2. How the spread was built</h3>
                  <span>Half-spread {pct(result.quote.breakdown.half)}</span>
                </summary>
                <div className="p-table-wrap">
                  <table className="p-table d-spread-table" aria-label="Spread breakdown">
                    <thead>
                      <tr>
                        <th scope="col">Term</th>
                        <th scope="col">Value</th>
                        <th scope="col">What it means</th>
                      </tr>
                    </thead>
                    <tbody>
                      {terms
                        .filter(([key]) => result.quote.breakdown[key] !== 0)
                        .map(([key, text, meaning]) => (
                          <tr key={key}>
                            <th scope="row">{text}</th>
                            <td>{pct(result.quote.breakdown[key])}</td>
                            <td>{meaning}</td>
                          </tr>
                        ))}
                      {result.quote.breakdown.tuner !== 1 && (
                        <tr>
                          <th scope="row">Spread adjustment</th>
                          <td>{formatNumber(result.quote.breakdown.tuner, 4)}×</td>
                          <td>Scales the spread</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row">Final half-spread</th>
                        <td>{pct(result.quote.breakdown.half)}</td>
                        <td>Spread after adjustments</td>
                      </tr>
                      <tr className="d-spread-total">
                        <th scope="row">Total price cost</th>
                        <td>{pct(result.quote.vsMidBps / 10000)}</td>
                        <td>Compared with the fused mid</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </details>
              <details className="d-quote-detail" open={failedChecks > 0}>
                <summary>
                  <h3>3. What was checked</h3>
                  <span>{checkSummary}</span>
                </summary>
                <div className="p-table-wrap">
                  <table className="p-table">
                    <thead>
                      <tr>
                        <th>Check</th>
                        <th>Result</th>
                        <th>Values</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checks.map((check) => (
                        <tr key={check.name}>
                          <td>{check.name}</td>
                          <td>
                            {check.pass === null ? "Unavailable" : check.pass ? "Pass" : "Fail"}
                          </td>
                          <td>{check.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}
        </>
      )}
    </section>
  );
}
