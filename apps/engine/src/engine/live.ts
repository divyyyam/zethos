import type { QuoteRecord } from "../db";
import type { VaultSnapshot } from "../live";
import type { Inventory, TokenSymbol } from "../tokens";
import { EngineError } from "./errors";
import { nonceKey } from "./helpers";
import type { EngineState } from "./state";

// Heartbeats refresh on this cadence. A quote refuses to trust anything older than the limit.
const SYNC_INTERVAL_MS = 10_000;
const MAX_SNAPSHOT_AGE_MS = 15_000;

/** Marks a stored record as a vault quote, so restores keep it out of the paper analytics. */
export const LIVE_SETTLEMENT = "live";

/** Heartbeat refresh. A failed read keeps the last snapshot, and quoting then fails closed on age. */
export async function syncLive(context: EngineState, now: number): Promise<void> {
  const { live } = context.deps;
  if (!live || now - (context.snapshot?.readAt ?? 0) < SYNC_INTERVAL_MS) return;
  try {
    keepNewest(context, await live.read(now));
  } catch (error) {
    console.warn("Vault state read failed", error);
  }
}

/** The durable object sleeps when idle, so the first quote after a wake may need a fresh read. */
export async function freshSnapshot(context: EngineState, now: number): Promise<VaultSnapshot> {
  const { live } = context.deps;
  const current = context.snapshot;
  if (!live || !current) throw new EngineError("warming_up", 503, "Vault state is not loaded yet");
  if (now - current.readAt <= MAX_SNAPSHOT_AGE_MS) return current;
  try {
    const next = await live.read(now);
    keepNewest(context, next);
    return next;
  } catch {
    throw new EngineError("pair_halted", 503, "Vault state is unavailable, so quoting is paused");
  }
}

function keepNewest(context: EngineState, next: VaultSnapshot): void {
  if (!context.snapshot || next.readAt >= context.snapshot.readAt) context.snapshot = next;
}

/** On-chain balances minus what open quotes could still take. Never below zero. */
export function availableInventory(
  context: EngineState,
  snapshot: VaultSnapshot,
  now: number,
): Inventory {
  const available = { ...snapshot.balances };
  for (const [key, open] of context.openLiveQuotes) {
    if (open.expiresAtMs < now) {
      context.openLiveQuotes.delete(key);
      continue;
    }
    available[open.token] =
      available[open.token] > open.amountOut ? available[open.token] - open.amountOut : 0n;
  }
  return available;
}

export function reserveOpenQuote(context: EngineState, record: QuoteRecord, token: TokenSymbol) {
  context.openLiveQuotes.set(nonceKey(record.quote), {
    token,
    amountOut: BigInt(record.quote.amountOut),
    expiresAtMs: Number(record.quote.expiry) * 1000,
  });
}

export function isLiveRecord(record: QuoteRecord): boolean {
  const breakdown = record.breakdown as { settlement?: unknown } | null;
  return breakdown?.settlement === LIVE_SETTLEMENT;
}
