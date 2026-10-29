"use client";

import Lenis from "lenis";
import {
  cancelFrame,
  type FrameData,
  frame,
  type MotionValue,
  useMotionValue,
  useTransform,
} from "motion/react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useReducedMotionPref } from "../../hooks/use-media-query";

interface ScrollState {
  /** Page scroll position, updated inside the same frame Lenis moves the page. */
  scrollY: MotionValue<number>;
  /** 1 when the visitor prefers reduced motion, else 0. A motion value so derived values react. */
  reduced: MotionValue<number>;
  lenis: RefObject<Lenis | null>;
  /** Register an element-measuring callback; all run together in one batched read. */
  onLayout: (measure: () => void) => () => void;
}

const ScrollContext = createContext<ScrollState | null>(null);

/**
 * One scroll clock for the whole page. Lenis is stepped from motion's frame loop and publishes its
 * position straight into `scrollY` during the update phase, so every scroll-linked transform is
 * written in the very frame the page moves. (Reading the browser's `scroll` event instead lands a
 * frame late, which is what makes parallax judder against the page.)
 */
export function ScrollProvider({ children }: { children: ReactNode }) {
  const prefersReduced = useReducedMotionPref();
  const scrollY = useMotionValue(0);
  const reduced = useMotionValue(0);
  const lenis = useRef<Lenis | null>(null);
  const measurers = useRef(new Set<() => void>());

  // One observer for the whole page. Any size change re-measures every registered element in a
  // single frame.read batch: all layout reads happen together, before motion writes any styles.
  useEffect(() => {
    const runAll = () => {
      for (const measure of measurers.current) measure();
    };
    const schedule = () => frame.read(runAll);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    window.addEventListener("resize", schedule);
    void document.fonts?.ready.then(schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      cancelFrame(runAll);
    };
  }, []);

  const onLayout = useCallback((measure: () => void) => {
    measurers.current.add(measure);
    frame.read(measure);
    return () => {
      measurers.current.delete(measure);
    };
  }, []);

  useEffect(() => {
    reduced.set(prefersReduced ? 1 : 0);
    // Native scroll (keyboard, scrollbar drag, reduced motion) still feeds the same clock.
    const sync = () => scrollY.set(window.scrollY);
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    if (prefersReduced) return () => window.removeEventListener("scroll", sync);

    const instance = new Lenis({ lerp: 0.1, autoRaf: false, anchors: true });
    lenis.current = instance;
    instance.on("scroll", () => scrollY.set(instance.actualScroll));
    const tick = ({ timestamp }: FrameData) => instance.raf(timestamp);
    frame.update(tick, true);
    return () => {
      cancelFrame(tick);
      instance.destroy();
      lenis.current = null;
      window.removeEventListener("scroll", sync);
    };
  }, [prefersReduced, reduced, scrollY]);

  return (
    <ScrollContext.Provider value={{ scrollY, reduced, lenis, onLayout }}>
      {children}
    </ScrollContext.Provider>
  );
}

export function useLandingScroll(): ScrollState {
  const ctx = useContext(ScrollContext);
  if (!ctx) throw new Error("useLandingScroll must be used inside <ScrollProvider>");
  return ctx;
}

export interface ScrollMetrics {
  /** Element's top edge in document coordinates. */
  top: number;
  height: number;
  /** Viewport height. */
  vh: number;
}

/** Maps metrics to the [start, end] scroll positions over which progress runs 0 → 1. */
export type ScrollRange = (m: ScrollMetrics) => readonly [number, number];

export const RANGES = {
  /** While a tall section is pinned: its top reaches the viewport top → its bottom reaches the viewport bottom. */
  pin: (m) => [m.top, m.top + m.height - m.vh],
  /** From the element's top touching the viewport bottom until its bottom leaves the top. */
  through: (m) => [m.top - m.vh, m.top + m.height],
  /** From the page top until the element has scrolled fully out (for elements at the page top). */
  exit: (m) => [m.top, m.top + m.height],
} satisfies Record<string, ScrollRange>;

/**
 * Scroll progress (0–1) of an element over `range`. Element geometry is measured once and on
 * resize/layout change, never per frame, so scrubbing costs one subtraction per frame.
 * With reduced motion the value pins to `reducedValue` (the "finished" state by default).
 */
export function useScrollRange(
  target: RefObject<HTMLElement | null>,
  range: ScrollRange,
  reducedValue = 1,
): MotionValue<number> {
  const { scrollY, reduced, onLayout } = useLandingScroll();
  const metrics = useRef<ScrollMetrics | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const layout = useMotionValue(0);

  useEffect(
    () =>
      onLayout(() => {
        const el = target.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        metrics.current = {
          top: rect.top + window.scrollY,
          height: el.offsetHeight,
          vh: window.innerHeight,
        };
        layout.set(layout.get() + 1);
      }),
    [target, layout, onLayout],
  );

  return useTransform([scrollY, reduced, layout], ([y, isReduced]) => {
    if (isReduced) return reducedValue;
    const m = metrics.current;
    if (!m) return 0;
    const [start, end] = rangeRef.current(m);
    if (end <= start) return (y as number) >= start ? 1 : 0;
    return Math.min(1, Math.max(0, ((y as number) - start) / (end - start)));
  });
}

/** Scroll the page to a document position, smoothly through Lenis when it is running. */
export function useScrollTo() {
  const { lenis } = useLandingScroll();
  return (top: number) => {
    if (lenis.current) lenis.current.scrollTo(top, { duration: 1.4 });
    else window.scrollTo({ top, behavior: "auto" });
  };
}
