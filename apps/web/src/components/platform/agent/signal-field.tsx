"use client";

import type { Fill } from "@zethos/sdk";
import { useEffect, useRef, useState } from "react";

export type VenueTraces = Record<string, { t: number; bps: number }[]>;

const WINDOW_MS = 3 * 60_000;
const LABEL_GUTTER = 164;
const VENUE_COLORS = ["#5b4fd1", "#1f8a66", "#b86a1f", "#2b7cc4", "#c0497f"];
const FLOW_COLORS: Record<Fill["flow"], string> = {
  tape: "#55527a",
  user: "#b86a1f",
  agent: "#14113a",
  attacker: "#a43e4b",
};
const INK = "#14113a";
const MUTED = "#55527a";

function nearest(trace: { t: number; bps: number }[], t: number) {
  let best: { t: number; bps: number } | null = null;
  for (const point of trace) {
    if (!best || Math.abs(point.t - t) < Math.abs(best.t - t)) best = point;
  }
  return best && Math.abs(best.t - t) < 15_000 ? best : null;
}

/**
 * Every exchange's mid against the fused mid (the bright line at zero), in bps, flowing in real
 * time. Fills land on the line as they settle. Nothing here is decorative data: no samples, no
 * particles, only what the engine reported.
 */
export function SignalField({
  venues,
  fills,
  order,
}: {
  venues: VenueTraces;
  fills: Fill[];
  /** Every venue for the pair, so a venue keeps its colour when others drop out. */
  order: string[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ venues, fills, order });
  latest.current = { venues, fills, order };
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const colorOf = (venue: string) =>
    VENUE_COLORS[Math.max(0, order.indexOf(venue)) % VENUE_COLORS.length] ?? MUTED;

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let lastDraw = 0;
    const draw = (time: number) => {
      if (!still) frame = requestAnimationFrame(draw);
      if (time - lastDraw < 32) return;
      lastDraw = time;
      const ratio = window.devicePixelRatio || 1;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (element.width !== width * ratio || element.height !== height * ratio) {
        element.width = width * ratio;
        element.height = height * ratio;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const now = Date.now();
      const { venues, fills, order } = latest.current;
      const plotWidth = Math.max(40, width - LABEL_GUTTER);
      const xOf = (t: number) => plotWidth - ((now - t) / WINDOW_MS) * plotWidth;
      const entries = Object.entries(venues).filter(([, trace]) => trace.length > 0);
      const scale = Math.max(
        4,
        ...entries.flatMap(([, trace]) =>
          trace.filter((p) => now - p.t < WINDOW_MS).map((p) => Math.abs(p.bps)),
        ),
      );
      const mid = height / 2;
      const yOf = (bps: number) => mid - (bps / (scale * 1.25)) * (height / 2 - 10);

      context.font = `13px ${getComputedStyle(element).fontFamily}`;
      context.textBaseline = "middle";
      context.strokeStyle = "rgba(20,17,58,0.1)";
      context.fillStyle = MUTED;
      context.lineWidth = 1;
      for (const level of [scale, -scale]) {
        context.beginPath();
        context.moveTo(0, yOf(level));
        context.lineTo(plotWidth, yOf(level));
        context.stroke();
        context.fillText(`${level > 0 ? "+" : "−"}${scale.toFixed(1)} bps`, 8, yOf(level) - 9);
      }

      const ends: { venue: string; y: number; bps: number }[] = [];
      for (const [venue, trace] of entries) {
        const color =
          VENUE_COLORS[Math.max(0, order.indexOf(venue)) % VENUE_COLORS.length] ?? MUTED;
        context.beginPath();
        let started = false;
        for (const point of trace) {
          const x = xOf(point.t);
          if (x < -20) continue;
          if (started) context.lineTo(x, yOf(point.bps));
          else context.moveTo(x, yOf(point.bps));
          started = true;
        }
        const last = trace.at(-1);
        if (!last) continue;
        if (now - last.t < 15_000) {
          context.lineTo(plotWidth, yOf(last.bps));
          ends.push({ venue, y: yOf(last.bps), bps: last.bps });
        }
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.lineJoin = "round";
        context.stroke();
      }

      // The fused price: the line every venue is measured against.
      context.beginPath();
      context.moveTo(0, mid);
      context.lineTo(plotWidth, mid);
      context.strokeStyle = INK;
      context.lineWidth = 2;
      context.stroke();
      const pulse = still ? 0 : (Math.sin(time / 420) + 1) / 2;
      context.beginPath();
      context.arc(plotWidth, mid, 9 + pulse * 7, 0, Math.PI * 2);
      context.fillStyle = `rgba(20,17,58,${0.14 - pulse * 0.09})`;
      context.fill();
      context.beginPath();
      context.arc(plotWidth, mid, 4, 0, Math.PI * 2);
      context.fillStyle = INK;
      context.fill();

      for (const fill of fills) {
        const age = now - fill.ts;
        if (age > WINDOW_MS || age < -5_000) continue;
        const x = xOf(fill.ts);
        if (!still && age < 1_800) {
          context.beginPath();
          context.arc(x, mid, 5 + (age / 1_800) * 34, 0, Math.PI * 2);
          context.strokeStyle = `rgba(20,17,58,${0.5 * (1 - age / 1_800)})`;
          context.lineWidth = 1.5;
          context.stroke();
        }
        context.beginPath();
        context.arc(x, mid, 5, 0, Math.PI * 2);
        context.fillStyle = FLOW_COLORS[fill.flow];
        context.fill();
        context.strokeStyle = "#ffffff";
        context.lineWidth = 2;
        context.stroke();
      }

      // Direct labels at the line ends, pushed apart so close venues stay readable.
      ends.sort((a, b) => a.y - b.y);
      let previous = Number.NEGATIVE_INFINITY;
      for (const end of ends) {
        const y = Math.min(height - 8, Math.max(end.y, previous + 15));
        previous = y;
        context.fillStyle = INK;
        context.fillText(
          `${end.venue.replace("hashkey-global", "hashkey")} ${end.bps >= 0 ? "+" : "−"}${Math.abs(end.bps).toFixed(1)}`,
          plotWidth + 16,
          y,
        );
      }
      if (ends.length === 0) {
        context.fillStyle = MUTED;
        context.fillText("Reading exchange books…", 8, mid - 14);
      }
    };
    frame = requestAnimationFrame(draw);
    const redraw = still ? setInterval(() => draw(performance.now()), 3000) : null;
    return () => {
      cancelAnimationFrame(frame);
      if (redraw) clearInterval(redraw);
    };
  }, []);

  const readings = hover
    ? Object.entries(venues)
        .map(([venue, trace]) => ({ venue, point: nearest(trace, hover.t) }))
        .filter((row) => row.point)
    : [];
  return (
    <div
      className="a-field relative h-[max(220px,28svh)] touch-pan-y"
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const plotWidth = rect.width - LABEL_GUTTER;
        if (x > plotWidth) return setHover(null);
        setHover({ x, t: Date.now() - ((plotWidth - x) / plotWidth) * WINDOW_MS });
      }}
      onPointerLeave={() => setHover(null)}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Exchange prices against the fused mid. ${
          Object.entries(venues)
            .map(([venue, trace]) => {
              const last = trace.at(-1);
              return last ? `${venue} ${last.bps.toFixed(1)} bps` : null;
            })
            .filter(Boolean)
            .join(", ") || "Waiting for data."
        }`}
      />
      {hover && (
        <>
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-fg/30"
            style={{ left: hover.x }}
            aria-hidden
          />
          <div
            className="a-sheet pointer-events-none absolute top-2 z-10 grid min-w-[210px] gap-1 rounded-xl border border-line p-3 text-[13px] shadow-[0_20px_50px_-20px_rgb(5_5_27/0.4)]"
            style={{ left: hover.x, transform: `translateX(${hover.x > 240 ? "-108%" : "8%"})` }}
          >
            <strong>
              {new Date(hover.t).toLocaleTimeString("en-GB", {
                hour12: false,
              })}
            </strong>
            {readings.length === 0 && <span>No reading at this time</span>}
            {readings.map(({ venue, point }) => (
              <span key={venue} className="flex items-center gap-2 text-fg-soft">
                <i
                  className="size-2 rounded-full"
                  style={{ background: colorOf(venue) }}
                  aria-hidden
                />
                {venue}
                <b className="num-sm ml-auto font-normal text-fg">
                  {(point?.bps ?? 0) >= 0 ? "+" : "−"}
                  {Math.abs(point?.bps ?? 0).toFixed(1)} bps
                </b>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
