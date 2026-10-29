"use client";

import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { usePointerParallax } from "../../hooks/use-pointer-parallax";

type Cell = readonly [col: number, row: number];

function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t * 9301 + 49297) % 233280;
    return t / 233280;
  };
}

/**
 * A loose, grid-snapped cluster of square tiles that slowly breathe (opacity 0.3–0.9 on random
 * 4–8s loops) and drift with the pointer on desktop. The breathing is a CSS animation so it runs
 * on the compositor; it is skipped for reduced motion. `glass` tiles are frosted; `outline`
 * tiles are hairline-only for empty white areas.
 */
export function GlassTiles({
  cells,
  variant = "glass",
  size = 64,
  gap = 8,
  depth = 1,
  seed = 1,
  className,
}: {
  cells: readonly Cell[];
  variant?: "glass" | "outline";
  size?: number;
  gap?: number;
  depth?: number;
  seed?: number;
  className?: string;
}) {
  const { x, y } = usePointerParallax(Math.min(8, 8 * depth));
  const step = size + gap;
  const cols = Math.max(...cells.map(([c]) => c)) + 1;
  const rows = Math.max(...cells.map(([, r]) => r)) + 1;
  const rand = seeded(seed * 97 + 13);

  const tileClass =
    variant === "glass" ? "glass rounded-[11px]" : "rounded-[11px] border border-hairline";

  return (
    <div aria-hidden className={`pointer-events-none absolute ${className ?? ""}`}>
      <motion.div
        className="relative"
        style={{ x, y, width: cols * step - gap, height: rows * step - gap }}
      >
        {cells.map(([c, r]) => {
          // Each half-cycle is 2–4s and alternates, giving a 4–8s full loop.
          const style = {
            left: c * step,
            top: r * step,
            width: size,
            height: size,
            opacity: 0.6,
            "--dur": `${(2 + rand() * 2).toFixed(2)}s`,
            "--offset": `${(-rand() * 8).toFixed(2)}s`,
          } as CSSProperties;
          return (
            <div key={`${c}-${r}`} className={`tile-breathe absolute ${tileClass}`} style={style} />
          );
        })}
      </motion.div>
    </div>
  );
}
