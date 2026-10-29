"use client";

import { motion, useSpring } from "motion/react";
import { type ReactNode, useRef } from "react";
import { useFinePointerDesktop, useReducedMotionPref } from "../../hooks/use-media-query";

const SPRING = { stiffness: 220, damping: 16, mass: 0.4 };

/**
 * Leans its child toward the pointer while hovered and springs back on leave. The outer box is
 * measured (it never moves), the inner one is translated, so the pull can't feed back into the
 * measurement. Desktop pointers only; inert for touch and reduced motion.
 */
export function Magnetic({
  children,
  strength = 0.3,
  className,
}: {
  children: ReactNode;
  /** Fraction of the pointer's offset from centre that the child follows. */
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const desktop = useFinePointerDesktop();
  const reduced = useReducedMotionPref();
  const enabled = desktop && !reduced;
  const x = useSpring(0, SPRING);
  const y = useSpring(0, SPRING);

  return (
    <div
      ref={ref}
      className={`inline-flex ${className ?? ""}`}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!enabled || !el || e.pointerType !== "mouse") return;
        const r = el.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      <motion.div className="inline-flex" style={{ x, y }}>
        {children}
      </motion.div>
    </div>
  );
}
