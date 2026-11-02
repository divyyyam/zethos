"use client";

import { ArrowUpRight } from "lucide-react";
import { motion, useTransform } from "motion/react";
import Link from "next/link";
import { type ElementType, Fragment, type ReactNode, useRef } from "react";
import { useReducedMotionPref } from "../../hooks/use-media-query";
import { Magnetic } from "./magnetic";
import { useScrollRange } from "./scroll";

export const EASE = [0.16, 1, 0.3, 1] as const;

/** Renders `*emphasis*` in copy as the italic serif accent. */
export function Rich({ text }: { text: string }) {
  return text.split("*").map((part, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: static copy
    <Fragment key={i}>{i % 2 ? <em>{part}</em> : part}</Fragment>
  ));
}

/** The one primary action: a pill whose arrow rolls out and back in on hover. */
export function PrimaryButton({
  href,
  children,
  size = "md",
}: {
  href: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const sizing = {
    sm: "h-10 pl-4 pr-1.5 text-[13px] gap-3",
    md: "h-14 pl-6 pr-2 text-[15px] gap-5",
    lg: "h-18 pl-9 pr-3 text-lg gap-8",
  }[size];
  const dot = { sm: "size-7", md: "size-10", lg: "size-12" }[size];
  return (
    <Magnetic strength={0.22}>
      <Link
        href={href}
        data-cursor="hover"
        className={`group inline-flex items-center rounded-full bg-fg font-medium text-inverse transition-transform duration-500 ease-expo active:scale-[0.97] ${sizing}`}
      >
        <span>{children}</span>
        <span
          className={`relative flex items-center justify-center overflow-hidden rounded-full bg-inverse text-fg ${dot}`}
        >
          <ArrowUpRight
            aria-hidden
            className="size-[45%] transition-transform duration-500 ease-expo group-hover:translate-x-[180%] group-hover:-translate-y-[180%]"
          />
          <ArrowUpRight
            aria-hidden
            className="absolute size-[45%] -translate-x-[180%] translate-y-[180%] transition-transform duration-500 ease-expo group-hover:translate-x-0 group-hover:translate-y-0"
          />
        </span>
      </Link>
    </Magnetic>
  );
}

/** Rise and un-blur once, on entering the viewport. */
export function Reveal({
  children,
  index = 0,
  className,
  y = 28,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  y?: number;
}) {
  const reduced = useReducedMotionPref();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 1.1, ease: EASE, delay: index * 0.07 }}
    >
      {children}
    </motion.div>
  );
}

/** Headline whose lines rise out of a clip when scrolled into view. */
export function RiseHeading({
  as: Tag = "h2",
  lines,
  className,
  id,
}: {
  as?: ElementType;
  lines: readonly string[];
  className?: string;
  id?: string;
}) {
  const reduced = useReducedMotionPref();
  return (
    <Tag id={id} className={className}>
      {lines.map((line, i) => (
        <span key={line} className="line-mask">
          <motion.span
            initial={reduced ? false : { y: "108%", rotate: 2.5 }}
            whileInView={{ y: 0, rotate: 0 }}
            viewport={{ once: true, margin: "0px 0px -6% 0px" }}
            transition={{ duration: 1.25, ease: EASE, delay: i * 0.1 }}
          >
            <Rich text={line} />
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}

function ScrubWord({
  word,
  start,
  end,
  progress,
  accent,
}: {
  word: string;
  start: number;
  end: number;
  progress: ReturnType<typeof useScrollRange>;
  accent: boolean;
}) {
  const opacity = useTransform(progress, [start, end], [0.14, 1]);
  const Tag = accent ? motion.em : motion.span;
  return (
    <>
      <Tag className="scrub" style={{ opacity }}>
        {word}
      </Tag>{" "}
    </>
  );
}

/** Words ink in one at a time as the block crosses the viewport. `*x y*` marks an accent run. */
export function ScrubText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const progress = useScrollRange(ref, (m) => [
    m.top - m.vh * 0.82,
    m.top + m.height - m.vh * 0.42,
  ]);
  const words: { word: string; accent: boolean }[] = [];
  for (const [i, part] of text.split("*").entries()) {
    for (const word of part.split(" ").filter(Boolean)) words.push({ word, accent: i % 2 === 1 });
  }
  return (
    <p ref={ref} className={className}>
      {words.map(({ word, accent }, i) => (
        <ScrubWord
          // biome-ignore lint/suspicious/noArrayIndexKey: static copy, words may repeat
          key={i}
          word={word}
          accent={accent}
          progress={progress}
          start={i / words.length}
          end={Math.min(1, (i + 2.5) / words.length)}
        />
      ))}
    </p>
  );
}
