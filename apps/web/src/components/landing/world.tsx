"use client";

import { useMotionValueEvent } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { WorldCanvas, type WorldState } from "../world/world-canvas";
import { useLandingScroll } from "./scroll";

interface Anchor extends WorldState {
  y: number;
  chapter: string;
}

/** Past this time of day the no-WebGL fallback swaps to its night gradient. */
const NIGHT_AT = 0.6;
const SUNRISE_MINUTES = 5 * 60 + 42;
const CLOCK_SPAN_MINUTES = 17 * 60 + 28;

const smooth = (t: number) => t * t * (3 - 2 * t);

function parseKey(key: string) {
  const [day = 0, cam = 0, morph = 0, lake = 1] = key.split(",").map(Number);
  return { day, cam, morph, lake };
}

/**
 * Binds the world to the page. A section declares what the world looks like while it is on screen:
 * `data-world="day,cam,morph,lake|..."`, with keys spread evenly across its scroll range. Between
 * sections the world interpolates, so the page reads as one continuous day. This component also
 * drives the nav's clock and chapter directly through the DOM, keeping React out of the scroll path.
 */
export function LandingWorld() {
  const { scrollY, onLayout } = useLandingScroll();
  const state = useRef<WorldState>({ day: 0, cam: 0, morph: 0, lake: 1 });
  const anchors = useRef<Anchor[]>([]);
  const hud = useRef({ clock: "", chapter: "", phase: "" });

  const apply = useCallback((y: number) => {
    const list = anchors.current;
    const first = list[0];
    if (!first) return;
    let i = 0;
    while (i < list.length - 2 && y > (list[i + 1] as Anchor).y) i++;
    const a = list[i] as Anchor;
    const b = (list[i + 1] ?? a) as Anchor;
    const span = b.y - a.y;
    const t = span > 0 ? smooth(Math.min(1, Math.max(0, (y - a.y) / span))) : 0;
    const s = state.current;
    s.day = a.day + (b.day - a.day) * t;
    s.cam = a.cam + (b.cam - a.cam) * t;
    s.morph = a.morph + (b.morph - a.morph) * t;
    s.lake = a.lake + (b.lake - a.lake) * t;

    const minutes = Math.round(SUNRISE_MINUTES + s.day * CLOCK_SPAN_MINUTES);
    const clock = `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const chapter = (y > b.y ? b : y >= a.y + span * 0.5 ? b : a).chapter;
    const phase = s.day >= NIGHT_AT ? "night" : "day";
    if (clock !== hud.current.clock) {
      hud.current.clock = clock;
      for (const el of document.querySelectorAll("[data-hud-clock]")) el.textContent = clock;
    }
    if (chapter !== hud.current.chapter) {
      hud.current.chapter = chapter;
      for (const el of document.querySelectorAll("[data-hud-chapter]")) el.textContent = chapter;
    }
    if (phase !== hud.current.phase) {
      hud.current.phase = phase;
      document.querySelector("[data-landing]")?.setAttribute("data-phase", phase);
    }
  }, []);

  useEffect(
    () =>
      onLayout(() => {
        const vh = window.innerHeight;
        const next: Anchor[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("[data-world]")) {
          const keys = (el.dataset.world ?? "").split("|").map(parseKey);
          const top = el.getBoundingClientRect().top + window.scrollY;
          const bottom = top + el.offsetHeight;
          const pinned = el.dataset.worldPin !== undefined;
          const start = pinned ? top : Math.max(0, top - vh * 0.3);
          const end = pinned ? bottom - vh : Math.max(start + 1, bottom - vh * 0.7);
          keys.forEach((key, i) => {
            const at = keys.length > 1 ? i / (keys.length - 1) : 0;
            next.push({ ...key, y: start + (end - start) * at, chapter: el.dataset.chapter ?? "" });
          });
        }
        anchors.current = next.sort((a, b) => a.y - b.y);
        apply(window.scrollY);
      }),
    [onLayout, apply],
  );

  useMotionValueEvent(scrollY, "change", apply);

  // The world is only seen through windows, so it stops drawing while none are on screen.
  useEffect(() => {
    const showing = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) showing.add(entry.target);
        else showing.delete(entry.target);
      }
      state.current.idle = showing.size === 0;
    });
    for (const el of document.querySelectorAll(".world-window, [data-world-view]"))
      observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Shown until, or instead of, the first WebGL frame. Flat skies, so ink always reads. */}
      <div aria-hidden className="world-fallback world-fallback-day" />
      <div aria-hidden className="world-fallback world-fallback-night" />
      <WorldCanvas state={state} className="world-canvas" />
    </>
  );
}
