"use client";

import { motion, useTransform } from "motion/react";
import { type CSSProperties, useRef } from "react";
import { landing } from "../../content/landing";
import type { Scenery } from "../../lib/scenery";
import { DriftingCloud } from "./drifting-cloud";
import { GlassTiles } from "./glass-tiles";
import { PrimaryButton, TextButton } from "./primitives";
import { LandscapeFallback, SceneryImage } from "./scenery";
import { RANGES, useScrollRange } from "./scroll";

const LEFT_CLUSTER = [
  [1, 0],
  [0, 1],
  [1, 1],
  [2, 2],
  [0, 3],
] as const;
const RIGHT_CLUSTER = [
  [0, 0],
  [2, 0],
  [1, 1],
  [2, 1],
  [1, 3],
  [3, 2],
] as const;

/** Headline words, each blurring up into place on load with a 75ms stagger. */
function Words({ text, start }: { text: string; start: number }) {
  return text.split(" ").map((word, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: static copy, words may repeat
    <span key={i}>
      <span className="hero-word inline-block" style={{ "--i": start + i } as CSSProperties}>
        {word}
      </span>{" "}
    </span>
  ));
}

export function Hero({ scenery }: { scenery: Scenery }) {
  const { hero } = landing;
  const ref = useRef<HTMLElement>(null);
  // 0 at the top of the page → 1 once the hero has scrolled out. Holds at 0 for reduced motion.
  const progress = useScrollRange(ref, RANGES.exit, 0);

  // Copy leaves faster than the page and is gone by 40%.
  const copyY = useTransform(progress, [0, 0.4], ["0vh", "-14vh"]);
  const copyOpacity = useTransform(progress, [0, 0.4], [1, 0]);
  // Landscape travels at ~0.6x scroll speed and eases forward; clouds rise a little faster.
  const sceneY = useTransform(progress, [0, 1], ["0vh", "40vh"]);
  const sceneScale = useTransform(progress, [0, 1], [1, 1.05]);
  const cloudsY = useTransform(progress, [0, 1], ["0vh", "-12vh"]);

  const leadCount = hero.headline.lead.split(" ").length;
  const line2Count = hero.headline.line2.split(" ").length;

  return (
    <section
      ref={ref}
      aria-labelledby="hero-title"
      className="relative h-[100svh] min-h-[760px] bg-[radial-gradient(120%_80%_at_50%_0%,var(--color-lilac),var(--color-canvas-soft)_60%,var(--color-peach))] md:min-h-[820px]"
    >
      {/* The whole hero is a card that opens out to full bleed on load. */}
      <div className="hero-card absolute inset-0 overflow-hidden bg-canvas">
        <motion.div
          className="absolute inset-x-0 bottom-0 h-[64%] origin-bottom will-change-transform md:h-[76%]"
          style={{ y: sceneY, scale: sceneScale }}
        >
          <div className="hero-zoom absolute inset-0 origin-[50%_80%]">
            <SceneryImage
              src={scenery.heroDay}
              priority
              sizes="100vw"
              className="h-full w-full"
              fallback={
                <LandscapeFallback variant="day" className="absolute inset-0 h-full w-full" />
              }
            />
          </div>
          <GlassTiles
            cells={LEFT_CLUSTER}
            seed={1}
            className="bottom-[13%] left-[5%] origin-bottom-left max-md:scale-[0.55]"
          />
          <GlassTiles
            cells={RIGHT_CLUSTER}
            seed={2}
            depth={1.4}
            className="bottom-[20%] right-[4%] origin-bottom-right max-md:scale-[0.5]"
          />
        </motion.div>

        {/* Clouds sit above the landscape: the painted sky is opaque white. */}
        <motion.div className="pointer-events-none absolute inset-0" style={{ y: cloudsY }}>
          <DriftingCloud
            src={scenery.cloud1}
            tone="peach"
            intro={0.5}
            className="left-[-22%] top-[9%] h-[120px] w-[270px] md:left-[-1%] md:top-[12%] md:h-[180px] md:w-[430px]"
            duration={78}
          />
          <DriftingCloud
            src={scenery.cloud2}
            tone="lavender"
            intro={0.7}
            className="right-[-25%] top-[16%] h-[100px] w-[240px] md:right-[-3%] md:top-[20%] md:h-[150px] md:w-[370px]"
            duration={64}
            offset={-20}
            distance={90}
          />
        </motion.div>

        {/* Soft hand-off into the white page as the parallaxed scene slides under the fold. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[180px] bg-gradient-to-b from-canvas/0 via-canvas/70 to-canvas md:h-[220px]"
        />

        <motion.div
          className="absolute inset-x-0 top-[24%] z-10 px-5 md:top-[26%]"
          style={{ y: copyY, opacity: copyOpacity }}
        >
          <div className="mx-auto flex max-w-[1200px] flex-col items-center text-center">
            <h1
              id="hero-title"
              className="max-w-[1100px] text-balance font-display text-[clamp(2.5rem,5.3vw,4.5rem)] font-normal leading-[1.05] tracking-[-0.035em] text-ink"
            >
              <span className="block">
                <Words text={hero.headline.lead} start={0} />
              </span>
              <span className="block">
                <Words text={hero.headline.line2} start={leadCount} />
                <em className="font-display italic text-iris">
                  <Words text={hero.headline.accent} start={leadCount + line2Count} />
                </em>
              </span>
            </h1>
            <p
              className="intro-fade mt-6 max-w-[590px] text-pretty font-body text-[15px] leading-[1.7] text-ink-muted md:mt-7 md:text-[17px]"
              style={{ "--delay": "1.15s" } as CSSProperties}
            >
              {hero.sub}
            </p>
            <div
              className="intro-fade mt-6 flex items-center gap-2 md:mt-7 md:gap-3"
              style={{ "--delay": "1.3s" } as CSSProperties}
            >
              <PrimaryButton href={hero.primary.href}>{hero.primary.label}</PrimaryButton>
              <TextButton href={hero.secondary.href}>{hero.secondary.label}</TextButton>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
