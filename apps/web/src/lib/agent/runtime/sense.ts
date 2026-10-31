// Feed lifecycle and current market observations; stale data stays unavailable.
import type { PairStatus, Status } from "@zethos/sdk";
import { failureMessage } from "../../engine/sdk";
import { FEED_STALE_MS, HISTORY_POINTS, TAPE_ROWS, VENUE_POINTS } from "./constants";
import { isActive } from "./helpers";
import { emit } from "./missions";
import type { RuntimeState } from "./state";
import type { MarketState, Pair } from "./types";

export function retain(context: RuntimeState): () => void {
  context.retained += 1;
  connect(context);
  return () => {
    context.retained -= 1;
    releaseFeedIfIdle(context);
  };
}

export function releaseFeedIfIdle(context: RuntimeState): void {
  if (context.retained > 0 || context.missions.some((mission) => isActive(mission.status))) return;
  context.disconnect?.();
  context.disconnect = null;
}

export function connect(context: RuntimeState): void {
  if (!context.sdk || context.disconnect) return;
  const sdk = context.sdk;
  let open = false;
  const controller = new AbortController();
  const poll = async () => {
    while (!controller.signal.aborted) {
      await refreshStatus(context);
      if (open && context.market.connection === "polling")
        setMarket(context, { connection: "live" });
      await context.sleep(context.pollMs, controller.signal);
    }
  };
  void poll();
  void seed(context);
  const unsubscribe = sdk.stream({
    onOpen: () => {
      open = true;
      setMarket(context, { connection: "live" });
    },
    onClose: () => {
      open = false;
      if (context.market.connection === "live") setMarket(context, { connection: "polling" });
    },
    price: ({ pair, mid, ts }) => {
      if (mid !== null) pushMid(context, pair, mid, ts);
    },
    fill: ({ fill }) => {
      setMarket(context, {
        tape: [fill, ...context.market.tape.filter((row) => row.id !== fill.id)].slice(
          0,
          TAPE_ROWS,
        ),
      });
    },
  });
  context.disconnect = () => {
    controller.abort();
    unsubscribe();
  };
}

export async function seed(context: RuntimeState): Promise<void> {
  if (!context.sdk) return;
  try {
    const tape = await context.sdk.fills({ limit: TAPE_ROWS });
    const known = new Set(context.market.tape.map((row) => row.id));
    setMarket(context, {
      tape: [...context.market.tape, ...tape.filter((row) => !known.has(row.id))].slice(
        0,
        TAPE_ROWS,
      ),
    });
  } catch {
    /* The tape fills in from the stream; a failed backfill leaves it empty, not fabricated. */
  }
  const since = context.now() - 15 * 60_000;
  for (const pair of ["HSK/USDT", "ETH/USDT"] as const) {
    try {
      const { series } = await context.sdk.stats({ pair, from: since, to: context.now() });
      const recent = context.market.history[pair] ?? [];
      const first = recent[0]?.t ?? Number.POSITIVE_INFINITY;
      setMarket(context, {
        history: {
          ...context.market.history,
          [pair]: [...series.filter((point) => point.t < first), ...recent].slice(-HISTORY_POINTS),
        },
      });
    } catch {
      /* History starts from now instead. */
    }
  }
}

export async function refreshStatus(context: RuntimeState): Promise<Status | null> {
  if (!context.sdk) return null;
  try {
    const status = await context.sdk.status();
    const at = context.now();
    const venues = { ...context.market.venues };
    for (const pair of status.pairs) {
      if (pair.mid === null) continue;
      const traces = { ...(venues[pair.pair] ?? {}) };
      for (const source of pair.sources) {
        if (source.status !== "ok") continue;
        traces[source.venue] = [
          ...(traces[source.venue] ?? []),
          { t: at, bps: (source.mid / pair.mid - 1) * 10_000 },
        ].slice(-VENUE_POINTS);
      }
      venues[pair.pair] = traces;
      pushMid(context, pair.pair, pair.mid, pair.updatedAt ?? at);
    }
    setMarket(context, {
      status,
      venues,
      error: null,
      updatedAt: at,
      connection: context.market.connection === "live" ? "live" : "polling",
    });
    return status;
  } catch (error) {
    setMarket(context, { error: failureMessage(error), connection: "offline" });
    return null;
  }
}

export function pushMid(context: RuntimeState, pair: Pair, mid: number, t: number): void {
  const series = context.market.history[pair] ?? [];
  const last = series.at(-1);
  if (last && t <= last.t) return;
  setMarket(context, {
    updatedAt: context.now(),
    history: {
      ...context.market.history,
      [pair]: [...series, { t, mid }].slice(-HISTORY_POINTS),
    },
  });
}

export function setMarket(context: RuntimeState, next: Partial<MarketState>): void {
  context.market = { ...context.market, ...next };
  emit(context);
}

export function latestMid(context: RuntimeState, pair: Pair): number | null {
  if (context.now() - context.market.updatedAt > FEED_STALE_MS) return null;
  return context.market.history[pair]?.at(-1)?.mid ?? null;
}

export function pairStatus(context: RuntimeState, pair: Pair): PairStatus | null {
  return context.market.status?.pairs.find((row) => row.pair === pair) ?? null;
}
