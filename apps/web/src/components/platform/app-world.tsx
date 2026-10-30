"use client";

import { useRef } from "react";
import { WorldCanvas, type WorldState } from "../world/world-canvas";

/** The same world the landing page ends on: the app lives in its night, with the range held low. */
export function AppWorld() {
  const state = useRef<WorldState>({ day: 1, cam: 0.34, morph: 0, lake: 1 });
  return <WorldCanvas state={state} className="world-canvas" />;
}
