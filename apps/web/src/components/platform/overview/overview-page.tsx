"use client";

import { useQuery } from "@tanstack/react-query";
import type { PairStatus } from "@zethos/sdk";
import { ArrowUpRight, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAgentFeed, useAgentMarket } from "../../../hooks/platform/use-agent";
import { useEngineStatus, useEngineStream } from "../../../hooks/platform/use-platform";
import { failureMessage, zethos } from "../../../lib/engine/sdk";
import { formatNumber, formatUsd } from "../../../lib/platform-config";
import { SignalField } from "../agent/signal-field";
import { StatusDot } from "../primitives";
import { Hero } from "./hero";
import { Inventory } from "./inventory";
import { MarketCard } from "./market-card";
import { Missions } from "./missions";
import { clock, plural, setNavigate, signedUsd, type View } from "./model";
import { PerformanceChart } from "./performance-chart";
import { Rolling } from "./rolling";
import { Takers } from "./takers";
import { Tape } from "./tape";
import { Tile } from "./tile";

export function OverviewPage() {
  useAgentFeed();
  const router = useRouter();
  setNavigate(router.push);
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
