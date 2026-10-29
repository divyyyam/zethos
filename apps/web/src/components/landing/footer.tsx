"use client";

import { ArrowUp } from "lucide-react";
import { type MotionValue, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { type RefObject, useEffect, useRef } from "react";
import { landing } from "../../content/landing";
import { useFinePointerDesktop, useReducedMotionPref } from "../../hooks/use-media-query";
import { LogoMark } from "./logo-mark";
import { Magnetic } from "./magnetic";
import { useScrollRange, useScrollTo } from "./scroll";

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

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * One letter of the giant wordmark. It rises into place in a staggered wave as the footer is
 * revealed, and lifts and brightens when the pointer passes over it (desktop).
 */
function Letter({
  char,
  index,
  reveal,
  pointer,
  hover,
  centers,
  width,
}: {
  char: string;
  index: number;
  reveal: MotionValue<number>;
  pointer: MotionValue<number>;
  hover: MotionValue<number>;
  centers: RefObject<number[]>;
  width: RefObject<number>;
}) {
  // Smooth falloff around the pointer, scaled by how "on" the hover is.
  const lift = useTransform([pointer, hover], ([x, on]) => {
    const centre = centers.current[index] ?? -1e4;
    const d = Math.abs((x as number) - centre) / Math.max(1, width.current * 0.16);
    return Math.max(0, 1 - d * d) * (on as number);
  });
  const y = useTransform([reveal, lift], ([r, l]) => {
    const t = Math.min(1, Math.max(0, ((r as number) - index * 0.07) / 0.55));
    return `${(1 - easeOut(t)) * 70 - (l as number) * 22}%`;
  });
  const opacity = useTransform(lift, (l) => 0.78 + l * 0.22);
  return (
    <motion.span className="inline-block will-change-transform" style={{ y, opacity }}>
      {char}
    </motion.span>
  );
}

function Wordmark({
  text,
  reveal,
  pointer,
  hover,
  containerRef,
}: {
  text: string;
  reveal: MotionValue<number>;
  pointer: MotionValue<number>;
  hover: MotionValue<number>;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const centers = useRef<number[]>([]);
  const width = useRef(1);

  // Letter centres from layout offsets (unaffected by the transforms we animate), cached on resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      width.current = el.offsetWidth;
      centers.current = [...el.children].map((c) => {
        const span = c as HTMLElement;
        return span.offsetLeft + span.offsetWidth / 2;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [containerRef]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none relative flex justify-center font-display text-[clamp(6.5rem,31vw,16rem)] md:text-[clamp(10rem,21vw,19rem)] font-medium leading-[0.78] tracking-[-0.06em] text-canvas select-none"
    >
      {[...text].map((char, i) => (
        <Letter
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed wordmark, letters may repeat
          key={i}
          char={char}
          index={i}
          reveal={reveal}
          pointer={pointer}
          hover={hover}
          centers={centers}
          width={width}
        />
      ))}
    </div>
  );
}

/**
 * Pastel footer fixed beneath the page; `main` scrolls away above it like a curtain. As it opens,
 * the content rises, the mark turns into place and the giant wordmark ripples up; on desktop the
 * wordmark follows the pointer and the controls are magnetic.
 */
export function Footer() {
  const { footer, nav } = landing;
  const footerRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const footerHeight = useRef(460);
  const scrollTo = useScrollTo();
  const desktop = useFinePointerDesktop();
  const reduced = useReducedMotionPref();
  const interactive = desktop && !reduced;

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
  const markRotate = useTransform(reveal, [0, 1], [-120, 0]);

  // Pointer position across the wordmark (px), smoothed; `hover` fades the effect in and out.
  const rawPointer = useMotionValue(-1e4);
  const pointer = useSpring(rawPointer, { stiffness: 260, damping: 32 });
  const hover = useSpring(0, { stiffness: 120, damping: 20 });

  return (
    <footer
      ref={footerRef}
      className="fixed inset-x-0 bottom-0 z-0 flex h-[var(--footer-h)] flex-col justify-between overflow-hidden bg-[linear-gradient(115deg,var(--color-lavender)_0%,var(--color-rose)_55%,var(--color-peach)_100%)] text-ink"
      onPointerMove={(e) => {
        const box = wordmarkRef.current;
        if (!interactive || !box || e.pointerType !== "mouse") return;
        rawPointer.set(e.clientX - box.getBoundingClientRect().left);
        hover.set(1);
      }}
      onPointerLeave={() => hover.set(0)}
      onFocusCapture={(event) => {
        // Keyboard users must see a focused footer link even before the curtain has opened.
        if (event.target.matches(":focus-visible")) {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
        }
      }}
    >
      <motion.div
        className="relative z-10 mx-auto grid w-full max-w-[1200px] justify-items-center gap-7 px-5 pt-12 md:grid-cols-[auto_1fr_auto] md:items-start md:justify-items-stretch md:gap-10 md:px-8 md:pt-16"
        style={{ y: contentY, opacity: contentOpacity }}
      >
        <div className="flex flex-col items-center gap-4 md:items-start">
          <Magnetic strength={0.25}>
            <motion.div
              className="flex size-24 items-center justify-center rounded-full border border-ink md:size-28"
              style={{ rotate: markRotate }}
            >
              <LogoMark className="size-10 md:size-11" />
            </motion.div>
          </Magnetic>
          <p className="flex items-center gap-2 rounded-full bg-canvas/60 px-3 py-1.5 font-body text-xs font-medium text-ink">
            <span aria-hidden className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#2f9e6f] opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2 rounded-full bg-[#2f9e6f]" />
            </span>
            {footer.status}
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 text-center md:pt-6">
          <nav aria-label={footer.navLabel}>
            <ul className="flex flex-wrap justify-center gap-x-7 gap-y-2">
              {footer.links.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat pb-0.5 font-body text-sm font-medium transition-[background-size] duration-300 ease-soft hover:bg-[length:100%_1px] focus-visible:bg-[length:100%_1px]"
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

        <div className="flex items-center gap-2 md:flex-col md:items-end md:gap-4 md:pt-4">
          <ul className="flex items-center gap-1">
            {[
              { ...footer.social.x, Icon: XIcon },
              { ...footer.social.github, Icon: GithubIcon },
            ].map(({ label, href, Icon }) => (
              <li key={label}>
                <Magnetic strength={0.4}>
                  <a
                    href={href}
                    aria-label={label}
                    className="flex size-11 items-center justify-center rounded-full transition-colors hover:bg-canvas/60"
                  >
                    <Icon className="size-5" />
                  </a>
                </Magnetic>
              </li>
            ))}
          </ul>
          <Magnetic strength={0.3}>
            <button
              type="button"
              onClick={() => scrollTo(0)}
              className="group flex items-center gap-2 rounded-full bg-iris-deep px-4 py-2.5 font-body text-[13px] font-medium text-canvas transition-colors hover:bg-iris"
            >
              {footer.backToTop}
              <ArrowUp
                aria-hidden
                className="size-4 transition-transform duration-300 ease-soft group-hover:-translate-y-0.5"
              />
            </button>
          </Magnetic>
        </div>
      </motion.div>

      <div className="relative pb-3 md:translate-y-[7%] md:pb-0">
        <Wordmark
          text={nav.wordmark}
          reveal={reveal}
          pointer={pointer}
          hover={hover}
          containerRef={wordmarkRef}
        />
      </div>
    </footer>
  );
}
