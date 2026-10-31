"use client";
import { queueIntent } from "../../../hooks/platform/use-agent";
import { formatUsd } from "../../../lib/platform-config";

export const FLOWS = ["tape", "user", "agent", "attacker"] as const;

export type FlowName = (typeof FLOWS)[number];

export const FLOW_LABEL: Record<FlowName, string> = {
  tape: "Exchange tape",
  user: "People",
  agent: "AI agents",
  attacker: "Attacker",
};

// Validated with the dataviz palette checks on the white surface.
export const FLOW_COLOR: Record<FlowName, string> = {
  tape: "#1f8a66",
  user: "#2b7cc4",
  agent: "#5b4fd1",
  attacker: "#b86a1f",
};

export const RANGES = [
  { key: "5m", label: "5m", ms: 5 * 60_000 },
  { key: "15m", label: "15m", ms: 15 * 60_000 },
  { key: "1h", label: "1h", ms: 3_600_000 },
  { key: "all", label: "All", ms: Number.POSITIVE_INFINITY },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

export type View = "equity" | "pnl" | "flow";

export const clock = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour12: false });

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export const signedUsd = (value: number) =>
  `${value >= 0 ? "+" : "−"}${formatUsd(Math.abs(value))}`;

/** The real hour on the real world: dawn at 05:42, night by 23:10, as the landing's clock runs. */
export function dayFromClock(date: Date): number {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const shifted = (minutes - (5 * 60 + 42) + 1440) % 1440;
  return Math.min(1, shifted / (17 * 60 + 28));
}

export function greeting(hour: number) {
  if (hour < 5) return "Still up.";
  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
}

export function queueAndGo(sentence: string) {
  queueIntent(sentence);
  navigate?.("/agent");
}

let navigate: ((href: string) => void) | null = null;
export function setNavigate(next: (href: string) => void): void {
  navigate = next;
}
