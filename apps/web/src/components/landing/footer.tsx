"use client";

import { motion, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { landing } from "../../content/landing";
import { LogoMark } from "./logo-mark";
import { useScrollRange } from "./scroll";

// lucide-react 1.x no longer ships brand icons, so the two marks are inlined here.
function XIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.82-.26.82-.57v-2.04c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.57A12 12 0 0 0 12 .3" />
    </svg>
  );
}

/** Pastel footer fixed beneath the page; `main` scrolls away above it like a curtain. */
export function Footer() {
  const { footer } = landing;
  const footerRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const footerHeight = useRef(300);
  // Point the range hook at <main>: the curtain opens as main's bottom edge rises off-screen.
  // (Declared before useScrollRange so the ref is set before the hook measures.)
  useEffect(() => {
    mainRef.current = document.querySelector("main");
    const el = footerRef.current;
    if (!el) return;
    const measure = () => {
      footerHeight.current = el.offsetHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const reveal = useScrollRange(mainRef, (m) => {
    const opensAt = m.top + m.height - m.vh;
    return [opensAt, opensAt + footerHeight.current];
  });
  const contentY = useTransform(reveal, [0, 1], ["35%", "0%"]);
  const contentOpacity = useTransform(reveal, [0, 0.7], [0.2, 1]);

  return (
    <footer
      ref={footerRef}
      className="fixed inset-x-0 bottom-0 z-0 h-[var(--footer-h)] overflow-hidden bg-[linear-gradient(115deg,var(--color-lavender)_0%,var(--color-rose)_55%,var(--color-peach)_100%)] text-ink"
      onFocusCapture={(event) => {
        // Keyboard users must see a focused footer link even before the curtain has opened.
        if (event.target.matches(":focus-visible")) {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
        }
      }}
    >
      <motion.div
        className="mx-auto flex h-full max-w-[1200px] flex-col items-center justify-center gap-7 px-5 md:flex-row md:justify-between md:gap-10"
        style={{ y: contentY, opacity: contentOpacity }}
      >
        <div className="flex size-28 shrink-0 items-center justify-center rounded-full border border-ink">
          <LogoMark className="size-11" />
        </div>

        <div className="flex flex-col items-center gap-4 text-center">
          <nav aria-label={footer.navLabel}>
            <ul className="flex flex-wrap justify-center gap-x-7 gap-y-2">
              {footer.links.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="font-body text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <p className="max-w-[340px] font-body text-[13px] text-ink md:max-w-none">
            {footer.copyright}
          </p>
        </div>

        <ul className="flex items-center gap-2 md:w-28 md:justify-end">
          {[
            { ...footer.social.x, Icon: XIcon },
            { ...footer.social.github, Icon: GithubIcon },
          ].map(({ label, href, Icon }) => (
            <li key={label}>
              <a
                href={href}
                aria-label={label}
                className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-ink/10"
              >
                <Icon className="size-5" />
              </a>
            </li>
          ))}
        </ul>
      </motion.div>
    </footer>
  );
}
