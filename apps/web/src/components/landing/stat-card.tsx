"use client";

import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import type { StatFormat } from "../../content/landing";
import { useReducedMotionPref } from "../../hooks/use-media-query";

export function formatStat(value: number, format: StatFormat): string {
  const n = format.thousands ? value / 1000 : value;
  const body = n.toLocaleString("en-US", {
    minimumFractionDigits: format.decimals,
    maximumFractionDigits: format.decimals,
  });
  return `${format.prefix ?? ""}${body}${format.suffix ?? ""}`;
}

/** Pastel "ticket" stat card. The value counts up from 0 once, the first time it enters view. */
export function StatCard({
  label,
  value,
  format,
  tint = "bg-lavender",
}: {
  label: string;
  value: number;
  format: StatFormat;
  /** Pastel surface class, e.g. `bg-peach`. */
  tint?: string;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotionPref();
  const played = useRef(false);
  // Starts at the final value so SSR, no-JS and reduced motion all show real figures.
  const current = useMotionValue(value);
  const text = useTransform(current, (v) => formatStat(v, format));

  useEffect(() => {
    if (reduced) {
      current.set(value);
      return;
    }
    if (played.current) return;
    if (!inView) {
      current.set(0);
      return;
    }
    played.current = true;
    const controls = animate(current, [0, value], { duration: 1.4, ease: "easeOut" });
    return () => controls.stop();
  }, [inView, reduced, value, current]);

  const final = formatStat(value, format);

  return (
    <motion.li
      ref={ref}
      initial={false}
      style={reduced ? {} : { y: 28 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: reduced ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={`ticket flex h-[174px] flex-col justify-between rounded-[24px] px-5 py-6 md:h-[208px] md:p-6 lg:p-7 ${tint}`}
    >
      <span className="max-w-[170px] font-body text-[12px] font-medium leading-[1.5] text-ink lg:text-[13px]">
        {label}
      </span>
      <span className="font-display text-[clamp(2.5rem,3.9vw,3.5rem)] font-medium leading-none tracking-[-0.02em] text-ink tabular-nums">
        <motion.span aria-hidden>{text}</motion.span>
        <span className="sr-only">{final}</span>
      </span>
    </motion.li>
  );
}
