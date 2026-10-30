"use client";

import { motion, useMotionValue, useSpring } from "motion/react";
import { useEffect, useState } from "react";
import { useFinePointerDesktop, useReducedMotionPref } from "../../hooks/use-media-query";

const FOLLOW = { stiffness: 520, damping: 40, mass: 0.35 };

/** A ring trailing the real pointer, which stays visible. It opens over controls and names drags. */
export function Cursor() {
  const desktop = useFinePointerDesktop();
  const reduced = useReducedMotionPref();
  const enabled = desktop && !reduced;
  const x = useSpring(useMotionValue(-100), FOLLOW);
  const y = useSpring(useMotionValue(-100), FOLLOW);
  const [mode, setMode] = useState<"idle" | "hover" | "drag">("idle");

  useEffect(() => {
    if (!enabled) return;
    const onMove = (event: PointerEvent) => {
      x.set(event.clientX);
      y.set(event.clientY);
      const target = (event.target as Element | null)?.closest?.("[data-cursor]");
      setMode((target?.getAttribute("data-cursor") as "hover" | "drag" | undefined) ?? "idle");
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [enabled, x, y]);

  if (!enabled) return null;
  const size = mode === "drag" ? 72 : mode === "hover" ? 52 : 26;
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-[90] flex items-center justify-center rounded-full border border-white mix-blend-difference"
      style={{ x, y, translateX: "-50%", translateY: "-50%" }}
      animate={{ width: size, height: size }}
      transition={{ type: "spring", stiffness: 340, damping: 28 }}
    >
      {mode === "drag" && <span className="text-[11px] font-medium text-white">Drag</span>}
    </motion.div>
  );
}
