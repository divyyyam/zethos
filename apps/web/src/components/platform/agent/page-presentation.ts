"use client";
import type { MissionStatus } from "../../../lib/agent/runtime";
import type { WorldState } from "../../world/world-canvas";

export const CONNECTION: Record<string, string> = {
  live: "Live",
  polling: "Polling",
  connecting: "Connecting",
  offline: "Engine offline",
  unconfigured: "No engine",
};

/** The world follows the agent: the hour and the depth curve say what it's doing. */
export function worldFor(status: MissionStatus | undefined): WorldState {
  switch (status) {
    case "draft":
      return { day: 0.3, cam: 0.13, morph: 0, lake: 1 };
    case "armed":
      return { day: 0.82, cam: 0.13, morph: 0, lake: 1 };
    case "running":
    case "holding":
      return { day: 0.45, cam: 0.04, morph: 1, lake: 0 };
    case "measuring":
      return { day: 0.58, cam: 0.04, morph: 1, lake: 0 };
    case "done":
      return { day: 0.68, cam: 0.13, morph: 0, lake: 1 };
    case "stopped":
    case "failed":
      return { day: 1, cam: -0.05, morph: 0, lake: 1 };
    default:
      return { day: 0.05, cam: 0.13, morph: 0, lake: 1 };
  }
}
