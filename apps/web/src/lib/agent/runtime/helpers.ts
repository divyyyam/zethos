// Shared formatting, trigger descriptions and abortable timing helpers.
import type { Trigger } from "../intent";
import { ACTIVE, STOPPABLE } from "./constants";
import type { MissionStatus } from "./types";

export function isActive(status: MissionStatus): boolean {
  return ACTIVE.includes(status);
}

export function isStoppable(status: MissionStatus): boolean {
  return STOPPABLE.includes(status);
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

export function decimalString(value: number, decimals: number): string {
  return value.toFixed(Math.min(decimals, 8));
}

export function formatToken(value: number): string {
  const digits = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value < 1 ? 5 : 2,
    maximumFractionDigits: value < 1 ? 5 : 2,
  }).format(value);
}

export function formatBps(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} bps`;
}

export function targetOf(
  trigger: Trigger,
  mid: number,
): { price: number; direction: "below" | "above" } {
  if ("price" in trigger) return { price: trigger.price, direction: trigger.type };
  const drop = trigger.type === "drop";
  return {
    price: mid * (1 + ((drop ? -1 : 1) * trigger.pct) / 100),
    direction: drop ? "below" : "above",
  };
}

export function triggerLabel(trigger: Trigger, target: number): string {
  if (trigger.type === "drop") return `mid drops ${trigger.pct}% to ${formatPrice(target)}`;
  if (trigger.type === "rise") return `mid rises ${trigger.pct}% to ${formatPrice(target)}`;
  return `mid is ${trigger.type} ${formatPrice(target)}`;
}
