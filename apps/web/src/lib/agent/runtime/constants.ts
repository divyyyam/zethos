import type { MissionStatus } from "./types";

export const STAGES = ["sense", "price", "verify", "guard", "settle", "measure"] as const;

export const DEFAULT_MAX_COST_BPS = 150;

export const DEFAULT_HOLD_MS = 60_000;

export const DEFAULT_TRIGGER_MS = 15 * 60_000;

export const MARKOUT_HORIZONS = [1, 5, 30] as const;

/** The engine's smallest swap is $5; slices stay clear of it so a mid move can't strand one. */
export const MIN_SLICE_USD = 6;

export const HOLD_RETRY_MS = 5_000;

export const TRIGGER_TICK_MS = 1_000;

export const FEED_STALE_MS = 15_000;

export const STATUS_POLL_MS = 3_000;

export const HISTORY_POINTS = 600;

export const VENUE_POINTS = 120;

export const TAPE_ROWS = 30;

export const LADDER_USD = [100, 500, 2_000, 10_000, 25_000];

export const ACTIVE: MissionStatus[] = ["armed", "running", "holding", "measuring"];

export const STOPPABLE: MissionStatus[] = ["armed", "running", "holding"];
