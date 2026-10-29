"use client";

import { ArrowUpRight, Boxes, CodeXml, Gauge, Layers, ShieldCheck, Zap } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { landing } from "../../content/landing";
import { EASE, Reveal, SectionHeader } from "./primitives";
import { ui } from "./ui";

// Bento placement on a 4-column grid: one 2×2 lead tile, the rest fill three rows exactly.
const LAYOUT = [
  { tint: "bg-sky", span: "lg:col-span-2 lg:row-span-2", Icon: Layers },
  { tint: "bg-peach", span: "", Icon: Zap },
  { tint: "bg-mint", span: "", Icon: Boxes },
  { tint: "bg-butter", span: "lg:col-span-2", Icon: Gauge },
  { tint: "bg-rose", span: "lg:col-span-2", Icon: ShieldCheck },
  { tint: "bg-lavender", span: "lg:col-span-2", Icon: CodeXml },
] as const;

const ASKS = [0.42, 0.58, 0.36, 0.7, 0.5];
const BIDS = [0.62, 0.46, 0.8, 0.54, 0.38];

/** Decorative order-book ladder: asks above the mid, bids below, bars growing in on reveal. */
function BookVisual() {
  const bar = (w: number, i: number, tone: string) => (
    <motion.div
      key={`${tone}-${i}`}
      className={`h-3 origin-right rounded-full ${tone}`}
      style={{ width: `${w * 100}%` }}
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ duration: 0.9, ease: EASE, delay: 0.15 + i * 0.06 }}
    />
  );
  return (
    <div aria-hidden className="mt-8 flex flex-1 flex-col justify-end gap-2">
      <div className="flex flex-col items-end gap-1.5">
        {ASKS.map((w, i) => bar(w, i, "bg-[#f4b8c8]"))}
      </div>
      <div className="my-2 flex items-center gap-3">
        <span className="h-px flex-1 bg-ink/15" />
        <span className="rounded-full bg-canvas px-3 py-1 font-body text-[11px] font-medium text-ink tabular-nums">
          mid 0.5000
        </span>
        <span className="h-px flex-1 bg-ink/15" />
      </div>
      <div className="flex flex-col items-end gap-1.5">
        {BIDS.map((w, i) => bar(w, i + ASKS.length, "bg-[#9fd8bf]"))}
      </div>
    </div>
  );
}

function Tile({ index, children }: { index: number; children?: ReactNode }) {
  const item = landing.features.items[index];
  const layout = LAYOUT[index];
  if (!item || !layout) return null;
  const { Icon } = layout;
  return (
    <Reveal
      index={index}
      className={`group flex flex-col ${ui.card} ${ui.cardPad} transition-transform duration-500 ease-soft hover:-translate-y-1 motion-reduce:transform-none ${layout.tint} ${layout.span}`}
    >
      <span className={`${ui.iconChip} bg-canvas/70`}>
        <Icon aria-hidden className="size-5 text-iris-deep" />
      </span>
      {"stat" in item && (
        <p className="mt-6 font-display text-[64px] font-medium leading-none tracking-[-0.05em] text-iris-deep">
          {item.stat}
        </p>
      )}
      <h3 className={`mt-6 ${ui.cardTitle}`}>{item.title}</h3>
      <p className={`mt-2 max-w-[420px] ${ui.body}`}>{item.body}</p>
      {"link" in item && (
        <a
          href={item.link.href}
          className="mt-5 inline-flex items-center gap-1 self-start rounded-full bg-canvas px-4 py-2 font-body text-sm font-medium text-ink transition-colors hover:bg-canvas/70"
        >
          {item.link.label}
          <ArrowUpRight aria-hidden className="size-4" />
        </a>
      )}
      {children}
    </Reveal>
  );
}

export function Features() {
  const { features } = landing;
  return (
    <section aria-labelledby="features-title" className={`${ui.section} bg-canvas`}>
      <SectionHeader id="features-title" pill={features.pill} title={features.headline} />
      <div
        className={`${ui.container} ${ui.afterHeader} grid ${ui.gridGap} sm:grid-cols-2 lg:grid-cols-4`}
      >
        <Tile index={0}>
          <BookVisual />
        </Tile>
        {features.items.slice(1).map((item, i) => (
          <Tile key={item.title} index={i + 1} />
        ))}
      </div>
    </section>
  );
}
