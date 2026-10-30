import { useId } from "react";

/** The two bars, in the mark's 32-unit space. */
const TOP = "M11 5.5 H28.5 L22.5 13.5 H5Z";
const BOTTOM = "M9.5 18.5 H27 L21 26.5 H3.5Z";

/**
 * Zethos mark: two parallelogram bars forming an abstract "Z", two order flows meeting.
 * `live` plays "the match" on a loop: the flows race in from opposite edges, smear with speed, lock
 * with a jolt, a glint crosses the fill, then they carry on through and leave. `hover` plays it only
 * while a parent `.group` is hovered. Same choreography as the favicon (animated-favicon.tsx).
 */
export function LogoMark({ className, motion }: { className?: string; motion?: "live" | "hover" }) {
  const id = useId();
  if (!motion) {
    return (
      <svg
        aria-hidden
        className={className}
        viewBox="0 0 32 32"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d={TOP} />
        <path d={BOTTOM} />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden
      className={`logo-match ${motion === "live" ? "logo-live" : "logo-hover"} ${className ?? ""}`}
      viewBox="0 0 32 32"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <clipPath id={id}>
        <path d={TOP} className="logo-bar-top" />
        <path d={BOTTOM} className="logo-bar-bottom" />
      </clipPath>
      <g className="logo-jolt">
        <path d={TOP} className="logo-bar-top" />
        <path d={BOTTOM} className="logo-bar-bottom" />
      </g>
      <g clipPath={`url(#${id})`}>
        <rect x="-8" y="-4" width="5" height="40" className="logo-glint" />
      </g>
    </svg>
  );
}
