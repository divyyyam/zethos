import type { VenueId } from "../config";
import type { PolicyMarketState, VenueSample } from "../policy/types";

type Venue = PolicyMarketState["venues"][number];
export type FreshVenue = Venue & { mid: number };

/** Every signal uses accepted, configured observations available at decision time. */
export function freshVenues(
  market: PolicyMarketState,
  configured: readonly VenueId[],
  staleMs: number,
): FreshVenue[] {
  return market.venues.filter(
    (venue): venue is FreshVenue =>
      configured.includes(venue.venue) &&
      venue.status === "ok" &&
      venue.mid !== null &&
      Number.isFinite(venue.mid) &&
      venue.mid > 0 &&
      Number.isFinite(venue.receivedAt) &&
      venue.receivedAt <= market.now &&
      market.now - venue.receivedAt <= staleMs,
  );
}

export function pastSamples(
  market: PolicyMarketState,
  venue: FreshVenue,
  windowSec: number,
): VenueSample[] {
  return (market.history[venue.venue] ?? []).filter(
    (sample) =>
      Number.isFinite(sample.t) &&
      sample.t >= market.now - windowSec * 1000 &&
      sample.t < venue.receivedAt &&
      Number.isFinite(sample.mid) &&
      sample.mid > 0 &&
      Number.isFinite(sample.bidDepthUsd) &&
      sample.bidDepthUsd >= 0 &&
      Number.isFinite(sample.askDepthUsd) &&
      sample.askDepthUsd >= 0,
  );
}

export function leadMovements(
  market: PolicyMarketState,
  venues: readonly FreshVenue[],
  leads: readonly VenueId[],
  windowSec: number,
): { mid: number; moveBps: number; divergenceBps: number }[] {
  return venues
    .filter((venue) => leads.includes(venue.venue))
    .flatMap((venue) => {
      const baseline = pastSamples(market, venue, windowSec).reduce<VenueSample | undefined>(
        (oldest, sample) => (!oldest || sample.t < oldest.t ? sample : oldest),
        undefined,
      );
      if (!baseline) return [];
      return [
        {
          mid: venue.mid,
          moveBps: (venue.mid / baseline.mid - 1) * 10000,
          divergenceBps: ((venue.mid - market.fused.mid) / market.fused.mid) * 10000,
        },
      ];
    });
}
