"use client";
import type { Arena } from "@zethos/sdk";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { queueIntent } from "../../../hooks/platform/use-agent";
import type { useEngineStatus } from "../../../hooks/platform/use-platform";
import { formatUsd } from "../../../lib/platform-config";
import { WorldCanvas, type WorldState } from "../../world/world-canvas";
import { CommandBar } from "../agent/command-bar";
import { dayFromClock, greeting, plural, signedUsd } from "./model";
import { Rolling } from "./rolling";

export function Hero({
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
  const live = data?.mode === "live";
  const equity = live ? data.equityUsd : (arena?.equityUsd ?? null);
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
          <span>{live ? "Vault equity" : data?.mode === "shadow" ? "Paper equity" : "Equity"}</span>
          <strong className="num">
            {equity === null ? "—" : <Rolling value={equity} format={formatUsd} />}
          </strong>
          {live && <small>On-chain inventory valued at exchange mids</small>}
          {!live && arena && (
            <small>
              {signedUsd(arena.pnl.total)} this epoch · {plural(arena.fills, "fill")}
            </small>
          )}
        </div>
      </div>
    </section>
  );
}
