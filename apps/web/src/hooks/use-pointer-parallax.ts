"use client";

import {
  type MotionValue,
  motionValue,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect } from "react";
import { useFinePointerDesktop, useReducedMotionPref } from "./use-media-query";

// One pointer listener for the whole page, shared by every parallax consumer and ref-counted so it
// detaches when the last one unmounts. Values are normalised to -1…1 across the viewport.
const pointerX = motionValue(0);
const pointerY = motionValue(0);
let subscribers = 0;

function onMove(e: PointerEvent) {
  pointerX.set((e.clientX / window.innerWidth) * 2 - 1);
  pointerY.set((e.clientY / window.innerHeight) * 2 - 1);
}

function subscribe() {
  if (subscribers++ === 0) window.addEventListener("pointermove", onMove, { passive: true });
  return () => {
    if (--subscribers === 0) {
      window.removeEventListener("pointermove", onMove);
      pointerX.set(0);
      pointerY.set(0);
    }
  };
}

const SPRING = { stiffness: 60, damping: 20, mass: 0.6 };

/**
 * Pointer position mapped to an `x`/`y` offset of up to `max` px, smoothed with a spring.
 * Inert (always 0) on touch, small screens and with reduced motion.
 */
export function usePointerParallax(max = 8): { x: MotionValue<number>; y: MotionValue<number> } {
  const desktop = useFinePointerDesktop();
  const reduced = useReducedMotionPref();
  const enabled = desktop && !reduced;

  useEffect(() => (enabled ? subscribe() : undefined), [enabled]);

  const x = useSpring(
    useTransform(pointerX, (v) => v * max),
    SPRING,
  );
  const y = useSpring(
    useTransform(pointerY, (v) => v * max),
    SPRING,
  );
  return { x, y };
}
