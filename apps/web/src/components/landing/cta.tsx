"use client";

import { type MotionStyle, motion, useTransform } from "motion/react";
import { useRef } from "react";
import { landing } from "../../content/landing";
import type { Scenery } from "../../lib/scenery";
import { GlassTiles } from "./glass-tiles";
import { Pill, PrimaryButton, Reveal } from "./primitives";
import { LandscapeFallback, SceneryImage } from "./scenery";
import { RANGES, useScrollRange } from "./scroll";
import { ui } from "./ui";

const OUTLINE_LEFT = [
  [0, 1],
  [1, 0],
  [2, 1],
  [1, 2],
] as const;
const OUTLINE_RIGHT = [
  [0, 0],
  [1, 1],
  [0, 2],
] as const;
const GLASS_NEAR_PANEL = [
  [0, 0],
  [1, 0],
  [1, 1],
] as const;

export function Cta({ scenery }: { scenery: Scenery }) {
  const { cta } = landing;
  const ref = useRef<HTMLElement>(null);
  const progress = useScrollRange(ref, RANGES.through, 0.5);
  const sceneY = useTransform(progress, [0, 1], ["-6vh", "6vh"]);
  const panelY = useTransform(progress, [0, 0.5, 1], ["24px", "0px", "-24px"]);
  return (
    <section
      ref={ref}
      aria-labelledby="cta-title"
      className="relative overflow-hidden bg-canvas pt-24 md:pt-32"
    >
      <GlassTiles
        cells={OUTLINE_LEFT}
        variant="outline"
        seed={5}
        className="left-[6%] top-6 z-10 max-md:scale-75 origin-top-left"
      />
      <GlassTiles
        cells={OUTLINE_RIGHT}
        variant="outline"
        seed={6}
        className="right-[8%] top-14 z-10 hidden md:block"
      />

      <div className="relative h-[720px] overflow-hidden md:h-[min(100vh,900px)] md:min-h-[760px]">
        <motion.div
          className="absolute inset-0 will-change-transform pin:translate-y-[var(--scene-y)] pin:scale-[1.08]"
          style={{ "--scene-y": sceneY } as MotionStyle}
        >
          <SceneryImage
            src={scenery.ctaNight}
            sizes="100vw"
            className="absolute inset-0"
            fallback={
              <LandscapeFallback variant="night" className="absolute inset-0 h-full w-full" />
            }
          />
        </motion.div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-linear-to-b from-canvas via-canvas/85 via-35% to-canvas/0 to-75%"
        />

        <motion.div
          className="absolute inset-x-5 top-[4%] mx-auto max-w-[820px] will-change-transform pin:translate-y-[var(--panel-y)] md:top-[6%]"
          style={{ "--panel-y": panelY } as MotionStyle}
        >
          <GlassTiles
            cells={GLASS_NEAR_PANEL}
            seed={7}
            depth={1.3}
            className="-left-10 -bottom-12 hidden md:block"
          />
          <GlassTiles
            cells={GLASS_NEAR_PANEL}
            seed={8}
            depth={0.8}
            size={56}
            className="-right-12 -top-10 hidden md:block"
          />
          <div
            className={`relative flex flex-col items-center gap-5 ${ui.card} border border-canvas/50 bg-canvas/25 px-6 py-10 text-center shadow-[inset_0_1px_0_rgb(255_255_255/0.6)] backdrop-blur-[24px] md:px-14 md:py-14`}
          >
            <Reveal>
              <Pill>{cta.pill}</Pill>
            </Reveal>
            <Reveal as="h2" index={1} id="cta-title" className={ui.h2}>
              {cta.headline}
            </Reveal>
            <Reveal as="p" index={2} className={`max-w-[460px] ${ui.lead}`}>
              {cta.sub}
            </Reveal>
            <Reveal index={3} className="mt-2">
              <PrimaryButton href={cta.primary.href}>{cta.primary.label}</PrimaryButton>
            </Reveal>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
