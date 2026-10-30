"use client";

import { animate, useInView, useMotionValue, useMotionValueEvent } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { art } from "../../content/art";
import { landing, type StatFormat } from "../../content/landing";
import type { EngineStats } from "../../content/stats.mock";
import { useReducedMotionPref } from "../../hooks/use-media-query";
import { EASE, Reveal, ScrubText } from "./primitives";

function formatStat(value: number, format: StatFormat) {
  const scaled = format.thousands ? value / 1000 : value;
  const text = scaled.toLocaleString("en-US", {
    minimumFractionDigits: format.decimals,
    maximumFractionDigits: format.decimals,
  });
  return `${format.prefix ?? ""}${text}${format.suffix ?? ""}`;
}

function CountUp({ value, format }: { value: number; format: StatFormat }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduced = useReducedMotionPref();
  const motionValue = useMotionValue(0);
  const [shown, setShown] = useState(() => formatStat(value, format));
  useMotionValueEvent(motionValue, "change", (v) => setShown(formatStat(v, format)));
  useEffect(() => {
    if (reduced) return;
    if (!inView) {
      setShown(formatStat(0, format));
      return;
    }
    const controls = animate(motionValue, value, { duration: 2, ease: EASE });
    return () => controls.stop();
  }, [inView, reduced, value, format, motionValue]);
  return <span ref={ref}>{shown}</span>;
}

/** The argument, in one sentence, followed by the ledger. */
export function Proof({ stats }: { stats: EngineStats }) {
  const { proof, chapters } = landing;
  return (
    <section
      aria-label={chapters.proof}
      data-world="0.1,0,0,1|0.14,0,0,1"
      data-chapter={chapters.proof}
      className="relative sect bg-white pt-after-window pb-before-window"
    >
      <ScrubText
        text={proof.statement}
        className="display t-statement max-w-[85%] text-fg max-md:max-w-none"
      />

      <Reveal y={40} className="mt-head">
        <Image
          src={art.panorama.src}
          width={art.panorama.width}
          height={art.panorama.height}
          sizes="100vw"
          alt=""
          className="plate h-auto w-full"
        />
      </Reveal>

      <dl className="mt-block grid grid-cols-2 border-t border-line lg:grid-cols-4">
        {proof.cards.map((card, i) => (
          <Reveal
            key={card.key}
            index={i}
            className={`flex flex-col justify-between border-b border-line py-6 lg:border-b-0 ${i % 2 === 1 ? "pl-5" : "pr-5"} lg:px-6 ${i > 0 ? "lg:border-l" : "lg:pl-0"} ${i % 2 === 1 ? "max-lg:border-l" : ""}`}
          >
            <dt className="text-[15px] text-fg-soft">{card.label}</dt>
            <dd className="num mt-6 text-[max(2.75rem,calc(var(--cw)*0.054))] text-fg">
              <CountUp value={stats[card.key]} format={card.format} />
            </dd>
          </Reveal>
        ))}
      </dl>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-block gap-y-3 text-[15px]">
        <p className="text-fg-soft">{proof.note}</p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-fg-soft">{proof.integrationsLabel}</span>
          {proof.integrations.map((name) => (
            <span key={name} className="font-medium text-fg">
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
