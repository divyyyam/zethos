import type { Fill, QuoteRecord } from "../db";
import type { VaultFillEvent, VaultSnapshot } from "../live";
import { type Inventory, type TokenSymbol, units } from "../tokens";
import { EngineError } from "./errors";
import { nonceKey } from "./helpers";
import { route } from "./market";
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

/** Reads new vault fills, at most once per `maxAgeMs`. Concurrent callers share one read. */
export async function syncLiveFills(
  context: EngineState,
  now: number,
  maxAgeMs = SYNC_INTERVAL_MS,
): Promise<void> {
  const reader = context.deps.live?.readFills;
  if (!reader) return;
  if (context.liveFillsSync) return context.liveFillsSync;
  if (now - context.liveFillsReadAt < maxAgeMs) return;
  context.liveFillsSync = reader()
    .then((events) => {
      context.liveFillsReadAt = now;
      for (const event of events) recordLiveFill(context, event);
      if (events.length > 0 && context.snapshot)
        context.snapshot = { ...context.snapshot, readAt: 0 };
    })
    .catch((error: unknown) => {
      console.warn("Vault fill read failed", error);
    })
    .finally(() => {
      context.liveFillsSync = null;
    });
  return context.liveFillsSync;
}

function recordLiveFill(context: EngineState, event: VaultFillEvent): void {
  const id = `onchain-${event.txHash}-${event.logIndex}`;
  if (context.liveFills.has(id)) return;
  let path: ReturnType<typeof route>;
  try {
    path = route(context, event.tokenIn, event.tokenOut);
  } catch {
    return;
  }
  const { pair, side, base, quote } = path;
  const baseRaw = side === "buy" ? event.amountOut : event.amountIn;
  const quoteRaw = side === "buy" ? event.amountIn : event.amountOut;
  context.openLiveQuotes.delete(`${event.taker.toLowerCase()}:${event.nonce}`);
  context.liveFills.set(id, {
    id,
    quoteId: `onchain-${event.nonce}`,
    policyId: context.policyId,
    ts: event.ts,
    taker: event.taker,
    pair,
    side,
    tokenIn: event.tokenIn,
    tokenOut: event.tokenOut,
    amountIn: event.amountIn.toString(),
    amountOut: event.amountOut.toString(),
    price: units(quoteRaw, quote.decimals) / units(baseRaw, base.decimals),
    midAtFill: null,
    flow: "user",
    paper: false,
    txHash: event.txHash,
  });
}

export function liveFillsFor(context: EngineState, taker: string | undefined): Fill[] {
  const wanted = taker?.toLowerCase();
  return [...context.liveFills.values()].filter(
    (fill) => !wanted || fill.taker.toLowerCase() === wanted,
  );
}
