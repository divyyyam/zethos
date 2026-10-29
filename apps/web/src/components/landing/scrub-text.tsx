"use client";

import { type MotionValue, motion, useTransform } from "motion/react";

function Word({
  word,
  index,
  count,
  progress,
}: {
  word: string;
  index: number;
  count: number;
  progress: MotionValue<number>;
}) {
  // Each word fades in over a window that overlaps its neighbours, so the line reads as one wave.
  const span = 1 / count;
  const start = index * span * 0.75;
  const opacity = useTransform(progress, [start, start + span * 1.6], [0.1, 1]);
  return (
    <motion.span className="scrub inline-block will-change-[opacity]" style={{ opacity }}>
      {word}
    </motion.span>
  );
}

/** Text whose words light up one after another as `progress` runs 0 → 1. */
export function ScrubText({ text, progress }: { text: string; progress: MotionValue<number> }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((word, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: words are static copy and may repeat
        <span key={i}>
          <Word word={word} index={i} count={words.length} progress={progress} />
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}
