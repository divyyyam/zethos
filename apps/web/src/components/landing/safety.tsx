"use client";

import { Check } from "lucide-react";
import { motion, useMotionValueEvent, useTransform } from "motion/react";
import Image from "next/image";
import { useRef, useState } from "react";
import { art } from "../../content/art";
import { landing } from "../../content/landing";
import { Reveal, RiseHeading } from "./primitives";
import { useScrollRange } from "./scroll";

/**
 * A quote travels down the line as you scroll and clears the vault's checks one by one. Each gate
 * lights when the packet reaches it; everything is already lit under reduced motion.
 */
export function Safety() {
  const { safety, chapters } = landing;
  const items = safety.items;
  const rail = useRef<HTMLOListElement>(null);
  const progress = useScrollRange(rail, (m) => [
    m.top - m.vh * 0.55,
    m.top + m.height - m.vh * 0.6,
  ]);
  const height = useTransform(progress, [0, 1], ["0%", "100%"]);
  const [passed, setPassed] = useState(0);
  useMotionValueEvent(progress, "change", (p) => setPassed(Math.ceil(p * items.length + 0.02)));
  const [lead, accent] = safety.headline.split(" *");

  return (
    <section
      aria-label={chapters.safety}
      data-world="0.94,0,0,1|0.98,0,0,1"
      data-chapter={chapters.safety}
      className="relative sect bg-white pt-section"
    >
      <div className="grid gap-x-head gap-y-head lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
        <div className="lg:sticky lg:top-[calc(var(--spacing-chrome)+var(--spacing-block))] lg:self-start">
          <Reveal>
            <p className="eyebrow text-fg-soft">{safety.kicker}</p>
          </Reveal>
          <RiseHeading
            lines={[lead ?? "", `*${accent ?? ""}`]}
            className="display t-section mt-4 text-fg"
          />
          <Reveal index={2}>
            <p className="lead mt-6 max-w-[460px] text-fg-soft">{safety.sub}</p>
          </Reveal>
          <Reveal index={3} className="mt-block hidden lg:block">
            <Image
              src={art.gates.src}
              width={art.gates.width}
              height={art.gates.height}
              sizes="40vw"
              alt=""
              className="plate h-[46vh] w-auto"
            />
          </Reveal>
        </div>

        <ol ref={rail} className="relative">
          <span aria-hidden className="absolute top-2 bottom-2 left-[15px] w-px bg-line" />
          <motion.span
            aria-hidden
            style={{ height }}
            className="absolute top-2 left-[15px] w-px origin-top bg-fg "
          />
          {items.map((item, i) => {
            const lit = i < passed;
            return (
              <li key={item.title} className="relative flex gap-6 pb-head last:pb-0">
                <span
                  aria-hidden
                  className={`relative z-10 flex size-[31px] shrink-0 items-center justify-center rounded-full border transition-colors duration-500 ${lit ? "border-fg bg-fg text-inverse" : "border-line bg-transparent text-transparent"}`}
                >
                  <Check className="size-3.5" strokeWidth={2.5} />
                </span>
                <div
                  className={`transition-opacity duration-700 ${lit ? "opacity-100" : "opacity-55"}`}
                >
                  <p className="eyebrow text-fg-faint">Gate {i + 1}</p>
                  <h3 className="display mt-2 text-[max(2rem,calc(var(--cw)*0.034))] text-fg">
                    {item.title}
                  </h3>
                  <p className="mt-3 max-w-[460px] text-fg-soft md:text-[18px]">{item.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
