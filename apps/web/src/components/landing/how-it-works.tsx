"use client";

import {
  type MotionValue,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
} from "motion/react";
import { useId, useRef, useState } from "react";
import { landing } from "../../content/landing";
import { useReducedMotionPref } from "../../hooks/use-media-query";
import { Rich } from "./primitives";
import { RANGES, useScrollRange, useScrollTo } from "./scroll";

const REVEAL_END = 0.26;
const stepStart = (i: number) => REVEAL_END + (i * (1 - REVEAL_END)) / 3;

/** Cross-fading block of copy that owns one slice of the pinned scroll. */
function Slide({
  progress,
  from,
  to,
  children,
  first = false,
  last = false,
}: {
  progress: MotionValue<number>;
  from: number;
  to: number;
  children: React.ReactNode;
  first?: boolean;
  last?: boolean;
}) {
  const reduced = useReducedMotionPref();
  const span = to - from;
  const fade = Math.min(0.05, span * 0.2);
  const opacity = useTransform(
    progress,
    [from, from + fade, to - fade, to],
    [first ? 1 : 0, 1, 1, last ? 1 : 0],
  );
  const y = useTransform(
    progress,
    [from, from + fade, to - fade, to],
    [first ? 0 : 44, 0, 0, last ? 0 : -44],
  );
  const visibility = useTransform(opacity, (o) => (o < 0.01 ? "hidden" : "visible"));
  // Without the pinned scrub there is nothing to cross-fade: every slide simply stacks.
  if (reduced) return <div className="mb-block last:mb-0">{children}</div>;
  return (
    <motion.div className="pin:absolute pin:inset-x-0 pin:top-0" style={{ opacity, y, visibility }}>
      {children}
    </motion.div>
  );
}

/** A price planted on the quote line: a card on a stem, with a live dot where it meets the line. */
function PriceFlag({
  side,
  label,
  value,
  delta,
  dark = false,
  progress,
}: {
  side: "left" | "right";
  label: string;
  value: string;
  delta?: string;
  dark?: boolean;
  /** Scroll-linked 0..1. Omitted flags simply follow the annotations' own fade. */
  progress?: MotionValue<number>;
}) {
  const left = side === "left";
  const fallback = useMotionValue(1);
  const opacity = progress ?? fallback;
  const y = useTransform(opacity, [0, 1], [14, 0]);
  return (
    <motion.div
      className={`absolute bottom-[17.5%] flex flex-col ${left ? "right-[calc(50%+clamp(10px,2vw,28px))] items-end" : "left-[calc(50%+clamp(10px,2vw,28px))] items-start"}`}
      style={{ opacity, y }}
    >
      <div
        className={`rounded-[14px] px-3 py-2 shadow-[0_16px_40px_-12px_rgb(13_11_43/0.55)] md:px-4 md:py-3 ${dark ? "bg-[#14113a] text-white" : "bg-white text-[#14113a]"}`}
      >
        <p
          className={`text-xs font-medium md:text-[13px] ${dark ? "text-white/75" : "text-[#14113a]/70"}`}
        >
          {label}
        </p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="num text-[clamp(1.375rem,2.3vw,2.125rem)]">{value}</span>
          {delta && (
            <span className="num-sm rounded-full bg-[#5b4fd1]/12 px-1.5 py-0.5 text-[11px] font-medium text-[#4a3fc0] md:text-xs">
              {delta}
            </span>
          )}
        </p>
      </div>
      <span
        className={`h-4 w-px md:h-6 ${dark ? "bg-[#14113a]" : "bg-white"} ${left ? "mr-4" : "ml-4"}`}
      />
      <span
        className={`-mb-1 size-2 rounded-full ring-2 ring-white/40 ${dark ? "bg-[#14113a]" : "bg-white"} ${left ? "mr-[13px]" : "ml-[13px]"}`}
      />
    </motion.div>
  );
}

/** Scalloped seal outline, like a notary's foil, drawn once at module load. */
const SEAL_PATH = (() => {
  const points = 72;
  const coords = Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * Math.PI * 2;
    const r = i % 2 ? 94 : 99;
    return `${(100 + Math.cos(angle) * r).toFixed(2)},${(100 + Math.sin(angle) * r).toFixed(2)}`;
  });
  return `M${coords.join(" L")} Z`;
})();

/** The fill's seal: scrolling presses it down onto the quote line, with a shock ring on contact. */
function SettledStamp({
  word,
  ring,
  progress,
}: {
  word: string;
  ring: string;
  progress: MotionValue<number>;
}) {
  const id = useId();
  const scale = useTransform(progress, [0, 1], [2.1, 1]);
  const rotate = useTransform(progress, [0, 1], [-26, -10]);
  const shock = useTransform(progress, [0.8, 1], [0.9, 1.6]);
  const shockOpacity = useTransform(progress, [0.8, 0.9, 1], [0, 0.8, 0.25]);
  return (
    <div className="absolute bottom-[calc(17.5%+clamp(84px,12svh,120px))] left-1/2 size-[clamp(96px,17svh,148px)] -translate-x-1/2">
      <motion.span
        className="absolute inset-0 rounded-full border-2 border-white"
        style={{ scale: shock, opacity: shockOpacity }}
      />
      <motion.svg
        viewBox="0 0 200 200"
        className="size-full drop-shadow-[0_14px_22px_rgb(13_11_43/0.5)]"
        style={{ scale, rotate, opacity: progress }}
      >
        <path
          d={SEAL_PATH}
          fill="#14113a"
          stroke="#14113a"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="100" cy="100" r="84" fill="none" stroke="#fff" strokeWidth="1.4" />
        <circle cx="100" cy="100" r="58" fill="none" stroke="#fff" strokeWidth="1.4" />
        <defs>
          <path id={id} d="M100,100 m-65,0 a65,65 0 1,1 130,0 a65,65 0 1,1 -130,0" />
        </defs>
        <text fill="#fff" fontSize="14.5" fontWeight="500" fontFamily="var(--font-ui)">
          <textPath href={`#${id}`} textLength="404" lengthAdjust="spacing">
            {ring}
          </textPath>
        </text>
        <path
          d="M90 72 l7 7 l14 -15"
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text
          x="100"
          y="118"
          fill="#fff"
          textAnchor="middle"
          fontFamily="var(--font-serif)"
          fontStyle="italic"
          fontWeight="300"
          fontSize="35"
          letterSpacing="-0.8"
        >
          {word}
        </text>
      </motion.svg>
    </div>
  );
}

/**
 * The page's signature move. The section pins while the world's near ridges collapse into a stepped
 * depth chart, then walks through the three stages of a fill with labels anchored to the chart.
 */
export function HowItWorks() {
  const { howItWorks, chapters } = landing;
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollRange(ref, RANGES.pin);
  const scrollTo = useScrollTo();
  const [active, setActive] = useState(-1);
  useMotionValueEvent(progress, "change", (p) => {
    let next = -1;
    for (let i = 0; i < 3; i++) if (p >= stepStart(i)) next = i;
    setActive(next);
  });

  const chrome = useTransform(progress, [0.14, 0.26], [0, 1]);
  const firm = useTransform(progress, [stepStart(1) + 0.02, stepStart(1) + 0.08], [0, 1]);
  const firmScale = useTransform(firm, [0, 1], [0, 1]);
  const settled = useTransform(progress, [stepStart(2) + 0.02, stepStart(2) + 0.08], [0, 1]);

  const jump = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const range = el.offsetHeight - window.innerHeight;
    scrollTo(el.getBoundingClientRect().top + window.scrollY + (stepStart(i) + 0.05) * range);
  };

  return (
    <section
      ref={ref}
      id={howItWorks.id}
      aria-label={chapters.how}
      data-world="0.2,0,0,1|0.34,0,1,1|0.4,0,1,1|0.45,0,1,1|0.5,0,1,1"
      data-world-pin
      data-chapter={chapters.how}
      className="relative pin:h-[480vh]"
    >
      <div className="relative flex flex-col sect overflow-clip pt-chrome pb-edge pin:sticky pin:top-0 pin:h-[100svh]">
        <div className="world-window flex-1">
          {/* Copy occupies the open sky above the valley. */}
          <div className="relative mx-auto max-w-[1100px] pt-block text-center">
            <div className="relative pin:h-[34svh] motion-reduce:h-auto motion-reduce:rounded-3xl motion-reduce:bg-[#fbfaff]/90 motion-reduce:p-8 motion-reduce:[--fg:#14113a] motion-reduce:[--fg-soft:rgb(20_17_58/0.84)]">
              <Slide progress={progress} from={0} to={REVEAL_END} first>
                <p className="eyebrow text-fg">{howItWorks.reveal.kicker}</p>
                <h2 className="display t-section mt-4 text-fg">
                  <Rich text={howItWorks.reveal.title} />
                </h2>
              </Slide>
              {howItWorks.steps.map((step, i) => (
                <Slide
                  key={step.title}
                  progress={progress}
                  from={stepStart(i)}
                  to={i === 2 ? 1 : stepStart(i + 1)}
                  last={i === 2}
                >
                  <p className="eyebrow text-fg">{i + 1} of 3</p>
                  <h3 className="display t-section mt-4 text-fg">{step.title}</h3>
                  <p className="lead mx-auto mt-6 max-w-[600px] text-fg">{step.body}</p>
                </Slide>
              ))}
            </div>
          </div>

          {/* Chart annotations, anchored to the shader's mid price at the bottom of the valley. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 hidden pin:block"
            style={{ opacity: chrome }}
          >
            <span className="absolute text-sm font-medium top-[60%] left-inset rounded-full bg-white px-3 py-1.5 text-[#14113a] ">
              {howItWorks.bids}
            </span>
            <span className="absolute text-sm font-medium top-[60%] right-inset rounded-full bg-white px-3 py-1.5 text-[#14113a] ">
              {howItWorks.asks}
            </span>
            <span className="absolute bottom-[16.5%] left-1/2 h-[30svh] w-px -translate-x-1/2 bg-[linear-gradient(to_top,var(--fg),transparent)]" />
            <PriceFlag side="left" label={howItWorks.mid.label} value={howItWorks.mid.value} dark />
            <motion.span
              className="absolute bottom-[17.5%] left-[27%] h-[2px] w-[46%] bg-white shadow-[0_0_24px_4px_rgb(255_255_255/0.7)]"
              style={{ opacity: firm, scaleX: firmScale }}
            />
            <PriceFlag
              side="right"
              label={howItWorks.firm.label}
              value={howItWorks.firm.value}
              delta={howItWorks.firm.delta}
              progress={firm}
            />
            <SettledStamp
              word={howItWorks.settled.word}
              ring={howItWorks.settled.ring}
              progress={settled}
            />
          </motion.div>

          <nav
            aria-label="Steps"
            className="absolute bottom-edge left-1/2 hidden -translate-x-1/2 items-center gap-5 rounded-full bg-[#14113a]/75 px-5 backdrop-blur-sm pin:flex "
          >
            {howItWorks.steps.map((step, i) => (
              <button
                key={step.title}
                type="button"
                aria-label={`${howItWorks.stepLabel} ${i + 1}`}
                aria-current={active === i ? "step" : undefined}
                data-cursor="hover"
                onClick={() => jump(i)}
                className="num-sm flex items-center gap-2 py-2 text-sm font-medium text-white"
              >
                {i + 1}
                <span
                  className={`block h-px bg-white transition-[width,opacity] duration-700 ease-expo ${active === i ? "w-14 opacity-100" : "w-5 opacity-40"}`}
                />
              </button>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}
