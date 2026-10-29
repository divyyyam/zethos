"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Subscribes to a media query. Always `false` during SSR and the first hydration pass. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Reduced-motion preference. Server render assumes motion is allowed so the first paint matches
 * what most visitors get; anything structural is decided in CSS (`motion-reduce:`, `pin:`), so
 * reduced-motion visitors never see a layout jump either.
 */
export function useReducedMotionPref(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** Desktop pointer (mouse/trackpad) on a wide screen: gate for mouse parallax. */
export function useFinePointerDesktop(): boolean {
  return useMediaQuery("(min-width: 1200px) and (hover: hover) and (pointer: fine)");
}
