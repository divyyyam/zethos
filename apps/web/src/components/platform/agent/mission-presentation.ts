"use client";
import type { MissionStatus, Stage } from "../../../lib/agent/runtime";

export const STATUS_LABEL: Record<MissionStatus, string> = {
  draft: "Awaiting you",
  armed: "Armed",
  running: "Running",
  holding: "Holding",
  measuring: "Measuring",
  done: "Done",
  stopped: "Stopped",
  failed: "Failed",
};

export const STAGE_LABEL: Record<Stage, string> = {
  sense: "Sense",
  price: "Price",
  verify: "Verify",
  guard: "Guard",
  settle: "Settle",
  measure: "Measure",
};

export const STAGE_PLAN: Record<Stage, string> = {
  sense: "Read every venue and the vault",
  price: "Get a firm signed quote",
  verify: "Check the signature and terms itself",
  guard: "Refuse anything over your limit",
  settle: "Fill in the paper vault",
  measure: "See how the price moved after",
};

export const TILT = { stiffness: 140, damping: 18, mass: 0.6 };

export const STATUS_HEADLINE: Record<MissionStatus, string> = {
  draft: "Your limits, *your go-ahead.*",
  armed: "Armed, *and watching.*",
  running: "On it, *right now.*",
  holding: "Holding *for a better price.*",
  measuring: "Filled. *Measuring.*",
  done: "Done, *with receipts.*",
  stopped: "Stopped.",
  failed: "It *refused.*",
};
