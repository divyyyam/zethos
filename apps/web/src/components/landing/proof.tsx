"use client";

import { type MotionStyle, motion, useTransform } from "motion/react";
import { useRef } from "react";
import { landing } from "../../content/landing";
import type { EngineStats } from "../../content/stats.mock";
import type { Scenery } from "../../lib/scenery";
import { GlassTiles } from "./glass-tiles";
import { Reveal, SectionHeader } from "./primitives";
import { PinesFallback, SceneryImage } from "./scenery";
import { RANGES, useScrollRange } from "./scroll";
import { StatCard } from "./stat-card";
import { ui } from "./ui";

const CARD_TINTS = ["bg-lavender", "bg-peach", "bg-sky", "bg-mint"] as const;

const OUTLINE_LEFT = [
  [0, 0],
  [1, 1],
  [0, 2],
] as const;
const OUTLINE_RIGHT = [
  [1, 0],
  [0, 1],
  [2, 1],
  [1, 2],
] as const;

function Wordmark({ name }: { name: string }) {
  return (
    <span className="whitespace-nowrap font-body text-lg font-medium text-ink/80 md:text-xl">
      {name}
    </span>
  );
}

export function Proof({ stats, scenery }: { stats: EngineStats; scenery: Scenery }) {
  const { proof } = landing;
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollRange(ref, RANGES.through);
  const pineY = useTransform(progress, [0, 0.6, 1], ["16%", "0%", "0%"]);
  return (
    <section
      ref={ref}
      aria-labelledby="proof-title"
      className="relative z-20 -mt-12 overflow-x-clip px-5 pb-24 md:-mt-20 md:px-8 md:pb-32"
    >
      <GlassTiles
        cells={OUTLINE_LEFT}
        variant="outline"
        seed={3}
        className="left-[3%] top-16 hidden xl:block"
      />
      <GlassTiles
        cells={OUTLINE_RIGHT}
        variant="outline"
        seed={4}
        className="right-[3%] top-10 hidden xl:block"
      />

      <SectionHeader id="proof-title" pill={proof.pill} title={proof.headline} />

      <div className={`relative ${ui.container} mt-28 md:mt-36`}>
        {/* Pines sit behind the cards, peeking up between the 2nd and 3rd and down into the glass band. */}
        <motion.div
          style={{ "--pine-y": pineY } as MotionStyle}
          className="pointer-events-none absolute -top-28 left-1/2 aspect-[400/480] will-change-transform h-[520px] -translate-x-1/2 [mask-image:linear-gradient(to_bottom,#000_80%,transparent)] pin:translate-y-[var(--pine-y)] md:-top-36 md:h-[560px]"
        >
          <SceneryImage
            src={scenery.pines}
            fit="contain"
            sizes="(min-width: 768px) 470px, 440px"
            className="h-full w-full"
            fallback={<PinesFallback className="h-full w-full" />}
          />
        </motion.div>

        <ul className={`relative z-10 grid grid-cols-2 ${ui.gridGap} md:grid-cols-4`}>
          {proof.cards.map((card, i) => (
            <StatCard
              key={card.key}
              tint={CARD_TINTS[i % CARD_TINTS.length] ?? "bg-lavender"}
              label={card.label}
              value={stats[card.key]}
              format={card.format}
            />
          ))}
        </ul>

        <Reveal as="p" className="relative z-10 mt-4 text-center">
          <span className="inline-block max-w-[320px] rounded-full bg-canvas/90 px-3 py-1 font-body text-xs leading-relaxed text-ink-muted md:max-w-none">
            {proof.note}
          </span>
        </Reveal>

        <div className="relative mt-14 py-9 md:mt-12 md:py-12">
          {/* Frosted band: the tree reads as standing behind glass. */}
          <div
            aria-hidden
            className="absolute top-1/2 left-1/2 z-[1] h-[120px] w-[min(640px,100vw)] -translate-x-1/2 -translate-y-1/2 border-y border-canvas/60 bg-canvas/45 backdrop-blur-xl [mask-image:linear-gradient(to_right,transparent,#000_18%,#000_82%,transparent)]"
          />

          <ul
            aria-label={proof.integrationsLabel}
            className="relative z-[2] hidden items-center justify-center md:flex"
          >
            {proof.integrations.map((name) => (
              <li key={name} className="border-l border-hairline px-4 first:border-l-0 lg:px-10">
                <Wordmark name={name} />
              </li>
            ))}
          </ul>

          <div className="relative z-[2] overflow-hidden md:hidden motion-reduce:hidden">
            <div className="marquee-track flex w-max">
              {[0, 1].map((copy) => (
                <ul
                  key={copy}
                  aria-label={copy === 0 ? proof.integrationsLabel : undefined}
                  aria-hidden={copy === 1 || undefined}
                  className="flex"
                >
                  {proof.integrations.map((name) => (
                    <li key={name} className="border-l border-hairline px-6">
                      <Wordmark name={name} />
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>

          <ul
            aria-label={proof.integrationsLabel}
            className="relative z-[2] hidden flex-wrap justify-center gap-x-6 gap-y-2 max-md:motion-reduce:flex"
          >
            {proof.integrations.map((name) => (
              <li key={name}>
                <Wordmark name={name} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
