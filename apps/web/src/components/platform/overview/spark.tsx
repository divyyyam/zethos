"use client";
import { useMemo } from "react";

export function Spark({ values, label }: { values: number[]; label: string }) {
  const line = useMemo(() => {
    if (values.length < 2) return null;
    const low = Math.min(...values);
    const range = Math.max(...values) - low || 1;
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        return `${x.toFixed(2)},${(26 - ((value - low) / range) * 24).toFixed(2)}`;
      })
      .join(" ");
  }, [values]);
  if (!line) return <span className="d-spark" />;
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="d-spark"
      role="img"
      aria-label={label}
    >
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
