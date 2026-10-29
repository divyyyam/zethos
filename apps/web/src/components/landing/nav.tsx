"use client";

import { useMotionValueEvent } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { landing } from "../../content/landing";
import { LogoMark } from "./logo-mark";
import { PrimaryButton } from "./primitives";
import { useLandingScroll } from "./scroll";

/** Floating, centred nav pill. Turns translucent and blurred after 40px of scroll. */
export function Nav() {
  const { scrollY } = useLandingScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 40));

  return (
    <header className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4 md:top-5">
      <nav
        aria-label={landing.nav.label}
        className={`pointer-events-auto flex items-center gap-4 rounded-full p-1.5 pl-4 shadow-[0_12px_40px_rgb(17_17_17/0.06)] transition-colors duration-300 md:gap-10 md:p-2 md:pl-5 ${
          scrolled ? "bg-white/80 backdrop-blur-xl" : "bg-white"
        }`}
      >
        <Link
          href="/"
          aria-label={landing.nav.homeLabel}
          className="flex items-center gap-2 text-ink"
        >
          <LogoMark className="size-5 md:size-6" />
          <span className="font-display text-xl font-medium leading-none tracking-[-0.045em] md:text-[23px]">
            {landing.nav.wordmark}
          </span>
        </Link>
        <PrimaryButton href={landing.nav.cta.href} size="sm">
          {landing.nav.cta.label}
        </PrimaryButton>
      </nav>
    </header>
  );
}
