"use client";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

/** Rolls to each new value instead of snapping. */
export function Rolling({ value, format }: { value: number; format: (value: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const still = useReducedMotion();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (still) {
      element.textContent = format(value);
      shown.current = value;
      return;
    }
    const controls = animate(shown.current, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (next) => {
        shown.current = next;
        element.textContent = format(next);
      },
    });
    return () => controls.stop();
  }, [value, format, still]);
  return <span ref={ref}>{format(value)}</span>;
}
