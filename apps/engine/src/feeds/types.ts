import type { Side, VenueId } from "../config";

export type Level = readonly [price: number, size: number];

export interface Book {
  bids: Level[];
  asks: Level[];
}

export interface Trade {
  id: string;
  price: number;
  size: number;
  side: Side;
  ts: number;
}

export type Health = "ok" | "degraded" | "down";
export type SourceStatus = "ok" | "stale" | "outlier" | "down";

export interface Source {
  venue: VenueId;
  mid: number;
  weight: number;
  status: SourceStatus;
}
