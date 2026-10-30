"use client";

import { useEffect } from "react";

const SIZE = 64;
const LOOP_MS = 3200;
const FRAME_MS = 66;
const INK = "#14113a";
const PEACH = "#ffb48f";
const LILAC = "#b9aeff";

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (t: number) => 1 - (1 - t) ** 4;
const easeIn = (t: number) => t ** 3;

/** One bar in the mark's 32-unit space. `stretch` lengthens it along its travel, as a speed smear. */
function barPath(ctx: CanvasRenderingContext2D, y: number, x: number, stretch: number) {
  const left = 4 + x - stretch / 2;
  const right = 28 + x + stretch / 2;
  ctx.moveTo(left + 6, y);
  ctx.lineTo(right, y);
  ctx.lineTo(right - 6, y + 8);
  ctx.lineTo(left, y + 8);
  ctx.closePath();
}

function bar(ctx: CanvasRenderingContext2D, y: number, x: number, stretch: number, fill: string) {
  ctx.beginPath();
  barPath(ctx, y, x, stretch);
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.stroke();
  ctx.fill();
}

/** Draws "the match" at loop position t (0..1): race in, lock, glint, carry through. */
function draw(ctx: CanvasRenderingContext2D, t: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);

  // Tile. Rounded so it holds up on both light and dark tab strips.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(0, 0, SIZE, SIZE, 15);
  ctx.fill();
  ctx.save();
  ctx.clip();

  const inT = easeOut(span(t, 0, 0.26));
  const outT = easeIn(span(t, 0.82, 1));
  const lockT = span(t, 0.26, 0.42);

  // Jolt on lock: the pair is punched slightly larger, then settles.
  const jolt = 1 + Math.sin(Math.min(1, lockT) * Math.PI) * 0.14 * (1 - lockT);
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.scale(jolt * 2, jolt * 2);
  ctx.translate(-16, -16);
  ctx.lineWidth = 2.6;
  ctx.lineJoin = "round";

  const travel = 42;
  const topX = (1 - inT) * travel - outT * travel;
  const bottomX = -(1 - inT) * travel + outT * travel;
  const smear = (1 - inT) * 26 + outT * 26;

  // Colour runs from the book's two sides to white as the flows meet.
  const settled = span(t, 0.2, 0.32);
  bar(ctx, 6, topX, smear, settled > 0.5 ? "#ffffff" : PEACH);
  bar(ctx, 18, bottomX, smear, settled > 0.5 ? "#ffffff" : LILAC);

  // Glint crossing the locked fill.
  const glint = span(t, 0.46, 0.7);
  if (glint > 0 && glint < 1) {
    const gx = -6 + glint * 44;
    ctx.save();
    ctx.beginPath();
    barPath(ctx, 6, topX, smear);
    barPath(ctx, 18, bottomX, smear);
    ctx.clip();
    ctx.fillStyle = PEACH;
    ctx.beginPath();
    ctx.moveTo(gx + 8, 2);
    ctx.lineTo(gx + 13, 2);
    ctx.lineTo(gx + 5, 30);
    ctx.lineTo(gx, 30);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Spark on the moment of contact.
  const spark = span(t, 0.25, 0.36);
  if (spark > 0 && spark < 1) {
    ctx.beginPath();
    ctx.arc(16, 16, 3 + spark * 22, 0, Math.PI * 2);
    ctx.lineWidth = 2 * (1 - spark);
    ctx.strokeStyle = `rgba(255,255,255,${(1 - spark) * 0.9})`;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Browsers won't animate an SVG favicon (only Firefox does), so the tab icon is drawn to a canvas
 * and republished frame by frame. Our link sits last in <head> so it wins over the static icon.svg,
 * which stays in place for anything that doesn't run this. Reduced motion keeps the static icon.
 * Hidden tabs are throttled by the browser, so this costs almost nothing in the background.
 */
export function AnimatedFavicon() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    const start = performance.now();
    const tick = () => {
      draw(ctx, ((performance.now() - start) % LOOP_MS) / LOOP_MS);
      link.href = canvas.toDataURL("image/png");
      // Keep ours last if the router re-renders head tags on navigation.
      if (document.head.lastElementChild !== link) document.head.appendChild(link);
    };
    tick();
    const id = window.setInterval(tick, FRAME_MS);
    return () => {
      window.clearInterval(id);
      link.remove();
    };
  }, []);
  return null;
}
