import type { Params } from "../config";
import { vwap, vwapForQuote } from "../feeds/fuse";
import { priceSwap, ttlSeconds } from "../pricing";
import type { Policy } from "./types";

/** The incumbent keeps the original floating-point operation order exactly. */
export function createV0(params: Params): Policy {
  // Bind pricing data only. No dependency, signer, identity or engine state enters a policy.
  const spread = structuredClone(params.spread);
  const quote = structuredClone(params.quote);
  const tiers = structuredClone(params.toxicity.tiers);
  return {
    id: "v0",
    decide(market, inventory, request) {
      if (market.fused.health === "down") return { kind: "reject", reason: "halted" };
      const ref =
        request.side === "buy"
          ? vwapForQuote(market.book.asks, request.notionalUsd)
          : vwap(market.book.bids, request.baseQuantity);
      if (ref === null) return { kind: "reject", reason: "insufficient_reference_depth" };
      const tier = tiers[request.tier];
      const ttlSec = ttlSeconds(market.fused.sigma1, tier.ttlSec, quote);
      const priced = priceSwap(
        {
          side: request.side,
          ref,
          sigma1: market.fused.sigma1,
          ttlSec,
          baseShare: inventory.baseShare,
          degraded: market.fused.health === "degraded",
          tier,
          tuner: market.tuner,
          baseSpread: spread.base[request.pair],
        },
        spread,
        inventory.targetShare,
      );
      return {
        kind: "quote",
        price: priced.price,
        ref,
        halfSpread: priced.half,
        sigmaT: priced.sigmaT,
        ttlSec,
        terms: { ...priced.terms },
      };
    },
  };
}
