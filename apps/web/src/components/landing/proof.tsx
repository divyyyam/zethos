"use client";

import Image from "next/image";
import { art } from "../../content/art";
import { landing } from "../../content/landing";
import { Reveal, ScrubText } from "./primitives";

/** The argument, in one sentence, followed by the ledger. */
export function Proof() {
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
