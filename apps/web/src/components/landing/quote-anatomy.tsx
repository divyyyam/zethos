"use client";

import { motion, useInView, useMotionValue, useSpring, useTransform } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { art } from "../../content/art";
import { landing } from "../../content/landing";
import { useFinePointerDesktop, useReducedMotionPref } from "../../hooks/use-media-query";
import { Reveal, RiseHeading } from "./primitives";
import { useScrollRange } from "./scroll";

const HEX = "0123456789abcdef";
const TILT = { stiffness: 140, damping: 18, mass: 0.6 };

function useCountdown(total: number, active: boolean) {
  const [left, setLeft] = useState(total);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setLeft((s) => (s <= 1 ? total : s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [active, total]);
  return left;
}

/** Hex that resolves character by character, like a signature being produced. */
function Signature({ value, run }: { value: string; run: boolean }) {
  const reduced = useReducedMotionPref();
  const [text, setText] = useState(value);
  useEffect(() => {
    if (!run || reduced) return;
    let frame = 0;
    const id = window.setInterval(() => {
      frame += 1;
      const settled = Math.floor(frame / 2);
      setText(
        [...value]
          .map((c, i) =>
            i < settled || i < 2 ? c : (HEX[Math.floor(Math.random() * 16)] as string),
          )
          .join(""),
      );
      if (settled >= value.length) window.clearInterval(id);
    }, 36);
    return () => window.clearInterval(id);
  }, [run, reduced, value]);
  return <>{text}</>;
}

function Ring({ left, total }: { left: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg aria-hidden viewBox="0 0 36 36" className="size-9 -rotate-90">
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="#14113a"
        strokeOpacity="0.14"
        strokeWidth="2"
      />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="#5b4fd1"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - left / total)}
        className="transition-[stroke-dashoffset] duration-1000 ease-linear"
      />
    </svg>
  );
}

/** A physical object: tilts toward the pointer, catches light across its foil, swings in on scroll. */
function Ticket() {
  const { ticket } = landing.quote;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const once = useInView(ref, { amount: 0.5, once: true });
  const reduced = useReducedMotionPref();
  const desktop = useFinePointerDesktop();
  const left = useCountdown(ticket.expiresSeconds, inView && !reduced);

  const scroll = useScrollRange(ref, (m) => [m.top - m.vh, m.top - m.vh * 0.18]);
  const swing = useTransform(scroll, [0, 1], [34, 0]);
  const lift = useTransform(scroll, [0, 1], [110, 0]);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rx = useSpring(useTransform(py, [-0.5, 0.5], [9, -9]), TILT);
  const ry = useSpring(useTransform(px, [-0.5, 0.5], [-13, 13]), TILT);
  const rotateX = useTransform([rx, swing], ([a, b]) => (a as number) + (b as number));
  const foilX = useTransform(px, [-0.5, 0.5], ["0%", "100%"]);
  const foilY = useTransform(py, [-0.5, 0.5], ["0%", "100%"]);

  return (
    <div className="[perspective:1400px]">
      <motion.div
        ref={ref}
        style={{ rotateX, rotateY: ry, y: lift }}
        className="relative w-[min(88vw,410px)] transform-gpu"
        data-cursor="hover"
        onPointerMove={(e) => {
          if (!desktop || reduced || e.pointerType !== "mouse") return;
          const r = e.currentTarget.getBoundingClientRect();
          px.set((e.clientX - r.left) / r.width - 0.5);
          py.set((e.clientY - r.top) / r.height - 0.5);
        }}
        onPointerLeave={() => {
          px.set(0);
          py.set(0);
        }}
      >
        <div className="ticket-stub relative overflow-hidden rounded-[22px] bg-[#fbfaff] text-[#14113a] shadow-[0_60px_120px_-30px_rgb(5_5_27/0.8)] [--stub-y:75.5%]">
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 mix-blend-multiply opacity-40"
            style={{
              backgroundImage:
                "linear-gradient(115deg, #ffd6c2 0%, #e4dcff 28%, #c8ecff 52%, #ffdcec 78%, #fff1c9 100%)",
              backgroundSize: "260% 260%",
              backgroundPositionX: foilX,
              backgroundPositionY: foilY,
            }}
          />
          <div className="relative p-6">
            <div className="flex items-center justify-between">
              <span className="t-title !text-[30px]">{ticket.title}</span>
              <span className="rounded-full border border-[#14113a]/25 px-2.5 py-1 text-[13px] font-medium">
                {ticket.badge}
              </span>
            </div>
            <div className="mt-6">
              <p className="text-sm text-[#14113a]/75">{ticket.payLabel}</p>
              <p className="mt-2 flex items-baseline justify-between num text-[40px]">
                {ticket.pay}
                <span className="font-sans text-sm tracking-normal">{ticket.payToken}</span>
              </p>
            </div>
            <div className="mt-6 border-t border-[#14113a]/15 pt-6">
              <p className="text-sm text-[#14113a]/75">{ticket.receiveLabel}</p>
              <p className="mt-2 flex items-baseline justify-between num text-[40px]">
                {ticket.receive}
                <span className="font-sans text-sm tracking-normal">{ticket.receiveToken}</span>
              </p>
            </div>
            <dl className="mt-6 space-y-2.5 border-t border-[#14113a]/15 pt-6">
              {ticket.rows.map((row) => (
                <div key={row.label} className="flex justify-between text-[14px]">
                  <dt className="text-[#14113a]/80">{row.label}</dt>
                  <dd className="num-sm font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div aria-hidden className="mx-6 border-t-2 border-dashed border-[#14113a]/20" />
          <div className="relative flex items-center justify-between gap-4 p-6 pt-6">
            <div className="min-w-0">
              <p className="text-sm text-[#14113a]/75">{ticket.signedLabel}</p>
              <p className="mt-2 truncate font-mono text-xs tabular-nums">
                <Signature value={ticket.signature} run={once} />
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Ring left={left} total={ticket.expiresSeconds} />
              <span className="num-sm text-sm font-medium">{left}s</span>
              <span className="sr-only">{ticket.expiresLabel}</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Callout({ index, title, body }: { index: number; title: string; body: string }) {
  return (
    <Reveal index={index} className="border-t border-line pt-6">
      <h3 className="t-title text-fg">{title}</h3>
      <p className="mt-3 text-fg-soft">{body}</p>
    </Reveal>
  );
}

export function QuoteAnatomy() {
  const { quote, chapters } = landing;
  const parts = quote.headline.split(" *");
  return (
    <section
      aria-label={chapters.quote}
      data-world="0.68,0.04,0,1|0.74,0.04,0,1"
      data-chapter={chapters.quote}
      className="relative sect overflow-clip pt-section "
    >
      <div className="relative z-10 grid gap-block pb-head lg:grid-cols-[minmax(0,1fr)_minmax(0,30%)]">
        <div>
          <Reveal>
            <p className="eyebrow text-fg-soft">{quote.kicker}</p>
          </Reveal>
          <RiseHeading
            lines={[parts[0] ?? "", `*${parts[1] ?? ""}`]}
            className="display t-section mt-4 text-fg"
          />
        </div>
        <Reveal y={40} className="relative hidden lg:block">
          <Image
            src={art.seal.src}
            fill
            sizes="30vw"
            alt=""
            className="plate object-contain object-right"
          />
        </Reveal>
      </div>
      <div className="world-window flex min-h-[100svh] items-center justify-center py-head">
        <Ticket />
      </div>
      <div className="relative z-10 mt-head grid gap-x-block gap-y-block md:grid-cols-2 xl:grid-cols-4">
        {quote.callouts.map((callout, i) => (
          <Callout key={callout.title} index={i} {...callout} />
        ))}
      </div>
    </section>
  );
}
