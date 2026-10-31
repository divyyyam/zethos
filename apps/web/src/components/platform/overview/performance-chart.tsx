"use client";
import type { Arena } from "@zethos/sdk";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd } from "../../../lib/platform-config";
import {
  clock,
  FLOW_COLOR,
  FLOW_LABEL,
  FLOWS,
  type FlowName,
  RANGES,
  type RangeKey,
  signedUsd,
  type View,
} from "./model";

export function ChartTip({
  active,
  payload,
  label,
  money,
}: {
  active?: boolean;
  payload?: readonly { name?: unknown; value?: unknown; color?: string; dataKey?: unknown }[];
  label?: unknown;
  money: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="d-chart-tip">
      <strong>{clock(Number(label))}</strong>
      {payload.map((entry) => (
        <span key={String(entry.dataKey)}>
          {payload.length > 1 && <i style={{ background: entry.color }} aria-hidden />}
          {String(entry.name)}
          <b>{money(Number(entry.value))}</b>
        </span>
      ))}
    </div>
  );
}

export function PerformanceChart({
  arena,
  view,
  onView,
}: {
  arena: Arena;
  view: View;
  onView: (view: View) => void;
}) {
  const [range, setRange] = useState<RangeKey>("15m");
  const [hidden, setHidden] = useState<FlowName[]>([]);
  const rows = useMemo(() => {
    const end = arena.series.at(-1)?.t ?? 0;
    const span = RANGES.find((item) => item.key === range)?.ms ?? Number.POSITIVE_INFINITY;
    const start = arena.series[0]?.equity ?? 0;
    return arena.series
      .filter((point) => end - point.t <= span)
      .map((point) => ({
        t: point.t,
        equity: point.equity,
        pnl: point.equity - start,
        ...point.byFlow,
      }));
  }, [arena.series, range]);
  const money = view === "equity" ? formatUsd : signedUsd;
  const axis = {
    tickLine: false,
    axisLine: false,
    tick: { fontSize: 12, fill: "var(--p-muted)" },
  };
  return (
    <section className="d-card d-span-8 d-chart-card" aria-labelledby="performance-title">
      <header className="d-card-head">
        <div>
          <h2 id="performance-title">Performance</h2>
          <p>Paper, marked at the fused mid every heartbeat</p>
        </div>
        <div className="d-controls">
          <fieldset className="d-segment" aria-label="Chart view">
            {(
              [
                ["equity", "Equity"],
                ["pnl", "P&L"],
                ["flow", "By flow"],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={view === key}
                data-cursor="hover"
                onClick={() => onView(key)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <fieldset className="d-segment" aria-label="Time range">
            {RANGES.map((item) => (
              <button
                type="button"
                key={item.key}
                aria-pressed={range === item.key}
                data-cursor="hover"
                onClick={() => setRange(item.key)}
              >
                {item.label}
              </button>
            ))}
          </fieldset>
        </div>
      </header>
      <div
        className="d-chart"
        role="img"
        aria-label={`Paper equity ${formatUsd(arena.equityUsd)}, total paper profit and loss ${signedUsd(arena.pnl.total)}.`}
      >
        {rows.length < 2 ? (
          <p className="d-empty-line">
            Collecting observations. The chart starts with the next heartbeat.
          </p>
        ) : (
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 760, height: 280 }}
          >
            {view === "flow" ? (
              <LineChart data={rows} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--p-line)" />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={clock}
                  minTickGap={70}
                  {...axis}
                />
                <YAxis tickFormatter={(value: number) => formatUsd(value)} width={72} {...axis} />
                <Tooltip content={(props) => <ChartTip {...props} money={signedUsd} />} />
                {FLOWS.filter((flow) => !hidden.includes(flow)).map((flow) => (
                  <Line
                    key={flow}
                    dataKey={flow}
                    name={FLOW_LABEL[flow]}
                    stroke={FLOW_COLOR[flow]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            ) : (
              <AreaChart data={rows} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="d-equity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5b4fd1" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#5b4fd1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--p-line)" />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={clock}
                  minTickGap={70}
                  {...axis}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tickFormatter={(value: number) => money(value)}
                  width={88}
                  {...axis}
                />
                <Tooltip content={(props) => <ChartTip {...props} money={money} />} />
                <Area
                  dataKey={view}
                  name={view === "equity" ? "Paper equity" : "Paper P&L"}
                  stroke="#14113a"
                  strokeWidth={2}
                  fill="url(#d-equity)"
                  isAnimationActive={false}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
      {view === "flow" && (
        <div className="d-legend">
          {FLOWS.map((flow) => (
            <button
              type="button"
              key={flow}
              aria-pressed={!hidden.includes(flow)}
              data-cursor="hover"
              onClick={() =>
                setHidden((current) =>
                  current.includes(flow)
                    ? current.filter((item) => item !== flow)
                    : [...current, flow],
                )
              }
            >
              <i style={{ background: FLOW_COLOR[flow] }} aria-hidden />
              {FLOW_LABEL[flow]}
              <b>{signedUsd(arena.byFlow[flow])}</b>
            </button>
          ))}
          <span>Uses completed five-minute markouts, so new fills take time to count.</span>
        </div>
      )}
    </section>
  );
}
