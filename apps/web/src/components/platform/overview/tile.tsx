"use client";
import { motion, useReducedMotion } from "motion/react";
import { Spark } from "./spark";

export function Tile({
  label,
  value,
  note,
  spark,
  selected,
  onSelect,
  index,
}: {
  label: string;
  value: React.ReactNode;
  note: string;
  spark: number[];
  selected?: boolean;
  onSelect?: () => void;
  index: number;
}) {
  const still = useReducedMotion();
  const body = (
    <>
      <span className="d-tile-label">{label}</span>
      <strong className="num d-tile-value">{value}</strong>
      <span className="d-tile-note">{note}</span>
      <Spark values={spark} label={`${label} trend`} />
    </>
  );
  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: index * 0.05 }}
    >
      {onSelect ? (
        <button
          type="button"
          className="d-card d-tile"
          aria-pressed={selected}
          data-cursor="hover"
          onClick={onSelect}
        >
          {body}
        </button>
      ) : (
        <div className="d-card d-tile">{body}</div>
      )}
    </motion.div>
  );
}
