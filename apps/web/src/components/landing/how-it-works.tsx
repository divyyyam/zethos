"use client";

import {
  type MotionStyle,
  type MotionValue,
  motion,
  useMotionValueEvent,
  useTransform,
} from "motion/react";
import { useRef, useState } from "react";
import { landing } from "../../content/landing";
import type { Scenery } from "../../lib/scenery";
import { DriftingCloud } from "./drifting-cloud";
import { SectionHeader } from "./primitives";
import { RANGES, useScrollRange, useScrollTo } from "./scroll";
import { ui } from "./ui";

const NUMERAL_COLORS = ["text-iris", "text-periwinkle", "text-wisteria"] as const;

function Step({ index, position }: { index: number; position: MotionValue<number> }) {
  const step = landing.howItWorks.steps[index];
  const opacity = useTransform(
    position,
    [index - 0.32, index - 0.1, index + 0.1, index + 0.32],
    [0, 1, 1, 0],
  );
  const rise = useTransform(opacity, [0, 1], ["16px", "0px"]);
  if (!step) return null;
  return (
    <li className="flex flex-col gap-7 border-t border-hairline px-6 py-12 first:border-0 first:pt-0 last:pb-0 pin-wide:w-[var(--step)] pin-wide:shrink-0 pin-wide:flex-row pin-wide:items-end pin-wide:gap-6 pin-wide:border-0 pin-wide:p-0 lg:pin-wide:gap-8">
      <span
        aria-hidden
        className={`block font-display text-[160px] font-medium leading-[0.78] tracking-[-0.06em] pin-wide:text-[min(42vh,30vw)] ${NUMERAL_COLORS[index]}`}
      >
        {index + 1}
      </span>
      <motion.div
        style={{ "--step-alpha": opacity, "--step-rise": rise } as MotionStyle}
        className="max-w-[420px] bg-canvas/80 pin-wide:w-[clamp(210px,22vw,300px)] pin-wide:shrink-0 pin-wide:translate-y-[var(--step-rise)] pin-wide:bg-transparent pin-wide:pb-[0.6vh] pin-wide:opacity-[var(--step-alpha)]"
      >
        <h3 className="font-display text-2xl font-medium leading-tight tracking-[-0.015em] text-ink pin-wide:text-[28px]">
          {step.title}
        </h3>
        <p className={`mt-2 ${ui.lead}`}>{step.body}</p>
      </motion.div>
    </li>
  );
}

/** One semantic layout: CSS chooses the pinned track or the static stack before first paint. */
export function HowItWorks({ scenery }: { scenery: Scenery }) {
  const { howItWorks } = landing;
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const progress = useScrollRange(ref, RANGES.pin);
  const scrollTo = useScrollTo();
  const position = useTransform(progress, [0, 0.15, 0.42, 0.58, 0.85, 1], [0, 0, 1, 1, 2, 2]);
  const x = useTransform(position, (u) => `calc(32vw - ${u} * var(--step))`);
  useMotionValueEvent(progress, "change", (value) => {
    setActive(value < 0.285 ? 0 : value < 0.715 ? 1 : 2);
  });
  return (
    <section
      ref={ref}
      id={howItWorks.id}
      aria-labelledby="how-it-works-title"
      className="relative scroll-mt-20 bg-canvas py-24 [--step:48vw] pin-wide:h-[400vh] pin-wide:scroll-mt-0 pin-wide:py-0 lg:[--step:44vw] xl:[--step:40vw]"
    >
      <div className="relative overflow-hidden pin-wide:sticky pin-wide:top-0 pin-wide:flex pin-wide:h-[100svh] pin-wide:min-h-[600px] pin-wide:flex-col">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {["left-[16%]", "left-1/2", "left-[84%]"].map((pos) => (
            <div key={pos} className={`absolute inset-y-0 w-px bg-hairline ${pos}`} />
          ))}
        </div>
        <DriftingCloud
          src={scenery.cloud3}
          tone="peach"
          className="-right-20 top-60 h-32 w-72 opacity-60 pin-wide:top-[35%] pin-wide:left-[2%] pin-wide:h-[140px] pin-wide:w-[340px]"
          duration={86}
          distance={160}
        />
        <div className="relative px-6 pin-wide:pt-[13vh]">
          <SectionHeader
            id="how-it-works-title"
            pill={howItWorks.pill}
            title={howItWorks.headline}
          />
        </div>
        <div className="relative pin-wide:flex pin-wide:flex-1 pin-wide:items-center pin-wide:py-[5vh]">
          <motion.ol
            style={{ "--track-x": x } as MotionStyle}
            className="mx-auto mt-16 flex max-w-[720px] flex-col pin-wide:mx-0 pin-wide:mt-0 pin-wide:max-w-none pin-wide:translate-x-[var(--track-x)] pin-wide:flex-row"
          >
            {howItWorks.steps.map((step, index) => (
              <Step key={step.title} index={index} position={position} />
            ))}
          </motion.ol>
        </div>
        <div className="relative hidden flex-col items-center gap-4 pb-[7vh] pin-wide:flex">
          <p className="font-body text-[11px] tracking-[0.1em] text-ink-muted uppercase">
            {howItWorks.progressLabel}
          </p>
          <div className="flex items-center gap-4">
            {howItWorks.steps.map((step, i) => (
              <button
                key={step.title}
                type="button"
                aria-label={`${howItWorks.stepLabel} ${i + 1}: ${step.title}`}
                aria-current={active === i ? "step" : undefined}
                onClick={() => {
                  const section = ref.current;
                  if (!section) return;
                  const start = section.getBoundingClientRect().top + window.scrollY;
                  scrollTo(start + (section.offsetHeight - window.innerHeight) * (i / 2));
                }}
                className={`group flex min-h-11 items-center gap-2 rounded-full px-2 font-body text-xs transition-colors ${active === i ? "text-iris" : "text-ink-muted"}`}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <span
                  aria-hidden
                  className={`h-px w-10 transition-colors group-hover:bg-iris ${active === i ? "bg-iris" : "bg-hairline"}`}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
