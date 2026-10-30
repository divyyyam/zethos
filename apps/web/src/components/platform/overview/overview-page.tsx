"use client";

import { useQuery } from "@tanstack/react-query";
import type { Arena, Fill, PairStatus, TakerRow } from "@zethos/sdk";
import { ArrowUpRight, RefreshCw, ShieldCheck } from "lucide-react";
import { animate, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { formatUnits } from "viem";
import {
  agent,
  queueIntent,
  useAgentFeed,
  useAgentMarket,
  useMissions,
} from "../../../hooks/platform/use-agent";
import { useEngineStatus, useEngineStream } from "../../../hooks/platform/use-platform";
import {
  formatPrice,
  formatToken,
  isActive,
  isStoppable,
  missionTotals,
} from "../../../lib/agent/runtime";
import { failureMessage, zethos } from "../../../lib/engine/sdk";
import { formatNumber, formatUsd, shortAddress } from "../../../lib/platform-config";
import { WorldCanvas, type WorldState } from "../../world/world-canvas";
import { CommandBar } from "../agent/command-bar";
import { STATUS_LABEL } from "../agent/mission-card";
import { SignalField } from "../agent/signal-field";
import { StatusDot } from "../primitives";

const FLOWS = ["tape", "user", "agent", "attacker"] as const;
type FlowName = (typeof FLOWS)[number];
const FLOW_LABEL: Record<FlowName, string> = {
  tape: "Exchange tape",
  user: "People",
  agent: "AI agents",
  attacker: "Attacker",
};
// Validated with the dataviz palette checks on the white surface.
const FLOW_COLOR: Record<FlowName, string> = {
  tape: "#1f8a66",
  user: "#2b7cc4",
  agent: "#5b4fd1",
  attacker: "#b86a1f",
};
const RANGES = [
  { key: "5m", label: "5m", ms: 5 * 60_000 },
  { key: "15m", label: "15m", ms: 15 * 60_000 },
  { key: "1h", label: "1h", ms: 3_600_000 },
  { key: "all", label: "All", ms: Number.POSITIVE_INFINITY },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];
type View = "equity" | "pnl" | "flow";

const clock = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const signedUsd = (value: number) => `${value >= 0 ? "+" : "−"}${formatUsd(Math.abs(value))}`;

/** Rolls to each new value instead of snapping. */
function Rolling({ value, format }: { value: number; format: (value: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const still = useReducedMotion();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (still) {
      element.textContent = format(value);
      shown.current = value;
      return;
    }
    const controls = animate(shown.current, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (next) => {
        shown.current = next;
        element.textContent = format(next);
      },
    });
    return () => controls.stop();
  }, [value, format, still]);
  return <span ref={ref}>{format(value)}</span>;
}

function Spark({ values, label }: { values: number[]; label: string }) {
  const line = useMemo(() => {
    if (values.length < 2) return null;
    const low = Math.min(...values);
    const range = Math.max(...values) - low || 1;
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        return `${x.toFixed(2)},${(26 - ((value - low) / range) * 24).toFixed(2)}`;
      })
      .join(" ");
  }, [values]);
  if (!line) return <span className="d-spark" />;
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="d-spark"
      role="img"
      aria-label={label}
    >
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The real hour on the real world: dawn at 05:42, night by 23:10, as the landing's clock runs. */
function dayFromClock(date: Date): number {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const shifted = (minutes - (5 * 60 + 42) + 1440) % 1440;
  return Math.min(1, shifted / (17 * 60 + 28));
}

function greeting(hour: number) {
  if (hour < 5) return "Still up.";
  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
}

function Hero({
  arena,
  status,
}: {
  arena: Arena | undefined;
  status: ReturnType<typeof useEngineStatus>;
}) {
  const router = useRouter();
  const world = useRef<WorldState>({ day: 0.05, cam: 0.13, morph: 0, lake: 1 });
  const box = useRef<HTMLElement>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const now = new Date();
    world.current.day = dayFromClock(now);
    setHour(now.getHours());
    const element = box.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      world.current.idle = !entry?.isIntersecting;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const data = status.data;
  const line = status.isError
    ? "The engine isn’t responding."
    : !data
      ? "Reading the market."
      : data.paused
        ? "The vault is paused."
        : data.riskState === "degraded"
          ? "Quoting, with a price source down."
          : "The vault is quoting.";
  const equity = arena?.equityUsd ?? data?.equityUsd ?? null;
  return (
    <section ref={box} className="d-hero" aria-label="Summary">
      <WorldCanvas state={world} className="d-hero-canvas" />
      <div aria-hidden className="d-hero-scrim" />
      <div className="d-hero-body ink-light">
        <div>
          <h1 className="d-hero-title">
            {hour === null ? "Welcome." : greeting(hour)} <em>{line}</em>
          </h1>
          <CommandBar
            compact
            value={text}
            pairs={data?.pairs ?? []}
            placeholder="Tell Zethos what to do"
            onChange={setText}
            onSubmit={() => {
              if (text.trim()) queueIntent(text.trim());
              router.push("/agent");
            }}
          />
        </div>
        <div className="d-hero-figure">
          <span>Paper equity</span>
          <strong className="num">
            {equity === null ? "—" : <Rolling value={equity} format={formatUsd} />}
          </strong>
          {arena && (
            <small>
              {signedUsd(arena.pnl.total)} this epoch · {plural(arena.fills, "fill")}
            </small>
          )}
        </div>
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  note,
  spark,
  selected,
  onSelect,
  index,
}: {
  label: string;
  value: React.ReactNode;
  note: string;
  spark: number[];
  selected?: boolean;
  onSelect?: () => void;
  index: number;
}) {
  const still = useReducedMotion();
  const body = (
    <>
      <span className="d-tile-label">{label}</span>
      <strong className="num d-tile-value">{value}</strong>
      <span className="d-tile-note">{note}</span>
      <Spark values={spark} label={`${label} trend`} />
    </>
  );
  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: index * 0.05 }}
    >
      {onSelect ? (
        <button
          type="button"
          className="d-card d-tile"
          aria-pressed={selected}
          data-cursor="hover"
          onClick={onSelect}
        >
          {body}
        </button>
      ) : (
        <div className="d-card d-tile">{body}</div>
      )}
    </motion.div>
  );
}

function ChartTip({
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

function PerformanceChart({
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

function MarketCard({
  pair,
  history,
  selected,
  onSelect,
}: {
  pair: PairStatus;
  history: number[];
  selected: boolean;
  onSelect: () => void;
}) {
  const symbol = pair.pair.split("/")[0] ?? pair.pair;
  const healthy = pair.sources.filter((source) => source.status === "ok").length;
  return (
    <div className="d-market" data-selected={selected}>
      <button
        type="button"
        className="d-market-main"
        aria-pressed={selected}
        data-cursor="hover"
        onClick={onSelect}
      >
        <span className="d-market-pair">
          {pair.pair}
          <small>
            <StatusDot tone={pair.health === "ok" ? "success" : "warning"} /> {healthy} of{" "}
            {pair.sources.length} sources
          </small>
        </span>
        <strong className="num">
          {pair.mid === null ? "Halted" : <Rolling value={pair.mid} format={formatPrice} />}
        </strong>
        <Spark values={history} label={`${pair.pair} recent mid`} />
      </button>
      {pair.mid !== null && pair.halfSpread && (
        <dl className="d-market-book">
          <div>
            <dt>Bid</dt>
            <dd>{formatPrice(pair.mid * (1 - pair.halfSpread.sell))}</dd>
          </div>
          <div>
            <dt>Ask</dt>
            <dd>{formatPrice(pair.mid * (1 + pair.halfSpread.buy))}</dd>
          </div>
          <div>
            <dt>Spread</dt>
            <dd>{((pair.halfSpread.buy + pair.halfSpread.sell) * 10_000).toFixed(1)} bps</dd>
          </div>
        </dl>
      )}
      <div className="d-market-actions">
        <button
          type="button"
          data-cursor="hover"
          onClick={() => queueAndGo(`Buy 500 USDT of ${symbol}`)}
        >
          Buy with agent
        </button>
        <button
          type="button"
          data-cursor="hover"
          onClick={() => queueAndGo(`Scan ${symbol} depth`)}
        >
          Scan depth
        </button>
      </div>
    </div>
  );
}

let navigate: ((href: string) => void) | null = null;
function queueAndGo(sentence: string) {
  queueIntent(sentence);
  navigate?.("/agent");
}

function Inventory({
  pairs,
  inventory,
}: {
  pairs: PairStatus[];
  inventory: Record<string, string>;
}) {
  return (
    <div className="d-inventory">
      {pairs.map((pair) => {
        const baseRaw = inventory[pair.base.symbol];
        const quoteRaw = inventory[pair.quote.symbol];
        if (baseRaw === undefined || quoteRaw === undefined || pair.mid === null) return null;
        const base = Number(formatUnits(BigInt(baseRaw), pair.base.decimals));
        const quote = Number(formatUnits(BigInt(quoteRaw), pair.quote.decimals));
        const value = base * pair.mid;
        // USDT backs both pairs, so each is measured against its share, as the engine does.
        const share = value / (value + quote / pairs.length || 1);
        return (
          <div key={pair.pair}>
            <p>
              {pair.base.symbol} <b>{(share * 100).toFixed(1)}%</b>
            </p>
            <div
              className="d-balance"
              role="img"
              aria-label={`${pair.base.symbol} is ${(share * 100).toFixed(1)} percent of its side, target 50.`}
            >
              <span style={{ width: `${share * 100}%` }} />
              <i aria-hidden />
            </div>
            <small>
              {formatToken(base)} {pair.base.symbol}, worth {formatUsd(value)}
            </small>
          </div>
        );
      })}
    </div>
  );
}

function Missions() {
  const missions = useMissions();
  const swaps = missions.filter((mission) => mission.plan).slice(0, 5);
  if (swaps.length === 0)
    return (
      <div className="d-empty">
        <p>No missions this session.</p>
        <button type="button" data-cursor="hover" onClick={() => queueAndGo("Buy 500 USDT of HSK")}>
          Try “Buy 500 USDT of HSK”
          <ArrowUpRight size={13} aria-hidden />
        </button>
      </div>
    );
  return (
    <ol className="d-missions">
      {swaps.map((mission) => {
        const totals = missionTotals(mission);
        return (
          <li key={mission.id}>
            <Link href="/agent" data-cursor="hover">
              <span className="d-mission-text">{mission.text}</span>
              <small>
                {totals.filled > 0 && mission.plan
                  ? `${formatToken(totals.received)} ${mission.plan.boughtSymbol}`
                  : STATUS_LABEL[mission.status]}
              </small>
            </Link>
            {isActive(mission.status) && (
              <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-[#5b4fd1]" />
            )}
            {isStoppable(mission.status) && (
              <button type="button" data-cursor="hover" onClick={() => agent.stop(mission.id)}>
                Stop
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Tape({ fills }: { fills: Fill[] }) {
  const [flow, setFlow] = useState<FlowName | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const fill of fills) result[fill.flow] = (result[fill.flow] ?? 0) + 1;
    return result;
  }, [fills]);
  const rows = fills.filter((fill) => flow === "all" || fill.flow === flow).slice(0, 12);
  return (
    <section className="d-card d-span-5" aria-labelledby="tape-title">
      <header className="d-card-head">
        <div>
          <h2 id="tape-title">Fill tape</h2>
          <p>Every paper fill, by who it came from</p>
        </div>
      </header>
      <fieldset className="d-filter" aria-label="Filter by flow">
        <button
          type="button"
          aria-pressed={flow === "all"}
          data-cursor="hover"
          onClick={() => setFlow("all")}
        >
          All <b>{fills.length}</b>
        </button>
        {FLOWS.map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={flow === item}
            disabled={!counts[item]}
            data-cursor="hover"
            onClick={() => setFlow(item)}
          >
            {FLOW_LABEL[item]} <b>{counts[item] ?? 0}</b>
          </button>
        ))}
      </fieldset>
      {rows.length === 0 ? (
        <p className="d-empty-line">No fills here yet.</p>
      ) : (
        <ol className="d-tape">
          {rows.map((fill) => {
            const five = fill.markouts?.["5"];
            const expanded = open === fill.id;
            return (
              <li key={fill.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  data-cursor="hover"
                  onClick={() => setOpen(expanded ? null : fill.id)}
                >
                  <i style={{ background: FLOW_COLOR[fill.flow] }} aria-hidden />
                  <span>{FLOW_LABEL[fill.flow]}</span>
                  <span>
                    {fill.side === "buy" ? "Buy" : "Sell"} {fill.pair.split("/")[0]}
                  </span>
                  <b>{formatPrice(fill.price)}</b>
                  <time>{clock(fill.ts)}</time>
                </button>
                {expanded && (
                  <dl>
                    <div>
                      <dt>Taker</dt>
                      <dd>{shortAddress(fill.taker)}</dd>
                    </div>
                    <div>
                      <dt>Mid at fill</dt>
                      <dd>
                        {fill.midAtFill === null
                          ? "Unavailable during feed outage"
                          : formatPrice(fill.midAtFill)}
                      </dd>
                    </div>
                    <div>
                      <dt>5 s markout</dt>
                      <dd>{five === undefined ? "Measuring" : `${formatNumber(five, 1)} bps`}</dd>
                    </div>
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Takers({ takers: all }: { takers: TakerRow[] }) {
  // Quoting alone creates a taker row. The ones worth watching are those who have actually filled.
  const takers = all
    .filter((taker) => taker.fills > 0)
    .sort((a, b) => b.score - a.score || b.fills - a.fills);
  return (
    <section className="d-card d-span-3" aria-labelledby="takers-title">
      <header className="d-card-head">
        <div>
          <h2 id="takers-title">Takers</h2>
          <p>Filled takers, scored on behaviour only</p>
        </div>
        <Link href="/arena" className="d-link" data-cursor="hover">
          All <ArrowUpRight size={13} aria-hidden />
        </Link>
      </header>
      {takers.length === 0 ? (
        <p className="d-empty-line">Nobody has filled yet.</p>
      ) : (
        <ol className="d-takers">
          {takers.slice(0, 7).map((taker) => (
            <li key={taker.address}>
              <span>
                {taker.label ?? shortAddress(taker.address)}
                <small>{plural(taker.fills, "fill")}</small>
              </span>
              <span className={`p-pill p-tier p-tier-${taker.tier}`}>{taker.tier}</span>
              <meter
                min={0}
                max={1}
                value={taker.score}
                aria-label={`Toxicity score ${taker.score.toFixed(2)}`}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function OverviewPage() {
  useAgentFeed();
  const router = useRouter();
  navigate = router.push;
  const status = useEngineStatus();
  const streaming = useEngineStream();
  const market = useAgentMarket();
  const [view, setView] = useState<View>("equity");
  const [pairName, setPairName] = useState<PairStatus["pair"]>("HSK/USDT");
  const enabled = Boolean(zethos);
  const arena = useQuery({
    queryKey: ["engine", "arena"],
    enabled,
    retry: false,
    refetchInterval: 15_000,
    queryFn: () => (zethos as NonNullable<typeof zethos>).arena(),
  });
  const takers = useQuery({
    queryKey: ["engine", "arenaTakers"],
    enabled,
    retry: false,
    refetchInterval: 15_000,
    queryFn: () => (zethos as NonNullable<typeof zethos>).arenaTakers({ limit: 20 }),
  });
  const fills = useQuery({
    queryKey: ["engine", "fills", "overview"],
    enabled,
    retry: false,
    refetchInterval: 15_000,
    queryFn: () => (zethos as NonNullable<typeof zethos>).fills({ limit: 60 }),
  });
  const decisions = useQuery({
    queryKey: ["engine", "decisions", "overview"],
    enabled,
    retry: false,
    refetchInterval: 15_000,
    queryFn: () => (zethos as NonNullable<typeof zethos>).decisions({ limit: 8 }),
  });
  const data = arena.data;
  const pairs = status.data?.pairs ?? [];
  const pair = pairs.find((row) => row.pair === pairName) ?? null;
  const equitySeries = useMemo(
    () => data?.series.slice(-80).map((point) => point.equity) ?? [],
    [data?.series],
  );
  const pnlSeries = useMemo(() => {
    const first = data?.series[0]?.equity ?? 0;
    return equitySeries.map((value) => value - first);
  }, [equitySeries, data?.series]);
  const failure = arena.error ?? takers.error ?? fills.error ?? decisions.error;
  return (
    <div className="d-overview">
      <Hero arena={data} status={status} />

      {!zethos && (
        <p className="d-alert" role="alert">
          No engine is configured, so there is nothing live to show. Set NEXT_PUBLIC_ENGINE_URL.
        </p>
      )}
      {failure && (
        <p className="d-alert" role="alert">
          {failureMessage(failure)} Figures below may be out of date.
          <button
            type="button"
            onClick={() => {
              void arena.refetch();
              void takers.refetch();
              void fills.refetch();
              void decisions.refetch();
            }}
          >
            Retry <RefreshCw size={13} aria-hidden />
          </button>
        </p>
      )}

      <div className="d-tiles">
        <Tile
          index={0}
          label="Paper equity"
          value={data ? <Rolling value={data.equityUsd} format={formatUsd} /> : "—"}
          note={
            data ? `Epoch ${data.epoch}, from ${clock(data.startedAt)}` : "Awaiting first valuation"
          }
          spark={equitySeries}
          selected={view === "equity"}
          onSelect={() => setView("equity")}
        />
        <Tile
          index={1}
          label="Paper P&L"
          value={data ? <Rolling value={data.pnl.total} format={signedUsd} /> : "—"}
          note={
            data
              ? `Spread ${signedUsd(data.pnl.spread)}, inventory ${signedUsd(data.pnl.inventory)}`
              : "Not revenue"
          }
          spark={pnlSeries}
          selected={view === "pnl"}
          onSelect={() => setView("pnl")}
        />
        <Tile
          index={2}
          label="Paper volume"
          value={data ? <Rolling value={data.volumeUsd} format={formatUsd} /> : "—"}
          note={
            data
              ? `${plural(data.fills, "fill")} from ${plural(data.takers, "taker")}`
              : "No fills yet"
          }
          spark={[]}
          selected={view === "flow"}
          onSelect={() => setView("flow")}
        />
        <Tile
          index={3}
          label="Tape capture"
          value={
            data?.tapeCaptureRate == null ? "—" : `${formatNumber(data.tapeCaptureRate * 100, 1)}%`
          }
          note="Exchange trades Zethos would have won"
          spark={[]}
        />
      </div>

      <div className="d-grid">
        {data ? (
          <PerformanceChart arena={data} view={view} onView={setView} />
        ) : (
          <section className="d-card d-span-8 d-chart-card">
            <p className="d-empty-line">
              {arena.isError ? "Performance is unavailable." : "Opening the paper book."}
            </p>
          </section>
        )}

        <section className="d-card d-span-4 d-markets" aria-label="Markets">
          {pairs.length === 0 ? (
            <p className="d-empty-line">
              {status.isError ? "Market data is unavailable." : "Reading exchange books."}
            </p>
          ) : (
            pairs.map((row) => (
              <MarketCard
                key={row.pair}
                pair={row}
                selected={row.pair === pairName}
                onSelect={() => setPairName(row.pair)}
                history={market.history[row.pair]?.slice(-90).map((point) => point.mid) ?? []}
              />
            ))
          )}
        </section>

        <section className="d-card d-span-8" aria-labelledby="fusion-title">
          <header className="d-card-head">
            <div>
              <h2 id="fusion-title">Price fusion · {pairName}</h2>
              <p>Each exchange against the fused price, last 3 minutes. Hover to read it.</p>
            </div>
            <span className="d-live">
              <StatusDot tone={streaming ? "success" : "warning"} />
              {streaming ? "Live" : "Reconnecting"}
            </span>
          </header>
          <SignalField
            venues={market.venues[pairName] ?? {}}
            fills={market.tape.filter((fill) => fill.pair === pairName)}
            order={pair?.sources.map((source) => source.venue) ?? []}
          />
        </section>

        <div className="d-span-4 d-stack">
          <section className="d-card" aria-labelledby="missions-title">
            <header className="d-card-head">
              <div>
                <h2 id="missions-title">Missions</h2>
              </div>
              <Link href="/agent" className="d-link" data-cursor="hover">
                Agent <ArrowUpRight size={13} aria-hidden />
              </Link>
            </header>
            <Missions />
          </section>
          <section className="d-card" aria-labelledby="vault-title">
            <header className="d-card-head">
              <div>
                <h2 id="vault-title">Vault balance</h2>
                <p>Marker is the 50% target</p>
              </div>
            </header>
            {status.data ? (
              <Inventory pairs={pairs} inventory={status.data.inventory} />
            ) : (
              <p className="d-empty-line">Awaiting status.</p>
            )}
          </section>
        </div>

        <Tape fills={fills.data ?? []} />

        <section className="d-card d-span-4" aria-labelledby="journal-title">
          <header className="d-card-head">
            <div>
              <h2 id="journal-title">
                <ShieldCheck size={15} aria-hidden /> Decision journal
              </h2>
              <p>Written by code, with the numbers behind it</p>
            </div>
          </header>
          {decisions.data?.length ? (
            <ol className="d-journal">
              {decisions.data.map((decision) => (
                <li key={decision.id}>
                  <details>
                    <summary data-cursor="hover">
                      <span>{decision.type.replaceAll("_", " ")}</span>
                      <time>{clock(decision.ts)}</time>
                    </summary>
                    <p>{decision.reason}</p>
                    {decision.narration && <p className="d-narration">{decision.narration}</p>}
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p className="d-empty-line">No autonomous decisions yet this epoch.</p>
          )}
        </section>

        <Takers takers={takers.data ?? []} />
      </div>
    </div>
  );
}
