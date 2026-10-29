"use client";

import { ArrowDown, BadgeCheck, BookOpenCheck, Hourglass, ShieldCheck } from "lucide-react";
import { motion, useInView, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { landing } from "../../content/landing";
import { useReducedMotionPref } from "../../hooks/use-media-query";
import { Reveal, SectionHeader } from "./primitives";
import { useScrollRange } from "./scroll";
import { ui } from "./ui";

const CALLOUT_STYLES = [
  { Icon: BadgeCheck, tint: "bg-lavender" },
  { Icon: BookOpenCheck, tint: "bg-sky" },
  { Icon: Hourglass, tint: "bg-peach" },
  { Icon: ShieldCheck, tint: "bg-mint" },
] as const;

/** Seconds left on the mock quote: counts down while visible, then refreshes like a real quote. */
function useCountdown(total: number, active: boolean) {
  const [left, setLeft] = useState(total);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setLeft((s) => (s <= 1 ? total : s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [active, total]);
  return left;
}

function ExpiryRing({ left, total }: { left: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg aria-hidden viewBox="0 0 36 36" className="size-9 -rotate-90">
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--color-lilac)" strokeWidth="3.5" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="var(--color-iris)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - left / total)}
        className="transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
      />
    </svg>
  );
}

function Ticket() {
  const { ticket } = landing.quote;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduced = useReducedMotionPref();
  const left = useCountdown(ticket.expiresSeconds, inView && !reduced);

  return (
    <div
      ref={ref}
      className="relative w-full max-w-[400px] rounded-[24px] border border-hairline bg-canvas p-3 shadow-[0_40px_100px_-50px_rgb(47_42_92/0.45)]"
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-3">
        <span className="font-display text-lg font-medium tracking-[-0.02em] text-ink">
          {ticket.title}
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-mint px-2.5 py-1 font-body text-[11px] font-medium text-ink">
          <span aria-hidden className="size-1.5 rounded-full bg-[#2f9e6f]" />
          Live
        </span>
      </div>

      <div className="rounded-2xl bg-canvas-soft p-4">
        <p className="font-body text-xs text-ink-muted">{ticket.payLabel}</p>
        <p className="mt-1 flex items-baseline justify-between font-display text-[28px] font-medium tracking-[-0.03em] text-ink tabular-nums">
          {ticket.pay}
          <span className="font-body text-sm font-medium text-ink-muted">{ticket.payToken}</span>
        </p>
      </div>
      <div className="relative z-10 -my-3 flex justify-center">
        <span className="flex size-9 items-center justify-center rounded-full border-4 border-canvas bg-lilac text-iris">
          <ArrowDown aria-hidden className="size-4" />
        </span>
      </div>
      <div className="rounded-2xl bg-lavender p-4">
        <p className="font-body text-xs text-ink-muted">{ticket.receiveLabel}</p>
        <p className="mt-1 flex items-baseline justify-between font-display text-[28px] font-medium tracking-[-0.03em] text-ink tabular-nums">
          {ticket.receive}
          <span className="font-body text-sm font-medium text-ink-muted">
            {ticket.receiveToken}
          </span>
        </p>
      </div>

      <dl className="mt-2 px-3">
        {ticket.rows.map((row) => (
          <div
            key={row.label}
            className="flex justify-between gap-4 border-b border-hairline py-2.5"
          >
            <dt className="font-body text-[13px] text-ink-muted">{row.label}</dt>
            <dd className="font-body text-[13px] font-medium text-ink tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <ExpiryRing left={left} total={ticket.expiresSeconds} />
        <p className="font-body text-[13px] text-ink-muted">
          {ticket.expiresLabel} <span className="font-medium text-ink tabular-nums">{left}s</span>
        </p>
      </div>
    </div>
  );
}

function Callout({ index, align }: { index: number; align: "left" | "right" }) {
  const callout = landing.quote.callouts[index];
  const style = CALLOUT_STYLES[index];
  if (!callout || !style) return null;
  const { Icon, tint } = style;
  return (
    <Reveal
      index={index}
      className={`flex gap-4 lg:max-w-[300px] ${align === "left" ? "lg:ml-auto lg:flex-row-reverse lg:text-right" : ""}`}
    >
      <span className={`${ui.iconChip} ${tint}`}>
        <Icon aria-hidden className="size-5 text-iris-deep" />
      </span>
      <div>
        <h3 className={ui.itemTitle}>{callout.title}</h3>
        <p className={`mt-1 ${ui.body}`}>{callout.body}</p>
      </div>
    </Reveal>
  );
}

/** A mock quote ticket with callouts explaining what makes it trustworthy. */
export function QuoteAnatomy() {
  const { quote } = landing;
  const ref = useRef<HTMLElement>(null);
  // The ticket tips up into place as the section scrolls in.
  const progress = useScrollRange(ref, (m) => [m.top - m.vh * 0.9, m.top - m.vh * 0.1]);
  const rotateX = useTransform(progress, [0, 1], [18, 0]);
  const y = useTransform(progress, [0, 1], [80, 0]);
  const scale = useTransform(progress, [0, 1], [0.92, 1]);

  return (
    <section ref={ref} aria-labelledby="quote-title" className={`${ui.section} overflow-hidden`}>
      {/* Soft pastel wash behind the ticket. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-[640px] -translate-y-1/2 bg-[radial-gradient(40%_50%_at_50%_50%,var(--color-lilac),transparent_70%),radial-gradient(30%_40%_at_30%_60%,var(--color-peach),transparent_70%),radial-gradient(30%_40%_at_70%_40%,var(--color-sky),transparent_70%)] opacity-80"
      />
      <div className="relative">
        <SectionHeader id="quote-title" pill={quote.pill} title={quote.headline} />

        <div
          className={`${ui.container} ${ui.afterHeader} grid items-center gap-10 lg:grid-cols-[1fr_auto_1fr] lg:gap-14`}
        >
          <div className="order-2 grid gap-8 sm:grid-cols-2 lg:order-1 lg:grid-cols-1 lg:gap-16">
            <Callout index={0} align="left" />
            <Callout index={1} align="left" />
          </div>
          <div className="order-1 flex justify-center [perspective:1400px] lg:order-2">
            <motion.div
              className="flex w-full justify-center will-change-transform"
              style={{ rotateX, y, scale, transformOrigin: "50% 100%" }}
            >
              <Ticket />
            </motion.div>
          </div>
          <div className="order-3 grid gap-8 sm:grid-cols-2 lg:grid-cols-1 lg:gap-16">
            <Callout index={2} align="right" />
            <Callout index={3} align="right" />
          </div>
        </div>
      </div>
    </section>
  );
}
