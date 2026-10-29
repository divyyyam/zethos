import { existsSync } from "node:fs";
import path from "node:path";

export const SCENERY_FILES = {
  heroDay: "hero-day.webp",
  cloud1: "cloud-1.png",
  cloud2: "cloud-2.png",
  cloud3: "cloud-3.png",
  pines: "pines.png",
  ctaNight: "cta-night.webp",
} as const;

export type SceneryKey = keyof typeof SCENERY_FILES;
/** Public URL of each supplied scenery image, or `null` when the SVG/CSS fallback should render. */
export type Scenery = Record<SceneryKey, string | null>;

/**
 * Checks `public/scenery/` at render time (build time for the static landing page) so missing
 * artwork never produces a failed image request; components fall back to vector scenery instead.
 */
export function getScenery(): Scenery {
  const dir = path.join(process.cwd(), "public", "scenery");
  return Object.fromEntries(
    Object.entries(SCENERY_FILES).map(([key, file]) => [
      key,
      existsSync(path.join(dir, file)) ? `/scenery/${file}` : null,
    ]),
  ) as Scenery;
}
