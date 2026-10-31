"use client";
import type { Arena } from "@zethos/sdk";
import { Activity } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatNumber, formatUsd } from "../../../lib/platform-config";
import { EmptyState } from "../primitives";
import { flowColors, flowNames, time } from "./presentation";
import type { ArenaPageContentState } from "./use-arena-controller";

type Props = Pick<ArenaPageContentState, "decisions"> & {
  data: Arena;
  rows: (Arena["series"][number] & Arena["byFlow"])[];
};

export function ArenaChart({ decisions, data, rows }: Props) {
  return (
    <section className="p-card p-arena-chart">
      <div className="p-card-header">
        <div>
          <h2>Paper equity &amp; P&amp;L by flow</h2>
          <p>Flow P&amp;L uses completed five-minute markouts. New fills need time.</p>
        </div>
      </div>
      <div
        className="p-arena-chart-canvas"
        role="img"
        aria-label={`Paper equity ${formatUsd(data.equityUsd)}. ${Object.entries(data.byFlow)
          .map(([flow, pnl]) => `${flow}: ${formatUsd(pnl)}`)
          .join(". ")}`}
      >
        {rows.length > 1 ? (
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 700, height: 280 }}
          >
            <LineChart
              data={rows}
              accessibilityLayer
              margin={{ top: 15, right: 10, bottom: 10, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke="var(--p-line)" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={time}
                minTickGap={65}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                yAxisId="flow"
                tickFormatter={(v: number) => `$${formatNumber(v)}`}
                width={60}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                yAxisId="equity"
                orientation="right"
                domain={["auto", "auto"]}
                width={80}
                tickFormatter={(value: number) => `$${formatNumber(value, 0)}`}
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                labelFormatter={(label) => time(Number(label))}
                formatter={(value) => formatUsd(Number(value))}
              />
              <Line
                yAxisId="equity"
                dataKey="equity"
                name="Paper equity"
                stroke="var(--color-ink)"
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
              />
              {(Object.keys(flowNames) as (keyof typeof flowNames)[]).map((flow) => (
                <Line
                  key={flow}
                  yAxisId="flow"
                  dataKey={flow}
                  name={flowNames[flow]}
                  stroke={flowColors[flow]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
              {decisions.data
                ?.filter((d) => d.type === "taker_tier_change" && d.ts >= (rows[0]?.t ?? 0))
                .map((d) => (
                  <ReferenceLine
                    key={d.id}
                    yAxisId="flow"
                    x={d.ts}
                    stroke="#b48127"
                    strokeDasharray="3 5"
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState icon={<Activity size={22} />} title="Collecting paper observations">
            The equity chart starts with the next heartbeat.
          </EmptyState>
        )}
      </div>
      <div className="p-arena-flow-legend">
        <span>Dashed: paper equity (right axis)</span>
        {Object.entries(data.byFlow).map(([flow, pnl]) => (
          <span key={flow} style={{ color: flowColors[flow as keyof typeof flowColors] }}>
            {flowNames[flow as keyof typeof flowNames]} <strong>{formatUsd(pnl)}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}
