import type { Pair, Params, VenueId } from "../config";
import { median, vwap } from "../feeds/fuse";
import type { PolicyInventory, PolicyMarketState, PolicyRequest } from "../policy/types";
import type { PolicyReference, PolicyTerm } from "./schema";
import { type FreshVenue, leadMovements, pastSamples } from "./signals";

export interface PricingConfig {
  spread: Params["spread"];
  quote: Params["quote"];
  tiers: Params["toxicity"]["tiers"];
  sources: Params["feeds"]["sources"];
  tapeSource: Params["feeds"]["tapeSource"];
  staleMs: number;
}

/** Preserve the exact configured binary value when its declarative bps match. */
export function fraction(bps: number, configured?: number): number {
  return configured !== undefined && bps === configured * 10000 ? configured : bps / 10000;
}

export function leadVenues(
  reference: PolicyReference,
  pair: Pair,
  config: PricingConfig,
): VenueId[] {
  return reference.kind === "leadWeighted"
    ? reference.params.leadVenues
    : [config.tapeSource[pair]];
}

export function referencePrice(
  reference: PolicyReference,
  walked: number,
  market: PolicyMarketState,
  venues: FreshVenue[],
): number | null {
  switch (reference.kind) {
    case "depthWeighted":
      return walked;
    case "median":
      return venues.length ? median(venues.map((venue) => venue.mid)) : null;
    case "leadWeighted": {
      const { leadVenues, lookbackSec, leadWeight } = reference.params;
      if (leadWeight === 0) return walked;
      const moved = leadMovements(market, venues, leadVenues, lookbackSec).filter(
        (lead) => lead.moveBps * lead.divergenceBps > 0,
      );
      if (!moved.length) return walked;
      const lead = median(moved.map((lead) => lead.mid));
      return walked * (1 - leadWeight) + lead * leadWeight;
    }
  }
}

export interface ComponentInput {
  market: PolicyMarketState;
  inventory: PolicyInventory;
  request: PolicyRequest;
  sigmaT: number;
  config: PricingConfig;
  venues: FreshVenue[];
  leads: VenueId[];
}

/** Additive components return a spread fraction. Null means restoration depth is unavailable. */
export function contribution(term: PolicyTerm, input: ComponentInput): number | null {
  const { market, inventory, request, sigmaT, config, venues, leads } = input;
  switch (term.kind) {
    case "base": {
      const bps = term.params.bps[request.pair];
      return bps === undefined ? null : fraction(bps, config.spread.base[request.pair]);
    }
    case "vol":
      return term.params.k * sigmaT;
    case "inventory": {
      const skew = inventory.baseShare - inventory.targetShare;
      return term.params.k * (request.side === "sell" ? skew : -skew);
    }
    case "toxicity":
      return term.params.scale * config.tiers[request.tier].sigmaAdd * sigmaT;
    case "depthWithdrawal": {
      const { windowSec, dropPct, addBps } = term.params;
      const key = request.side === "buy" ? "askDepthUsd" : "bidDepthUsd";
      const dropped = venues.some((venue) => {
        const baseline = pastSamples(market, venue, windowSec).reduce(
          (peak, sample) => Math.max(peak, sample[key]),
          0,
        );
        return baseline > 0 && venue[key] >= 0 && venue[key] <= baseline * (1 - dropPct);
      });
      return dropped ? fraction(addBps) : 0;
    }
    case "leadMove": {
      const { thresholdBps, windowSec, addBps } = term.params;
      const direction = request.side === "buy" ? 1 : -1;
      const moved = leadMovements(market, venues, leads, windowSec).some(
        (lead) =>
          direction * lead.moveBps >= thresholdBps &&
          direction * lead.divergenceBps >= thresholdBps,
      );
      return moved ? fraction(addBps) : 0;
    }
    case "restoreCost": {
      if (term.params.k === 0) return 0;
      const totalUsd = inventory.base.usd + inventory.quote.usd;
      if (totalUsd <= 0) return 0;
      const excessUsd = inventory.base.usd - inventory.targetShare * totalUsd;
      if (excessUsd === 0) return 0;
      const restoring = vwap(
        excessUsd > 0 ? market.book.bids : market.book.asks,
        Math.abs(excessUsd) / market.fused.mid,
      );
      if (restoring === null) return null;
      const unitCost =
        excessUsd > 0 ? 1 - restoring / market.fused.mid : restoring / market.fused.mid - 1;
      return term.params.k * (Math.abs(excessUsd) / totalUsd) * Math.max(0, unitCost);
    }
    case "sizeCurve":
      return (
        fraction(term.params.kBps) *
        (request.notionalUsd / config.quote.maxNotionalUsd[request.pair]) ** term.params.exponent
      );
    case "tuner":
      return 0;
  }
}
