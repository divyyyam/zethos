"use client";

import type { Fill, PairStatus } from "@zethos/sdk";
import { useId, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { formatPrice, formatToken, type MarketState } from "../../../lib/agent/runtime";
import { formatUsd, shortAddress } from "../../../lib/platform-config";

function PriceLine({ points, label }: { points: { t: number; mid: number }[]; label: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = 360;
  const height = 120;
  const shape = useMemo(() => {
    if (points.length < 2) return null;
    const mids = points.map((point) => point.mid);
    const low = Math.min(...mids);
    const high = Math.max(...mids);
    const range = high - low || high * 0.0001;
    const start = points[0]?.t ?? 0;
    const span = (points.at(-1)?.t ?? 1) - start || 1;
    const x = (t: number) => ((t - start) / span) * width;
    const y = (mid: number) => 6 + (1 - (mid - low) / range) * (height - 12);
    const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.mid).toFixed(1)}`).join(" L");
    return { line: `M${line}`, x, low, high };
  }, [points]);
  if (!shape)
    return (
      <div className="grid h-[120px] place-items-center text-sm text-fg-soft">
        Collecting prices
      </div>
    );
  const active = hover === null ? null : points[hover];
  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        className="block h-[120px] w-full"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          const first = points[0]?.t ?? 0;
          const target = first + ratio * ((points.at(-1)?.t ?? 0) - first);
          let best = 0;
          points.forEach((point, index) => {
            if (Math.abs(point.t - target) < Math.abs((points[best]?.t ?? 0) - target))
              best = index;
          });
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5b4fd1" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#5b4fd1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${shape.line} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
        <path
          d={shape.line}
          fill="none"
          stroke="#14113a"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {active && (
          <line
            x1={shape.x(active.t)}
            x2={shape.x(active.t)}
            y1="0"
            y2={height}
            stroke="rgb(20 17 58 / 0.3)"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="num-sm mt-2 flex justify-between gap-3 text-sm text-fg-soft">
        <span>Low {formatPrice(shape.low)}</span>
        {active && (
          <span className="text-fg">
            {new Date(active.t).toLocaleTimeString("en-GB", { hour12: false })},{" "}
            {formatPrice(active.mid)}
          </span>
        )}
        <span>High {formatPrice(shape.high)}</span>
      </div>
    </div>
  );
}

function Venues({ pair }: { pair: PairStatus }) {
  return (
    <ul className="text-[15px]">
      {pair.sources.map((source) => (
        <li
          key={source.venue}
          className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3rem] items-center gap-3 border-t border-line py-2 first:border-t-0"
        >
          <span className={source.status === "ok" ? "" : "text-fg-faint"}>{source.venue}</span>
          {source.status === "ok" ? (
            <>
              <span className="h-[2px] bg-line">
                <span
                  className="block h-full bg-fg"
                  style={{ width: `${Math.round(source.weight * 100)}%` }}
                />
              </span>
              <span className="num-sm text-right text-sm">{Math.round(source.weight * 100)}%</span>
            </>
          ) : (
            <span className="col-span-2 text-sm text-fg-faint">
              {source.status}, not in the mid
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Inventory({ pair, inventory }: { pair: PairStatus; inventory: Record<string, string> }) {
  const baseRaw = inventory[pair.base.symbol];
  const quoteRaw = inventory[pair.quote.symbol];
  if (baseRaw === undefined || quoteRaw === undefined || pair.mid === null) return null;
  const base = Number(formatUnits(BigInt(baseRaw), pair.base.decimals));
  const quote = Number(formatUnits(BigInt(quoteRaw), pair.quote.decimals));
  // USDT backs both pairs, so each pair is measured against its half, as the engine does.
  const baseValue = base * pair.mid;
  const share = baseValue / (baseValue + quote / 2 || 1);
  return (
    <div>
      <div
        role="img"
        aria-label={`Vault holds ${(share * 100).toFixed(1)}% ${pair.base.symbol} against USDT.`}
        className="relative h-[2px] bg-line"
      >
        <span
          className="block h-full bg-fg transition-[width] duration-700 ease-expo"
          style={{ width: `${share * 100}%` }}
        />
        <span aria-hidden className="absolute -top-1.5 left-1/2 h-3.5 w-px bg-fg" />
      </div>
      <div className="num-sm mt-3 flex justify-between gap-3 text-sm text-fg-soft">
        <span>
          {formatToken(base)} {pair.base.label ?? pair.base.symbol}
        </span>
        <span>{(share * 100).toFixed(1)}%, target 50%</span>
        <span>
          {formatToken(quote)} {pair.quote.label ?? pair.quote.symbol}
        </span>
      </div>
    </div>
  );
}

const FLOW_LABEL: Record<Fill["flow"], string> = {
  tape: "Tape",
  user: "User",
  agent: "Agent",
  attacker: "Attacker",
};

function Tape({ fills }: { fills: Fill[] }) {
  if (fills.length === 0)
    return <p className="text-[15px] text-fg-soft">No fills yet. Yours will land here first.</p>;
  return (
    <ol className="text-sm">
      {fills.slice(0, 10).map((fill) => (
        <li
          key={fill.id}
          className="num-sm grid grid-cols-[3.75rem_2.25rem_2.25rem_minmax(0,1fr)_auto_4rem] items-baseline gap-2 border-t border-line py-1.5 first:border-t-0"
        >
          <span className="font-medium" title={fill.paper ? "Paper fill" : "On-chain fill"}>
            {FLOW_LABEL[fill.flow]} · {fill.paper ? "Paper" : "On-chain"}
          </span>
          <span>{fill.side === "buy" ? "Buy" : "Sell"}</span>
          <span className="text-fg-soft">{fill.pair.split("/")[0]}</span>
          <span>{formatPrice(fill.price)}</span>
          <span className="text-fg-soft" title={fill.taker}>
            {shortAddress(fill.taker, 3)}
          </span>
          <time className="text-right text-fg-soft">
            {new Date(fill.ts).toLocaleTimeString("en-GB", { hour12: false })}
          </time>
        </li>
      ))}
    </ol>
  );
}

function Block({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-line pt-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h3 className="eyebrow text-fg">{title}</h3>
        {aside && <span className="num-sm text-sm text-fg-soft">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

export function MarketPanels({ market, pair }: { market: MarketState; pair: PairStatus | null }) {
  const stale = market.connection === "offline";
  return (
    <section
      aria-label="Live market"
      className={`grid gap-x-block gap-y-8 md:grid-cols-2 ${stale ? "opacity-50 grayscale" : ""}`}
    >
      {pair ? (
        <>
          <Block title="Fused mid" aside="Last 15 minutes">
            <PriceLine
              points={market.history[pair.pair] ?? []}
              label={`${pair.pair} fused mid over the last 15 minutes. Currently ${pair.mid === null ? "unavailable" : formatPrice(pair.mid)}.`}
            />
          </Block>
          <Block title="Price sources" aside={pair.pair}>
            <Venues pair={pair} />
          </Block>
          <Block
            title={market.status?.mode === "live" ? "Vault" : "Paper vault"}
            {...(market.status?.equityUsd != null
              ? { aside: formatUsd(market.status.equityUsd) }
              : {})}
          >
            {market.status && <Inventory pair={pair} inventory={market.status.inventory} />}
          </Block>
        </>
      ) : (
        <Block title="Market">
          <p className="text-[15px] text-fg-soft">
            {market.connection === "unconfigured"
              ? "No engine configured. Set NEXT_PUBLIC_ENGINE_URL to bring the agent online."
              : "Waiting for the engine."}
          </p>
        </Block>
      )}
      <Block title="Fill tape" aside="All takers">
        <Tape fills={market.tape} />
      </Block>
    </section>
  );
}
