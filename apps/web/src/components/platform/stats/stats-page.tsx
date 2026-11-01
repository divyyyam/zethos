"use client";

import { useQuery } from "@tanstack/react-query";
import type { Pair } from "@zethos/sdk";
import { Info, Layers3, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { sampleSeries } from "../../../content/platform.mock";
import { useEngineStatus } from "../../../hooks/platform/use-platform";
import { failureMessage, zethos } from "../../../lib/engine/sdk";
import {
  formatNumber,
  formatUsd,
  platformConfig,
  tokenBySymbol,
} from "../../../lib/platform-config";
import { EmptyState, ExternalLink, StatusDot } from "../primitives";

const chartTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const colors = ["#356bb3", "#7955ac", "#b48127", "#247b64", "#b74c35", "#696b75"];
export function StatsPageContent() {
  const [pair, setPair] = useState<Pair>("HSK/USDT");
  const [range, setRange] = useState("6h");
  const status = useEngineStatus();
  const uid = useId();
  const sample = !platformConfig.engineUrl;
  const query = useQuery({
    queryKey: ["engine", "stats", pair, range],
    enabled: Boolean(zethos),
    retry: false,
    refetchInterval: 30000,
    queryFn: () => {
      if (!zethos) throw new Error("Engine is not configured");
      const now = Date.now();
      return zethos.stats({
        pair,
        from: range === "all" ? 0 : now - (range === "6h" ? 6 : 24) * 3600000,
        to: now,
      });
    },
  });
  const market = status.data?.pairs.find((p) => p.pair === pair);
  const quoteLabel = market?.quote.label ?? tokenBySymbol("USDT").label;
  const series = sample
    ? sampleSeries(pair === "HSK/USDT" ? "WHSK/USDT" : "WETH/USDT").map((p) => ({
        t: p.t,
        mid: p.mid,
      }))
    : query.isError
      ? []
      : (query.data?.series ?? []).map((p) => ({ ...p, ...p.sources }));
  const summary = !query.isError ? query.data?.summary : undefined;
  const venues = !query.isError ? query.data?.venues : undefined;
  return (
    <>
      <div className="p-page-heading">
        <div>
          <h1>Insights</h1>
          <p>Exchange prices and on-chain liquidity, shown as they are.</p>
        </div>
        <div className="p-page-tools">
          <span className="p-pill p-pill-neutral">
            <StatusDot />
            {sample
              ? "Sample price history"
              : status.data?.mode === "shadow"
                ? "Paper settlement"
                : "Engine data"}
          </span>
          {!sample && (
            <button
              type="button"
              className="p-icon-button"
              aria-label="Refresh Insights"
              onClick={() => void query.refetch()}
            >
              <RefreshCw size={16} />
            </button>
          )}
        </div>
      </div>
      {query.isError && (
        <p role="alert" className="p-form-error">
          {failureMessage(query.error)}{" "}
          <button type="button" className="p-text-button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      )}
      <section className="p-metrics-grid" aria-label="Observed market data">
        <div className="p-metric p-metric-featured">
          <span>Fused exchange mid</span>
          <strong>{market?.mid ? `${formatNumber(market.mid, 5)} ${quoteLabel}` : "—"}</strong>
          <small>{market?.health ?? "Waiting for feeds"}</small>
        </div>
        <div className="p-metric">
          <span>Paper volume filled</span>
          <strong>{summary ? formatUsd(summary.volumeUsd) : "—"}</strong>
          <small>Selected pair and time range</small>
        </div>
        <div className="p-metric">
          <span>Paper fills</span>
          <strong>{summary ? formatNumber(summary.fills, 0) : "—"}</strong>
          <small>Recorded settlement, not exchange volume</small>
        </div>
        <div className="p-metric">
          <span>On-chain depth ±2%</span>
          <strong>{venues ? formatUsd(venues.reduce((s, v) => s + v.depthUsd, 0)) : "—"}</strong>
          <small>
            {venues?.length
              ? `${venues.length} configured venues`
              : "No confirmed venue configured"}
          </small>
        </div>
      </section>
      <section className="p-card p-market-chart" aria-labelledby={`${uid}-title`}>
        <div className="p-card-header">
          <div>
            <h2 id={`${uid}-title`}>Exchange price vs on-chain reality</h2>
            <p>Depth-weighted exchange mid and the sources used to build it.</p>
          </div>
          <fieldset className="p-chart-pairs" aria-label="Trading pair">
            {(["HSK/USDT", "ETH/USDT"] as const).map((p) => (
              <button type="button" key={p} aria-pressed={p === pair} onClick={() => setPair(p)}>
                {p}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="p-chart-toolbar">
          <span className="p-card-footnote">Fused mid · selected healthy sources</span>
          <fieldset className="p-segmented" aria-label="Time range">
            {["6h", "24h", "all"].map((r) => (
              <button type="button" key={r} aria-pressed={r === range} onClick={() => setRange(r)}>
                {r === "all" ? "All history" : r}
              </button>
            ))}
          </fieldset>
        </div>
        <div
          className="p-chart"
          role="img"
          aria-label={`${pair} exchange price history. ${sample ? "Sample data." : `${series.length} recorded price observations.`}`}
        >
          {series.length ? (
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={{ width: 900, height: 310 }}
            >
              <LineChart
                data={series}
                accessibilityLayer
                margin={{ top: 20, right: 20, bottom: 15, left: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--p-line)" strokeDasharray="3 5" />
                <XAxis
                  dataKey="t"
                  tickFormatter={chartTime}
                  minTickGap={60}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => formatNumber(v, pair === "HSK/USDT" ? 5 : 2)}
                  tick={{ fontSize: 11 }}
                  width={70}
                />
                <Tooltip
                  labelFormatter={(label) => chartTime(Number(label))}
                  formatter={(value) => `${formatNumber(Number(value), 5)} ${quoteLabel}`}
                />
                {market?.sources.map((source, index) => (
                  <Line
                    key={source.venue}
                    dataKey={source.venue}
                    name={source.venue}
                    stroke={colors[index % colors.length] ?? "#356bb3"}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  dataKey="mid"
                  name="Fused mid"
                  stroke="var(--p-accent)"
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              icon={<Layers3 size={25} />}
              title={query.isFetching ? "Reading the market…" : "No market history yet"}
            >
              Live observations appear when the engine has healthy price feeds.
            </EmptyState>
          )}
        </div>
        <div className="p-chart-bottom">
          <p>
            <Info size={12} />
            {sample
              ? "Illustrative exchange history. No live results are implied."
              : "Reference prices are indicative. A verified signed quote fixes the output until expiry."}
          </p>
        </div>
      </section>
      <div className="p-insight-bottom">
        <section className="p-card p-gap-card">
          <div className="p-card-header">
            <h2>Exchange sources</h2>
          </div>
          {market?.sources.map((source) => (
            <div className="p-signal-row" key={source.venue}>
              <span style={{ width: 120 }}>{source.venue}</span>
              <span>{source.status}</span>
              <span>
                {source.status !== "down" && source.mid
                  ? `${formatNumber(source.mid, 5)} ${quoteLabel}`
                  : "—"}
              </span>
              <strong>{formatNumber(source.weight * 100, 0)}%</strong>
            </div>
          ))}
          {!market && <p className="p-card-footnote">No live source data is available.</p>}
          <p className="p-card-footnote">
            Stale and disagreeing sources are excluded. HSK is not listed on Binance or OKX.
          </p>
        </section>
        <section className="p-card p-verification-card">
          <span className="p-verification-icon">
            <ShieldCheck size={24} />
          </span>
          <h2>What can be verified</h2>
          <p>
            {status.data?.mode === "shadow"
              ? "Paper signatures, fill records, markouts and agent decisions are visible in the Arena. There is no on-chain fill in shadow mode."
              : "Paper settlement and live settlement have different verification trails. The Arena explains the current methodology."}
          </p>
          <div>
            <Link className="p-text-link" href="/arena#methodology">
              Read the paper methodology
            </Link>
            <ExternalLink href="https://github.com/divyyyam/zethos#readme">
              Project architecture
            </ExternalLink>
          </div>
        </section>
      </div>
    </>
  );
}
