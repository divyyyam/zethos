import { VENUES, type Venue } from "../../engine/src/feeds/venues.js";
import type { ScenarioRecorder } from "./recorder.js";
import type {
  Pair,
  ScenarioBookRecord,
  ScenarioRecord,
  ScenarioTradeRecord,
  VenueId,
} from "./types.js";

export const DEFAULT_PAIR_VENUES: Record<Pair, VenueId[]> = {
  "HSK/USDT": ["hashkey-global", "gate"],
  "ETH/USDT": ["binance", "okx", "hashkey-global"],
};

export class BoundedIdSet {
  private set = new Set<string>();
  private list: string[] = [];

  constructor(private readonly max = 5000) {}

  has(id: string): boolean {
    return this.set.has(id);
  }

  add(id: string): void {
    if (this.set.has(id)) return;
    this.set.add(id);
    this.list.push(id);
    if (this.list.length > this.max) {
      const oldest = this.list.shift();
      if (oldest !== undefined) this.set.delete(oldest);
    }
  }

  get size(): number {
    return this.set.size;
  }
}

export interface VenueStatus {
  venue: VenueId;
  healthy: boolean;
  successCount: number;
  errorCount: number;
  lastTs: number | null;
  lastError: string | null;
}

export interface MarketFeedCollectorOptions {
  pair: Pair;
  venues?: VenueId[] | undefined;
  pollIntervalMs?: number | undefined;
  timeoutMs?: number | undefined;
  fetchFn?: typeof fetch | undefined;
  recorder: ScenarioRecorder;
  bookLevels?: number | undefined;
  onObservation?: ((record: ScenarioRecord) => void) | undefined;
  onError?: ((err: Error, venue: VenueId) => void) | undefined;
}

/**
 * MarketFeedCollector collects order books (with depth) and public trades directly
 * from public exchange REST endpoints.
 *
 * NOTE: This is the recorder's direct public exchange view, NOT the engine-exposed view.
 * Public engine endpoints only expose top-level status and fused mid and do not expose
 * per-venue depth or public trades. Recorder feed observations and engine internal
 * feed state are subject to different network hops, rate limits, and timing jitter,
 * and should never be assumed to be identical.
 */
export class MarketFeedCollector {
  readonly pair: Pair;
  readonly venues: VenueId[];
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  readonly bookLevels: number;

  private readonly recorder: ScenarioRecorder;
  private readonly fetchFn: typeof fetch;
  private readonly onObservation?: ((record: ScenarioRecord) => void) | undefined;
  private readonly onError?: ((err: Error, venue: VenueId) => void) | undefined;

  private timer: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private stopped = false;
  private abortController = new AbortController();

  private readonly seenTradeIds = new BoundedIdSet(10000);
  private readonly venueStatuses = new Map<VenueId, VenueStatus>();

  constructor(options: MarketFeedCollectorOptions) {
    this.pair = options.pair;
    this.venues = options.venues ?? DEFAULT_PAIR_VENUES[this.pair];
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.bookLevels = options.bookLevels ?? 20;
    this.recorder = options.recorder;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.onObservation = options.onObservation;
    this.onError = options.onError;

    for (const v of this.venues) {
      this.venueStatuses.set(v, {
        venue: v,
        healthy: false,
        successCount: 0,
        errorCount: 0,
        lastTs: null,
        lastError: null,
      });
    }
  }

  async start(): Promise<void> {
    if (this.stopped) {
      throw new Error("Cannot start stopped MarketFeedCollector");
    }

    // Initial poll
    await this.pollOnce();

    if (this.pollIntervalMs > 0 && !this.stopped) {
      this.timer = setInterval(() => {
        if (!this.isPolling && !this.stopped) {
          this.pollOnce().catch(() => {});
        }
      }, this.pollIntervalMs);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.abortController.abort();
  }

  async pollOnce(): Promise<number> {
    if (this.stopped) return 0;
    this.isPolling = true;

    try {
      const results = await Promise.allSettled(
        this.venues.map((venueId) => this.pollVenue(venueId)),
      );

      let totalObs = 0;
      for (const res of results) {
        if (res.status === "fulfilled") {
          totalObs += res.value;
        }
      }
      return totalObs;
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchVenueBook(venueId: VenueId, venue: Venue): Promise<number> {
    const bookSignal = AbortSignal.any([
      this.abortController.signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);

    const bookRes = await this.fetchFn(venue.bookUrl(this.pair, this.bookLevels), {
      signal: bookSignal,
    });

    if (!bookRes.ok) {
      throw new Error(`HTTP ${bookRes.status} from ${venueId} orderbook`);
    }

    const bookJson = await bookRes.json();
    const parsedBook = venue.parseBook(bookJson);

    if (parsedBook.bids.length > 0 && parsedBook.asks.length > 0) {
      const bookRecord: ScenarioBookRecord = {
        type: "book",
        ts: Date.now(),
        pair: this.pair,
        venue: venueId,
        book: {
          bids: parsedBook.bids.slice(0, this.bookLevels) as [number, number][],
          asks: parsedBook.asks.slice(0, this.bookLevels) as [number, number][],
        },
      };

      this.recorder.recordBook(bookRecord);
      this.onObservation?.(bookRecord);
      return 1;
    }

    return 0;
  }

  private async fetchVenueTrades(venueId: VenueId, venue: Venue): Promise<number> {
    const tradeSignal = AbortSignal.any([
      this.abortController.signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);

    const tradesRes = await this.fetchFn(venue.tradesUrl(this.pair), {
      signal: tradeSignal,
    });

    if (!tradesRes.ok) {
      return 0;
    }

    const tradesJson = await tradesRes.json();
    const parsedTrades = venue.parseTrades(tradesJson);
    let count = 0;

    for (const t of parsedTrades) {
      if (!this.seenTradeIds.has(t.id)) {
        this.seenTradeIds.add(t.id);

        const tradeRecord: ScenarioTradeRecord = {
          type: "trade",
          ts: Math.min(t.ts, Date.now()),
          pair: this.pair,
          venue: venueId,
          trade: {
            id: t.id,
            ts: t.ts,
            side: t.side,
            price: t.price,
            size: t.size,
          },
        };

        this.recorder.recordTrade(tradeRecord);
        this.onObservation?.(tradeRecord);
        count++;
      }
    }

    return count;
  }

  private async pollVenue(venueId: VenueId): Promise<number> {
    const venue = VENUES[venueId] as Venue | undefined;
    if (!venue) return 0;

    const status = this.venueStatuses.get(venueId);
    let count = 0;

    try {
      count += await this.fetchVenueBook(venueId, venue);
      count += await this.fetchVenueTrades(venueId, venue);

      if (status) {
        status.healthy = true;
        status.successCount++;
        status.lastTs = Date.now();
        status.lastError = null;
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (status) {
        status.healthy = false;
        status.errorCount++;
        status.lastError = error.message;
      }
      this.onError?.(error, venueId);
    }

    return count;
  }

  getVenueStatuses(): VenueStatus[] {
    return Array.from(this.venueStatuses.values());
  }

  getHealthyVenueCount(): number {
    let healthy = 0;
    for (const s of this.venueStatuses.values()) {
      if (s.healthy) healthy++;
    }
    return healthy;
  }
}
