"use client";

import { Activity, RefreshCw, ShieldCheck } from "lucide-react";
import { failureMessage, zethos } from "../../../lib/engine/sdk";
import { formatNumber, formatUsd, shortAddress } from "../../../lib/platform-config";
import { EmptyState, StatusDot } from "../primitives";
import { ArenaChart } from "./arena-chart";
import { flowColors, flowNames, TierChip, time } from "./presentation";
import { useArenaController } from "./use-arena-controller";

export function ArenaPageContent() {
  const { connected, filter, setFilter, arena, takers, fills, decisions, refresh, error } =
    useArenaController();

  if (!zethos || error)
    return (
      <section className="p-card">
        <EmptyState
          icon={<Activity size={25} />}
          title={!zethos ? "Connect the paper Arena" : "Arena data unavailable"}
          action={
            zethos ? (
              <button className="p-text-button" type="button" onClick={refresh}>
                Retry <RefreshCw size={14} />
              </button>
            ) : undefined
          }
        >
          {error
            ? failureMessage(error)
            : "Set the engine URL to see live paper market making. No sample results are shown here."}
        </EmptyState>
      </section>
    );
  if (!arena.data)
    return (
      <section className="p-card">
        <EmptyState icon={<Activity size={25} />} title="Opening the paper Arena">
          Waiting for the engine’s first valuation.
        </EmptyState>
      </section>
    );
  const data = arena.data;
  const rows = data.series.map((point) => ({ ...point, ...point.byFlow }));
  const attackAddresses = new Set(
    fills.data?.filter((f) => f.flow === "attacker").map((f) => f.taker.toLowerCase()),
  );
  const defended =
    takers.data?.filter(
      (t) =>
        attackAddresses.has(t.address.toLowerCase()) ||
        t.detectedAfter ||
        /attacker/i.test(t.label ?? ""),
    ) ?? [];
  return (
    <>
      <div className="p-page-heading">
        <div>
          <h1>Paper Arena</h1>
          <p>Exchange prices, simulated settlement, observable decisions.</p>
        </div>
        <div className="p-page-tools">
          <span className="p-pill p-pill-neutral">Paper · epoch {data.epoch}</span>
          <span className="p-pill">
            <StatusDot tone={connected ? "success" : "warning"} />
            {connected ? "Streaming" : "Reconnecting…"}
          </span>
          <button
            type="button"
            className="p-icon-button"
            aria-label="Refresh Arena"
            onClick={refresh}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div
        className={!connected || data.valuationStale ? "p-arena-stale" : ""}
        aria-busy={!connected}
      >
        {!connected && (
          <p className="p-card-footnote" role="status">
            Stream disconnected. These are the last received paper values.
          </p>
        )}
        {data.valuationStale && (
          <p className="p-card-footnote" role="status">
            Price feeds are unavailable. Equity shows the last healthy valuation.
          </p>
        )}
        {!!data.unpricedFills && (
          <p className="p-card-footnote">
            {data.unpricedFills} paper fills have no healthy mid at settlement; spread attribution
            excludes those fills.
          </p>
        )}
        <section className="p-metrics-grid" aria-label="Paper market making results">
          <div className="p-metric p-metric-featured">
            <span>Paper equity</span>
            <strong>{formatUsd(data.equityUsd)}</strong>
            <small>Epoch started {time(data.startedAt)}</small>
          </div>
          <div className="p-metric">
            <span>Paper P&amp;L</span>
            <strong>{formatUsd(data.pnl.total)}</strong>
            <small>
              Spread {formatUsd(data.pnl.spread)} · inventory {formatUsd(data.pnl.inventory)} · gas{" "}
              {formatUsd(data.pnl.gas)}
            </small>
          </div>
          <div className="p-metric">
            <span>Paper fills</span>
            <strong>{formatNumber(data.fills, 0)}</strong>
            <small>
              {formatUsd(data.volumeUsd)} volume · {data.takers} takers
            </small>
          </div>
          <div className="p-metric">
            <span>Tape capture</span>
            <strong>
              {data.tapeCaptureRate === null ? "—" : `${formatNumber(data.tapeCaptureRate * 100)}%`}
            </strong>
            <small>Fills won / sampled exchange trades</small>
          </div>
        </section>
        {Object.keys(data.byPolicy).length > 0 && (
          <section className="p-card" aria-label="Paper results by policy">
            <div className="p-card-header">
              <h2>Results by policy</h2>
              <span>Paper · 5-minute markouts</span>
            </div>
            <div className="p-table-wrap">
              <table className="p-table">
                <thead>
                  <tr>
                    <th scope="col">Policy</th>
                    <th scope="col">Fills</th>
                    <th scope="col">Volume</th>
                    <th scope="col">Markout P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.byPolicy)
                    .sort(([, a], [, b]) => b.fills - a.fills)
                    .map(([policyId, result]) => (
                      <tr key={policyId}>
                        <td className="font-mono">{policyId}</td>
                        <td>{formatNumber(result.fills, 0)}</td>
                        <td>{formatUsd(result.volumeUsd)}</td>
                        <td>{formatUsd(result.pnlUsd)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="p-card-footnote">
              Each fill is attributed to the policy that priced it. A canary prices only its share
              of requests, so compare markout P&amp;L per fill, not totals.
            </p>
          </section>
        )}
        <div className="p-arena-grid">
          <ArenaChart decisions={decisions} data={data} rows={rows} />
          <section className="p-card p-arena-takers">
            <div className="p-card-header">
              <h2>Takers</h2>
              <span>{takers.data?.length ?? 0} identities</span>
            </div>
            <div className="p-arena-scroll">
              {takers.data?.length ? (
                takers.data.map((t) => (
                  <details className="p-taker-row" key={t.address}>
                    <summary>
                      <span>
                        {t.label || shortAddress(t.address)}
                        <small>
                          {t.fills} fills · paper P&amp;L {formatUsd(t.pnlUsd)}
                        </small>
                      </span>
                      <TierChip tier={t.tier} />
                    </summary>
                    <progress
                      value={t.score}
                      max={1}
                      aria-label={`Toxicity score ${t.score.toFixed(2)}`}
                    />
                    <p className="p-card-footnote">
                      Score {t.score.toFixed(3)} · P&amp;L shown from the taker’s view.
                    </p>
                    {Object.entries(t.signals).map(([signal, value]) => (
                      <label key={signal} className="p-signal-row">
                        <span>{signal}</span>
                        <meter min={0} max={1} value={value} />
                        <span>{formatNumber(value * 100, 0)}%</span>
                      </label>
                    ))}
                    {t.detectedAfter && (
                      <p>
                        Detected after {t.detectedAfter.fills} fills /{" "}
                        {formatNumber(t.detectedAfter.seconds, 0)} seconds.
                      </p>
                    )}
                  </details>
                ))
              ) : (
                <p className="p-card-footnote">Waiting for the first quote.</p>
              )}
            </div>
          </section>
          <section className="p-card p-arena-tape">
            <div className="p-card-header">
              <h2>Paper fill tape</h2>
              <span>Newest first</span>
            </div>
            <div className="p-table-wrap p-arena-scroll">
              <table className="p-table">
                <thead>
                  <tr>
                    <th>Flow / time</th>
                    <th>Pair / side</th>
                    <th>Fill price</th>
                    <th>5 s markout</th>
                  </tr>
                </thead>
                <tbody>
                  {fills.data?.map((fill) => (
                    <tr id={fill.id} key={fill.id}>
                      <td>
                        <span style={{ color: flowColors[fill.flow] }}>{flowNames[fill.flow]}</span>
                        <small className="p-fill-time">{time(fill.ts)}</small>
                      </td>
                      <td>
                        {fill.pair}
                        <small className="p-fill-time">Taker {fill.side}</small>
                      </td>
                      <td>{formatNumber(fill.price, 6)} USDT</td>
                      <td>
                        {fill.markouts?.["5"] === undefined
                          ? "Measuring…"
                          : `${formatNumber(fill.markouts["5"])} bps`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!fills.data?.length && (
                <EmptyState icon={<Activity size={22} />} title="Waiting for the first fill">
                  Request and fill a paper quote from Swap or the Agent.
                </EmptyState>
              )}
            </div>
          </section>
          <section className="p-card p-arena-decisions">
            <div className="p-card-header">
              <h2>Decision journal</h2>
              <label className="sr-only" htmlFor="decision-type">
                Decision type
              </label>
              <select id="decision-type" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">All types</option>
                {Array.from(new Set(decisions.data?.map((d) => d.type))).map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="p-arena-scroll">
              {decisions.data
                ?.filter((d) => !filter || d.type === filter)
                .map((d) => (
                  <article className="p-decision-row" key={d.id}>
                    <span className="p-card-footnote">
                      {d.type.replaceAll("_", " ")} · {time(d.ts)}
                    </span>
                    <p>{d.reason}</p>
                    {d.narration && <p className="p-narration">{d.narration}</p>}
                  </article>
                ))}
              {!decisions.data?.length && (
                <p className="p-card-footnote">
                  Every autonomous change will appear here with its measured inputs.
                </p>
              )}
            </div>
          </section>
        </div>
        <section className="p-card p-defence-panel">
          <div className="p-card-header">
            <h2>
              <ShieldCheck size={18} /> Toxic-flow defence
            </h2>
            <span className="p-pill p-pill-neutral">Paper</span>
          </div>
          {defended.length ? (
            defended.map((t) => (
              <div key={t.address} className="p-defence-row">
                <strong>{t.label || shortAddress(t.address)}</strong>
                <TierChip tier={t.tier} />
                <span>
                  {t.detectedAfter
                    ? `Detected after ${t.detectedAfter.fills} fills / ${formatNumber(t.detectedAfter.seconds, 0)}s`
                    : "Collecting behavioural evidence"}
                </span>
                <span>
                  5 s loss / fill: before{" "}
                  {t.preDetectionLossPerFillUsd == null
                    ? "—"
                    : formatUsd(t.preDetectionLossPerFillUsd)}{" "}
                  · after{" "}
                  {t.postDetectionLossPerFillUsd == null
                    ? "—"
                    : formatUsd(t.postDetectionLossPerFillUsd)}
                </span>
                <span>
                  Estimated paper loss avoided: {formatUsd(t.estimatedLossAvoidedUsd ?? 0)}
                </span>
              </div>
            ))
          ) : (
            <p>
              No attacker activity yet. Run{" "}
              <code>bun run --cwd apps/sniper start -- --mode sniper</code> against this engine.
            </p>
          )}
          <p className="p-card-footnote">
            Detection uses fill behavior only. Display labels and flow attribution never change a
            price or tier. Loss avoided is an estimate: pre-detection loss per fill × later
            attempts.
          </p>
        </section>
      </div>
      <details className="p-card p-arena-methodology" id="methodology">
        <summary>How this paper Arena is measured</summary>
        <p>
          Settlement uses simulated inventory and real EIP-712 quote signatures against the zero
          address. No funds move. Paper P&amp;L is not revenue.
        </p>
        <p>
          Equity marks inventory at exchange mids. Signed spread capture includes losses on stale
          quotes; inventory P&amp;L is the remaining valuation change. Shadow arbitrage is zero. Gas
          is modelled from RPC gas prices when available.
        </p>
        <p>
          Exchange tape flow is sampled and scaled. It fills only when Zethos offers at least as
          good a price as the actual exchange trade, after simulated latency. Capture is fills
          divided by sampled attempts.
        </p>
        <p>
          Flow P&amp;L uses five-minute markouts. The defence comparison uses five-second
          measurements. Missing horizons stay pending; feed outages are never filled in with sample
          prices.
        </p>
      </details>
    </>
  );
}
