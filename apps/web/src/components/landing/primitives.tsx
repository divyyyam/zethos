"use client";

import { ArrowDown } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useReducedMotionPref } from "../../hooks/use-media-query";
import { ui } from "./ui";

export const EASE = [0.22, 1, 0.36, 1] as const;

export function Pill({ children, tone = "bg-lilac" }: { children: ReactNode; tone?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full ${tone} px-3 py-1.5 font-body text-[13px] font-medium leading-none text-ink`}
    >
      {children}
    </span>
  );
}

export function PrimaryButton({
  href,
  children,
  size = "md",
}: {
  href: string;
  children: ReactNode;
  size?: "sm" | "md";
}) {
  const sizing = size === "sm" ? "px-4 py-2 text-[13px]" : "px-5 py-2.5 text-sm";
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-full bg-iris-deep font-body font-medium leading-5 text-canvas transition-[transform,background-color] duration-200 ease-soft hover:-translate-y-px hover:bg-iris motion-reduce:transform-none ${sizing}`}
    >
      {children}
    </Link>
  );
}

export function TextButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-1.5 rounded-full px-3 py-2.5 font-body text-sm font-medium text-ink"
    >
      {children}
      <ArrowDown
        aria-hidden
        className="size-4 transition-transform duration-200 ease-soft group-hover:translate-y-0.5"
      />
    </a>
  );
}

/**
 * Default reveal: fade + rise 16px, 600ms, once. `index` staggers siblings by 60ms.
 * Under reduced motion the landing's `MotionConfig reducedMotion="user"` drops the rise.
 */
export function Reveal({
  children,
  index = 0,
  className,
  id,
  as = "div",
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  id?: string;
  as?: "div" | "p" | "h2";
}) {
  const reduced = useReducedMotionPref();
  const Tag = motion[as];
  return (
    <Tag
      id={id}
      className={className}
      data-reveal
      initial={false}
      animate={reduced ? { opacity: 1, y: 0 } : {}}
      whileInView={{ opacity: 1, y: 0 }}
      style={reduced ? {} : { opacity: 0, y: 16 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: reduced ? 0 : 0.6, ease: EASE, delay: reduced ? 0 : index * 0.06 }}
    >
      {children}
    </Tag>
  );
}

/** Section header: eyebrow pill, headline and optional lead line, on one shared rhythm. */
export function SectionHeader({
  id,
  pill,
  title,
  sub,
  align = "center",
  pillTone,
}: {
  id: string;
  pill: string;
  title: string;
  sub?: string;
  align?: "center" | "left";
  pillTone?: string;
}) {
  const centered = align === "center";
  return (
    <div
      className={`flex max-w-[760px] flex-col gap-5 ${centered ? "mx-auto items-center text-center" : "items-start"}`}
    >
      <Reveal>
        <Pill {...(pillTone ? { tone: pillTone } : {})}>{pill}</Pill>
      </Reveal>
      <Reveal index={1} as="h2" id={id} className={`max-w-[660px] ${ui.h2}`}>
        {title}
      </Reveal>
      {sub && (
        <Reveal as="p" index={2} className={`max-w-[520px] ${ui.lead}`}>
          {sub}
        </Reveal>
      )}
    </div>
  );
}
