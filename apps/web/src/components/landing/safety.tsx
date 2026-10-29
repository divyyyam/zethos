"use client";

import { Check } from "lucide-react";
import { motion, useTransform } from "motion/react";
import { useRef } from "react";
import { landing } from "../../content/landing";
import { GlassTiles } from "./glass-tiles";
import { Reveal, SectionHeader } from "./primitives";
import { useScrollRange } from "./scroll";
import { ui } from "./ui";

const CORNER_TILES = [
  [0, 0],
  [1, 1],
  [2, 0],
] as const;

/** On-chain guarantees, on a pastel panel that settles into place as it scrolls in. */
export function Safety() {
  const { safety } = landing;
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollRange(ref, (m) => [m.top - m.vh, m.top - m.vh * 0.2]);
  const scale = useTransform(progress, [0, 1], [0.94, 1]);
  const y = useTransform(progress, [0, 1], [60, 0]);

  return (
    <section ref={ref} aria-labelledby="safety-title" className={ui.panelSection}>
      <motion.div
        className={`relative ${ui.container} overflow-hidden ${ui.panel} ${ui.panelPad} bg-lilac will-change-transform`}
        style={{ scale, y }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-32 size-[520px] rounded-full bg-[radial-gradient(closest-side,var(--color-peach),transparent)] opacity-70"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-48 -left-24 size-[520px] rounded-full bg-[radial-gradient(closest-side,var(--color-sky),transparent)] opacity-80"
        />
        <GlassTiles
          cells={CORNER_TILES}
          variant="outline"
          seed={11}
          size={56}
          className="right-10 bottom-10 hidden opacity-70 lg:block"
        />

        <div className="relative grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <SectionHeader
            id="safety-title"
            pill={safety.pill}
            title={safety.headline}
            sub={safety.sub}
            align="left"
            pillTone="bg-canvas"
          />

          <ul className={`grid ${ui.gridGap} sm:grid-cols-2`}>
            {safety.items.map((item, i) => (
              <li key={item.title}>
                <Reveal
                  index={i}
                  className={`flex h-full gap-4 ${ui.inset} bg-canvas/80 p-5 md:p-6`}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mint">
                    <Check aria-hidden className="size-4 text-iris-deep" strokeWidth={2.5} />
                  </span>
                  <div>
                    <h3 className={ui.itemTitle}>{item.title}</h3>
                    <p className={`mt-1 ${ui.body}`}>{item.body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </motion.div>
    </section>
  );
}
