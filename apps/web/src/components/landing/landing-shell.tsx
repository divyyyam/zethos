"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { ScrollProvider } from "./scroll";

/** Landing-wide motion settings: honours prefers-reduced-motion and runs the shared Lenis clock. */
export function LandingShell({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <ScrollProvider>
        <div data-landing>{children}</div>
      </ScrollProvider>
    </MotionConfig>
  );
}
