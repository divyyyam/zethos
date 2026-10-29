"use client";

import { motion, useTransform } from "motion/react";
import { useRef } from "react";
import { landing } from "../../content/landing";
import { SectionHeader } from "./primitives";
import { useScrollRange } from "./scroll";
import { ui } from "./ui";

type Side = (typeof landing.compare)["pool" | "zethos"];

function OutcomeCard({ side, featured }: { side: Side; featured: boolean }) {
  return (
    <div
      className={`relative flex h-full flex-col ${ui.card} ${ui.cardPad} ${
        featured
          ? "bg-lavender shadow-[0_30px_80px_-40px_rgb(91_79_209/0.55)]"
          : "border border-hairline bg-canvas-soft"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className={ui.cardTitle}>{side.name}</h3>
        <span
          aria-hidden
          className={`size-2.5 rounded-full ${featured ? "bg-iris" : "bg-ink-muted/40"}`}
        />
      </div>
      <dl className="mt-6 flex flex-1 flex-col divide-y divide-ink/10">
        {side.rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 py-3.5">
            <dt className={ui.body}>{row.label}</dt>
            <dd className="text-right font-body text-sm font-medium whitespace-nowrap text-ink tabular-nums md:text-[15px]">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className={`mt-6 ${ui.inset} px-5 py-4 ${featured ? "bg-canvas/70" : "bg-canvas"}`}>
        <p className="font-body text-xs font-medium uppercase tracking-[0.08em] text-ink-muted">
          {side.resultLabel}
        </p>
        <p
          className={`mt-1 font-display text-[clamp(2rem,3.4vw,2.75rem)] font-medium leading-none tracking-[-0.03em] tabular-nums ${
            featured ? "text-iris-deep" : "text-ink/70"
          }`}
        >
          {side.result}
        </p>
      </div>
    </div>
  );
}

/** Same trade, two venues: a thin pool versus a Zethos firm quote. */
export function Compare() {
  const { compare } = landing;
  const ref = useRef<HTMLElement>(null);
  // Cards slide toward each other as the section scrolls in, then hold.
  const progress = useScrollRange(ref, (m) => [m.top - m.vh, m.top - m.vh * 0.25]);
  const leftX = useTransform(progress, [0, 1], ["-6%", "0%"]);
  const rightX = useTransform(progress, [0, 1], ["6%", "0%"]);
  const deltaScale = useTransform(progress, [0.6, 1], [0.6, 1]);
  const deltaOpacity = useTransform(progress, [0.6, 1], [0, 1]);

  return (
    <section ref={ref} aria-labelledby="compare-title" className={`${ui.section} bg-canvas`}>
      <SectionHeader
        id="compare-title"
        pill={compare.pill}
        title={compare.headline}
        sub={compare.trade}
      />

      <div
        className={`relative ${ui.container} ${ui.afterHeader} grid ${ui.gridGap} md:grid-cols-2`}
      >
        <motion.div className="max-md:order-1" style={{ x: leftX }}>
          <OutcomeCard side={compare.pool} featured={false} />
        </motion.div>
        <motion.div className="max-md:order-3" style={{ x: rightX }}>
          <OutcomeCard side={compare.zethos} featured />
        </motion.div>

        <motion.div
          className="pointer-events-none z-10 mx-auto flex flex-col items-center max-md:order-2 max-md:-my-1 md:absolute md:top-0 md:flex-col-reverse md:gap-2 md:[&>span:last-child]:mt-0 md:left-1/2 md:-translate-x-1/2 md:-translate-y-[54px]"
          style={{ scale: deltaScale, opacity: deltaOpacity }}
        >
          <span className="rounded-full bg-iris-deep px-4 py-2 font-display text-lg font-medium tracking-[-0.02em] text-canvas shadow-[0_12px_30px_-10px_rgb(47_42_92/0.6)] tabular-nums">
            {compare.delta}
          </span>
          <span className="mt-2 rounded-full bg-canvas/90 px-3 py-1 font-body text-xs text-ink-muted">
            {compare.deltaLabel}
          </span>
        </motion.div>
      </div>

      <p className={`mx-auto mt-8 max-w-[560px] text-center ${ui.fine}`}>{compare.note}</p>
    </section>
  );
}
