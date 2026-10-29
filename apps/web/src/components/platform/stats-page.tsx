"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Info,
  Layers3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { sampleSeries, sampleSummary } from "../../content/platform.mock";
import { engine } from "../../lib/engine/client";
import { formatNumber, formatUsd, platformConfig, shortAddress } from "../../lib/platform-config";
import { BrandMark, ExternalLink, StatusDot, TokenIcon } from "./primitives";

const ranges = [
  { key: "6h", label: "6 hours" },
  { key: "24h", label: "24 hours" },
  { key: "all", label: "All time" },
] as const;
type Range = (typeof ranges)[number]["key"];
function chartTime(value: number) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(value > 1e12 ? value : value * 1000);
}
export function StatsPageContent() {
  const [pair, setPair] = useState("WHSK/USDT");
  const [range, setRange] = useState<Range>("all");
  const sample = !platformConfig.engineUrl;
  const uid = useId();
  const query = useQuery({
    queryKey: ["engine", "stats", pair, range],
    enabled: !sample,
    retry: false,
    staleTime: 20000,
    refetchInterval: 30000,
    queryFn: ({ signal }) => {
      const now = Date.now();
      return engine.stats(
        pair.startsWith("WETH") ? "ETH/USDT" : "HSK/USDT",
        range === "all" ? 0 : now - (range === "6h" ? 6 : 24) * 3600000,
        now,
        signal,
      );
    },
  });
  const summary = sample ? sampleSummary : query.data?.summary;
  const series = useMemo(() => {
    if (!sample) return query.data?.series ?? [];
    const values = sampleSeries(pair);
    return range === "6h" ? values.slice(-7) : range === "24h" ? values.slice(-25) : values;
  }, [sample, pair, range, query.data?.series]);
  const digits = pair.startsWith("WETH") ? 2 : 5;
  const intervention = sample ? sampleSeries(pair)[21]?.t : undefined;
  const showIntervention = intervention && series[0] && series[0].t <= intervention;
  const totalFills = summary?.swapsFilled ?? (sample ? 1240 : query.data?.fills.length);
  return (
    <>
      <div className="p-page-heading">
        <div>
          <p className="p-eyebrow">THE DIFFERENCE, IN PLAIN SIGHT</p>
          <h1>A clearer view of the market.</h1>
          <p>Better execution should be something you can see.</p>
        </div>
        <div className="p-page-tools">
          <span className={`p-pill ${sample ? "p-pill-neutral" : ""}`}>
            <StatusDot />
            {sample ? "Sample data" : query.isError ? "Data unavailable" : "Engine data"}
          </span>
          {!sample && (
            <button
              type="button"
              className="p-icon-button"
              aria-label="Refresh market insights"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw size={16} className={query.isFetching ? "p-spin" : ""} />
            </button>
          )}
        </div>
      </div>
      {query.isError && (
        <div className="p-form-error" role="alert">
          {query.error.message}
          <button className="p-text-button" type="button" onClick={() => void query.refetch()}>
            Try again
            <RefreshCw size={12} />
          </button>
        </div>
      )}
      <section className="p-metrics-grid" aria-label="Market performance">
        <div className="p-metric p-metric-featured">
          <span>Total user savings</span>
          <strong>{summary ? formatUsd(summary.userSavings) : "—"}</strong>
          <small>
            <ArrowUpRight size={13} />
            More value stays with swappers.
          </small>
          <span className="p-metric-decoration" aria-hidden>
            <BrandMark className="size-16" />
          </span>
        </div>
        <div className="p-metric">
          <span>Volume filled</span>
          <strong>{summary ? `$${formatNumber(summary.volumeFilled / 1000, 1)}K` : "—"}</strong>
          <small>Settled through the vault</small>
        </div>
        <div className="p-metric">
          <span>Price gap after the agent</span>
          <strong>{summary ? `${formatNumber(summary.medianGapAfter, 2)}%` : "—"}</strong>
          <small>
            <ArrowDownRight size={13} />
            From {summary ? `${formatNumber(summary.medianGapBefore)}%` : "—"} before
          </small>
        </div>
        <div className="p-metric">
          <span>Swaps filled</span>
          <strong>{totalFills === undefined ? "—" : formatNumber(totalFills, 0)}</strong>
          <small>Every fill has an on-chain trail.</small>
        </div>
      </section>
      <section className="p-card p-market-chart" aria-labelledby="market-chart-title">
        <div className="p-card-header">
          <div>
            <h2 id="market-chart-title">A market, brought closer.</h2>
            <p>Exchange reference and HSKSwap price, side by side.</p>
          </div>
          <fieldset className="p-chart-pairs" aria-label="Chart trading pair">
            {["WHSK/USDT", "WETH/USDT"].map((value) => (
              <button
                type="button"
                aria-pressed={pair === value}
                key={value}
                onClick={() => setPair(value)}
              >
                <TokenIcon symbol={value.startsWith("WETH") ? "WETH" : "WHSK"} />
                {value.replace("/", " / ")}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="p-chart-toolbar">
          <div className="p-chart-legend">
            <span>
              <i className="exchange" />
              Exchange reference
            </span>
            <span>
              <i className="pool" />
              HSKSwap
            </span>
          </div>
          <fieldset className="p-segmented" aria-label="Chart time range">
            {ranges.map((option) => (
              <button
                type="button"
                key={option.key}
                aria-pressed={range === option.key}
                onClick={() => setRange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="p-chart-unit">Price in USDT</div>
        <div
          className="p-chart"
          role="img"
          aria-label={`${pair.replace("/", " to ")} price history. ${summary ? `The median gap fell from ${summary.medianGapBefore}% to ${summary.medianGapAfter}%.` : "Waiting for market history."}`}
        >
          {series.length ? (
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={{ width: 900, height: 310 }}
            >
              <ComposedChart
                data={series}
                margin={{ top: 16, right: 12, bottom: 8, left: 0 }}
                accessibilityLayer
              >
                <defs>
                  <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--p-accent)" stopOpacity={0.11} />
                    <stop offset="100%" stopColor="var(--p-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--p-line)" strokeDasharray="3 5" />
                <XAxis
                  dataKey="t"
                  tickFormatter={chartTime}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={60}
                  tick={{ fontSize: 10, fill: "var(--p-muted)" }}
                  dy={12}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tickFormatter={(value: number) => formatNumber(value, digits)}
                  tickLine={false}
                  axisLine={false}
                  width={pair.startsWith("WETH") ? 60 : 65}
                  tick={{ fontSize: 10, fill: "var(--p-muted)" }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="p-chart-tooltip">
                        <strong>{chartTime(Number(label))} IST</strong>
                        {payload
                          .filter(
                            (entry) => entry.dataKey === "mid" || entry.dataKey === "poolPrice",
                          )
                          .map((entry) => (
                            <div key={String(entry.dataKey)}>
                              <span>{entry.dataKey === "mid" ? "Exchange" : "HSKSwap"}</span>
                              <b>{formatNumber(Number(entry.value), digits)} USDT</b>
                            </div>
                          ))}
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="mid"
                  stroke="none"
                  fill={`url(#${uid}-area)`}
                  isAnimationActive={false}
                  tooltipType="none"
                />
                <Line
                  name="HSKSwap"
                  type="monotone"
                  dataKey="poolPrice"
                  dot={false}
                  stroke="#b9856d"
                  strokeWidth={1.8}
                  isAnimationActive={false}
                />
                <Line
                  name="Exchange reference"
                  type="monotone"
                  dataKey="mid"
                  dot={false}
                  stroke="var(--p-accent)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                {showIntervention && (
                  <ReferenceLine
                    x={intervention}
                    stroke="var(--p-accent)"
                    strokeDasharray="4 5"
                    label={{
                      value: "Agent enabled",
                      position: "insideTopRight",
                      fill: "var(--p-accent)",
                      fontSize: 10,
                    }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="p-chart-empty">
              <Layers3 size={25} />
              <p>
                {query.isFetching
                  ? "Reading the market…"
                  : "Market history will appear when the engine is available."}
              </p>
            </div>
          )}
        </div>
        <div className="p-chart-bottom">
          <p>
            <Info size={12} />
            {sample
              ? "Illustrative market data. These are not live prices or results."
              : "Reference prices are indicative. Only a signed quote guarantees an executable price."}
          </p>
          <span>Times shown in IST</span>
        </div>
      </section>
      <div className="p-insight-bottom">
        <section className="p-card p-gap-card" aria-labelledby="gap-title">
          <div className="p-card-header">
            <div>
              <p className="p-eyebrow">A SMALLER GAP. A BETTER SWAP.</p>
              <h2 id="gap-title">Closer to the real market.</h2>
            </div>
            <span className="p-insight-icon">
              <ArrowDownRight size={22} />
            </span>
          </div>
          <div className="p-gap-comparison">
            <div>
              <span>Before the agent</span>
              <strong>{summary ? `${formatNumber(summary.medianGapBefore)}%` : "—"}</strong>
              <div className="p-gap-bar before">
                <span />
              </div>
            </div>
            <ArrowRight size={20} className="p-muted" />
            <div>
              <span>After the agent</span>
              <strong className="p-success-text">
                {summary ? `${formatNumber(summary.medianGapAfter)}%` : "—"}
              </strong>
              <div className="p-gap-bar after">
                <span
                  style={{
                    width:
                      summary && summary.medianGapBefore > 0
                        ? `${Math.min(100, (summary.medianGapAfter / summary.medianGapBefore) * 100)}%`
                        : "0%",
                  }}
                />
              </div>
            </div>
          </div>
          <p className="p-card-footnote">
            Median difference between the pool and exchange reference.
            {sample ? " Sample comparison." : ""}
          </p>
        </section>
        <section className="p-card p-verification-card" aria-labelledby="verify-title">
          <span className="p-verification-icon">
            <ShieldCheck size={24} strokeWidth={1.4} />
          </span>
          <p className="p-eyebrow">TRUST, WITH A PAPER TRAIL</p>
          <h2 id="verify-title">Open by design.</h2>
          <p>
            Each settled fill records its pool comparison on-chain. Follow the trail, right down to
            the transaction.
          </p>
          <div>
            {platformConfig.vaultAddress ? (
              <ExternalLink
                href={`${platformConfig.explorer}/address/${platformConfig.vaultAddress}`}
              >
                Vault {shortAddress(platformConfig.vaultAddress)}
              </ExternalLink>
            ) : (
              <ExternalLink href={platformConfig.explorer}>Explore HashKey Chain</ExternalLink>
            )}
            <ExternalLink href="https://github.com/divyyyam/zethos/tree/main/docs">
              Read the architecture
            </ExternalLink>
          </div>
        </section>
      </div>
    </>
  );
}
