"use client";

import Link from "next/link";
import { landing } from "../../content/landing";
import { LogoMark } from "./logo-mark";
import { PrimaryButton } from "./primitives";

/**
 * Edge-to-edge instrument bar. The centre readout is the page's clock: it runs from dawn to night
 * with the scroll position and names the current chapter (written by `LandingWorld`).
 */
export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-white px-[var(--gutter)] py-3 ">
      <nav
        aria-label={landing.nav.label}
        className="grid grid-cols-[1fr_auto] items-center md:grid-cols-[1fr_auto_1fr]"
      >
        <Link
          href="/"
          aria-label={landing.nav.homeLabel}
          data-cursor="hover"
          className="group flex w-fit items-center gap-2 text-fg"
        >
          <LogoMark className="size-5" motion="hover" />
          <span className="font-serif text-[27px] leading-none font-light tracking-[-0.035em]">
            {landing.nav.wordmark}
          </span>
        </Link>
        <p className="hidden items-center gap-3 text-sm text-fg-soft md:flex" aria-hidden>
          <span data-hud-clock className="num-sm text-fg">
            05:42
          </span>
          <span className="h-px w-8 bg-line" />
          <span data-hud-chapter>{landing.chapters.hero}</span>
        </p>
        <div className="justify-self-end">
          <PrimaryButton href={landing.nav.cta.href} size="sm">
            {landing.nav.cta.label}
          </PrimaryButton>
        </div>
      </nav>
    </header>
  );
}
