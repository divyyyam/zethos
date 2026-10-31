import type { VenueId } from "../config";
import type { Book, Health, Level, Source, SourceStatus } from "./types";

export interface VenueState {
  venue: VenueId;
  book: Book | null;
  at: number; // ms of the last successful book
}

export interface Fused {
  mid: number | null;
  health: Health;
  sources: Source[];
  book: Book | null; // merged book of the sources used for the mid
}

export interface FuseOptions {
  staleMs: number;
  maxDisagreement: number;
  minSources: number;
}

const DEPTH_BAND = 0.005;

export function midOf(book: Book): number | null {
  const bid = book.bids[0]?.[0];
  const ask = book.asks[0]?.[0];
  return bid !== undefined && ask !== undefined && ask > bid ? (bid + ask) / 2 : null;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

// Quote-currency liquidity within ±0.5% of mid; used to weight venues.
export function depthNear(book: Book, mid: number): number {
  const low = mid * (1 - DEPTH_BAND);
  const high = mid * (1 + DEPTH_BAND);
  const sum = (levels: Level[], inBand: (price: number) => boolean) =>
    levels.reduce((total, [price, size]) => (inBand(price) ? total + price * size : total), 0);
  return sum(book.bids, (price) => price >= low) + sum(book.asks, (price) => price <= high);
}

export function mergeBooks(books: Book[]): Book {
  return {
    bids: books.flatMap((book) => book.bids).sort((a, b) => b[0] - a[0]),
    asks: books.flatMap((book) => book.asks).sort((a, b) => a[0] - b[0]),
  };
}

interface Candidate {
  state: VenueState;
  mid: number;
  status: SourceStatus;
}

export function fuse(states: VenueState[], now: number, options: FuseOptions): Fused {
  const candidates = states.map((state): Candidate => {
    const mid = state.book ? midOf(state.book) : null;
    const status = mid === null ? "down" : now - state.at > options.staleMs ? "stale" : "ok";
    return { state, mid: mid ?? 0, status };
  });

  const fresh = candidates.filter((candidate) => candidate.status === "ok");
  if (fresh.length > 0) {
    const center = median(fresh.map((candidate) => candidate.mid));
    for (const candidate of fresh) {
      if (Math.abs(candidate.mid - center) / center > options.maxDisagreement) {
        candidate.status = "outlier";
      }
    }
  }

  const used = candidates.filter((candidate) => candidate.status === "ok");
  const depths = used.map((candidate) => depthNear(candidate.state.book as Book, candidate.mid));
  const totalDepth = depths.reduce((sum, depth) => sum + depth, 0);
  const weightOf = (index: number) =>
    totalDepth > 0 ? (depths[index] as number) / totalDepth : 1 / used.length;

  const sources: Source[] = candidates.map((candidate) => {
    const index = used.indexOf(candidate);
    return {
      venue: candidate.state.venue,
      mid: candidate.mid,
      weight: index >= 0 ? weightOf(index) : 0,
      status: candidate.status,
    };
  });

  if (used.length === 0) return { mid: null, health: "down", sources, book: null };

  const mid = used.reduce((sum, candidate, index) => sum + candidate.mid * weightOf(index), 0);
  const health: Health = used.length >= options.minSources ? "ok" : "degraded";
  const book = mergeBooks(used.map((candidate) => candidate.state.book as Book));
  return { mid, health, sources, book };
}

// Volume-weighted price to fill `quantity` base units against `levels`, or null if too thin.
export function vwap(levels: Level[], quantity: number): number | null {
  let remaining = quantity;
  let cost = 0;
  for (const [price, size] of levels) {
    const take = Math.min(size, remaining);
    cost += take * price;
    remaining -= take;
    if (remaining <= 0) return cost / quantity;
  }
  return null;
}

// Buy requests specify quote currency to spend, so walk asks by cost rather than
// guessing base quantity from mid (which overstates size when the book has impact).
export function vwapForQuote(levels: Level[], budget: number): number | null {
  let remaining = budget;
  let quantity = 0;
  for (const [price, size] of levels) {
    const cost = Math.min(remaining, price * size);
    quantity += cost / price;
    remaining -= cost;
    if (remaining <= budget * 1e-12) return budget / quantity;
  }
  return null;
}
