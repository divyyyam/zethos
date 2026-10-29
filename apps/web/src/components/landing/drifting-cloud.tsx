import type { CSSProperties } from "react";
import { CloudFallback, SceneryImage } from "./scenery";

/**
 * A cloud that drifts slowly side to side with a gentle bob. Pure CSS animation, so it runs on
 * the compositor and never competes with scroll work. Static for reduced motion.
 */
export function DriftingCloud({
  src,
  tone,
  className,
  distance = 110,
  duration = 72,
  offset = 0,
  intro,
}: {
  src: string | null;
  tone: "peach" | "lavender";
  className?: string;
  distance?: number;
  duration?: number;
  /** Negative values start the loop part-way through. */
  offset?: number;
  /** Fade/scale in on page load after this many seconds. */
  intro?: number;
}) {
  const vars = {
    "--dist": `${distance}px`,
    "--dur": `${duration}s`,
    "--offset": `${offset}s`,
    "--delay": `${intro ?? 0}s`,
  } as CSSProperties;
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute ${intro === undefined ? "" : "intro-cloud"} ${className ?? ""}`}
      style={vars}
    >
      <div className="cloud-drift h-full w-full will-change-transform">
        <div className="cloud-bob h-full w-full">
          <SceneryImage
            src={src}
            className="h-full w-full"
            fit="contain"
            objectPosition="center"
            sizes="(min-width: 768px) 440px, 260px"
            fallback={<CloudFallback tone={tone} className="h-full w-full" />}
          />
        </div>
      </div>
    </div>
  );
}
