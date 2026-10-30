"use client";

import { useQuery } from "@tanstack/react-query";
import type { Decision, Fill, PairStatus } from "@zethos/sdk";
import { Bell, ChevronDown, Menu, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEngineStatus, useEngineStream } from "../../../hooks/platform/use-platform";
import { formatPrice } from "../../../lib/agent/runtime";
import { zethos } from "../../../lib/engine/sdk";
import { platformConfig, shortAddress } from "../../../lib/platform-config";
import { ConnectWalletButton, useWallet } from "../../wallet/wallet-provider";
import { StatusDot } from "../primitives";
import { NAV_ITEMS } from "./nav";

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/** One pair in the topbar: flashes on every move, opens its book on hover. */
function TickerChip({ pair }: { pair: PairStatus }) {
  const [points, setPoints] = useState<number[]>([]);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);
  const previous = useRef<number | null>(null);
  const { mid, halfSpread } = pair;
  useEffect(() => {
    if (mid === null) return;
    if (previous.current !== null && previous.current !== mid) {
      setDirection(mid > previous.current ? "up" : "down");
      const timer = setTimeout(() => setDirection(null), 700);
      previous.current = mid;
      setPoints((current) => [...current, mid].slice(-32));
      return () => clearTimeout(timer);
    }
    previous.current = mid;
    setPoints((current) => (current.length ? current : [mid]));
  }, [mid]);
  const line = useMemo(() => {
    if (points.length < 2) return "";
    const low = Math.min(...points);
    const range = Math.max(...points) - low || 1;
    return points
      .map((value, index) => {
        const x = (index / (points.length - 1)) * 44;
        return `${x.toFixed(1)},${(16 - ((value - low) / range) * 14).toFixed(1)}`;
      })
      .join(" ");
  }, [points]);
  const healthy = pair.sources.filter((source) => source.status === "ok").length;
  return (
    <Link href="/stats" className="d-ticker" data-move={direction ?? undefined} data-cursor="hover">
      <span className="d-ticker-pair">{pair.pair.split("/")[0]}</span>
      <span className="d-ticker-mid">{mid === null ? "Halted" : formatPrice(mid)}</span>
      <svg viewBox="0 0 44 18" className="d-ticker-spark" aria-hidden>
        {line && <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" />}
      </svg>
      <span className="d-hovercard" role="tooltip">
        <strong>{pair.pair}</strong>
        {mid !== null && halfSpread && (
          <>
            <span>
              Bid <b>{formatPrice(mid * (1 - halfSpread.sell))}</b>
            </span>
            <span>
              Ask <b>{formatPrice(mid * (1 + halfSpread.buy))}</b>
            </span>
            <span>
              Spread <b>{((halfSpread.buy + halfSpread.sell) * 10_000).toFixed(1)} bps</b>
            </span>
          </>
        )}
        <span>
          Sources{" "}
          <b>
            {healthy} of {pair.sources.length} healthy
          </b>
        </span>
      </span>
    </Link>
  );
}

function HealthMenu() {
  const status = useEngineStatus();
  const streaming = useEngineStream();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const data = status.data;
  const label = !platformConfig.engineUrl
    ? "No engine"
    : status.isError
      ? "Offline"
      : !data
        ? "Connecting"
        : data.paused
          ? "Paused"
          : streaming
            ? "Live"
            : "Polling";
  const tone = status.isError || data?.paused ? "warning" : data ? "success" : "neutral";
  return (
    <div className="d-menu" ref={ref}>
      <button
        type="button"
        className="d-chip"
        aria-expanded={open}
        data-cursor="hover"
        onClick={() => setOpen(!open)}
      >
        <StatusDot tone={tone} />
        {label}
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <div className="d-popover d-popover-health" role="dialog" aria-label="Engine health">
          <h3>Engine health</h3>
          {status.isError && <p className="d-popover-note">The engine isn’t responding.</p>}
          {!platformConfig.engineUrl && (
            <p className="d-popover-note">Set NEXT_PUBLIC_ENGINE_URL to connect one.</p>
          )}
          {data && (
            <>
              <dl className="d-kv">
                <div>
                  <dt>Mode</dt>
                  <dd>{data.mode === "shadow" ? "Shadow, paper settlement" : "Live"}</dd>
                </div>
                <div>
                  <dt>Risk state</dt>
                  <dd>{data.riskState}</dd>
                </div>
                <div>
                  <dt>Stream</dt>
                  <dd>{streaming ? "Connected" : "Reconnecting"}</dd>
                </div>
                <div>
                  <dt>Quote signer</dt>
                  <dd>{shortAddress(data.signer)}</dd>
                </div>
              </dl>
              {data.pairs.map((pair) => (
                <div key={pair.pair} className="d-health-pair">
                  <p>
                    {pair.pair} <span>{pair.health}</span>
                  </p>
                  {pair.sources.map((source) => (
                    <span key={source.venue} className="d-health-venue">
                      <StatusDot tone={source.status === "ok" ? "success" : "warning"} />
                      {source.venue}
                      <b>
                        {source.status === "ok"
                          ? `${Math.round(source.weight * 100)}%`
                          : source.status}
                      </b>
                    </span>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

type FeedItem =
  | { kind: "fill"; id: string; ts: number; fill: Fill }
  | { kind: "decision"; id: string; ts: number; decision: Decision };

const FLOW: Record<Fill["flow"], string> = {
  tape: "Tape",
  user: "User",
  agent: "Agent",
  attacker: "Attacker",
};

function ActivityMenu() {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<FeedItem[]>([]);
  const [seenAt, setSeenAt] = useState(() => Date.now());
  const ref = useDismiss(open, () => setOpen(false));
  // Seeded once, then fed by the stream, so an idle bell costs the engine no requests.
  const seed = useQuery({
    queryKey: ["engine-feed-seed"],
    enabled: Boolean(zethos),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      if (!zethos) return [];
      const [fills, decisions] = await Promise.all([
        zethos.fills({ limit: 15 }),
        zethos.decisions({ limit: 15 }),
      ]);
      return [
        ...fills.map((fill): FeedItem => ({ kind: "fill", id: fill.id, ts: fill.ts, fill })),
        ...decisions.map(
          (decision): FeedItem => ({
            kind: "decision",
            id: decision.id,
            ts: decision.ts,
            decision,
          }),
        ),
      ];
    },
  });
  useEffect(() => {
    if (!zethos) return;
    return zethos.stream({
      fill: ({ fill }) =>
        setLive((items) =>
          [{ kind: "fill" as const, id: fill.id, ts: fill.ts, fill }, ...items].slice(0, 40),
        ),
      decision: ({ decision }) =>
        setLive((items) =>
          [
            { kind: "decision" as const, id: decision.id, ts: decision.ts, decision },
            ...items.filter((item) => item.id !== decision.id),
          ].slice(0, 40),
        ),
    });
  }, []);
  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...live, ...(seed.data ?? [])]
      .filter((item) => (seen.has(item.id) ? false : Boolean(seen.add(item.id))))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 30);
  }, [live, seed.data]);
  const unread = items.filter((item) => item.ts > seenAt).length;
  return (
    <div className="d-menu" ref={ref}>
      <button
        type="button"
        className="d-icon d-icon-bordered"
        aria-label={unread ? `Activity, ${unread} new` : "Activity"}
        aria-expanded={open}
        data-cursor="hover"
        onClick={() => {
          setOpen(!open);
          setSeenAt(Date.now());
        }}
      >
        <Bell size={16} aria-hidden />
        {unread > 0 && <span className="d-bell-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="d-popover d-popover-feed" role="dialog" aria-label="Activity">
          <h3>
            Activity <Link href="/arena">Open Arena</Link>
          </h3>
          {items.length === 0 ? (
            <p className="d-popover-note">No fills or decisions yet.</p>
          ) : (
            <ol>
              {items.map((item) => (
                <li key={item.id}>
                  <time>{new Date(item.ts).toLocaleTimeString("en-GB", { hour12: false })}</time>
                  {item.kind === "fill" ? (
                    <p>
                      <b>{FLOW[item.fill.flow]}</b> {item.fill.side === "buy" ? "bought" : "sold"}{" "}
                      {item.fill.pair.split("/")[0]} at {formatPrice(item.fill.price)}
                    </p>
                  ) : (
                    <p>
                      <b>{item.decision.type.replaceAll("_", " ")}</b> {item.decision.reason}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

export function Topbar({ onMenu, onPalette }: { onMenu: () => void; onPalette: () => void }) {
  const pathname = usePathname();
  const status = useEngineStatus();
  const { openNetwork } = useWallet();
  const page = NAV_ITEMS.find((item) => item.href === pathname);
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/mac/i.test(navigator.platform)), []);
  return (
    <header className="d-topbar">
      <button
        type="button"
        className="d-icon d-menu-button"
        aria-label="Open menu"
        onClick={onMenu}
      >
        <Menu size={18} aria-hidden />
      </button>
      <div className="d-title">
        <p className="d-title-main">{page?.label ?? "Zethos"}</p>
        {page && <p className="d-title-blurb">{page.blurb}</p>}
      </div>

      <div className="d-topbar-middle">
        <button type="button" className="d-search" data-cursor="hover" onClick={onPalette}>
          <Search size={15} aria-hidden />
          <span>Ask or jump to</span>
          <kbd>{mac ? "⌘" : "Ctrl"} K</kbd>
        </button>
        {status.data?.pairs.map((pair) => (
          <TickerChip key={pair.pair} pair={pair} />
        ))}
      </div>

      <div className="d-topbar-right">
        {status.data?.mode === "shadow" && <span className="d-paper">Paper</span>}
        <HealthMenu />
        <ActivityMenu />
        <button
          type="button"
          className="d-chip d-network"
          data-cursor="hover"
          onClick={openNetwork}
          aria-label={`Network: ${platformConfig.chain.name}`}
        >
          <span className="p-chain-mark" aria-hidden>
            H
          </span>
          <span className="d-network-name">
            {platformConfig.chain.testnet ? "Testnet" : "HashKey"}
          </span>
        </button>
        <ConnectWalletButton />
      </div>
    </header>
  );
}
