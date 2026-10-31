import { defaultParams, type Params } from "../config";
import { vwap, vwapForQuote } from "../feeds/fuse";
import { defaultMandate, loadMandate, type Mandate } from "../policy/mandate";
import type { Policy } from "../policy/types";
import { ttlSeconds } from "../pricing";
import {
  contribution,
  fraction,
  leadVenues,
  type PricingConfig,
  referencePrice,
} from "./components";
import { policySpecSchema } from "./schema";
import { freshVenues } from "./signals";

export interface CompileOptions {
  params?: Params;
  mandate?: Mandate;
}
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Compile validated data into a pure function; candidates can never supply executable code. */
export function compile(input: unknown, options: CompileOptions = {}): Policy {
  const spec = policySpecSchema.parse(input);
  const params = options.params ?? defaultParams;
  const mandate = loadMandate(options.mandate ?? defaultMandate);
  for (const pair of spec.pairs) {
    if (!params.pairs.includes(pair) || !mandate.pairs.includes(pair))
      throw new Error(`Policy pair ${pair} is outside the enabled desk mandate`);
    if (
      spec.reference.kind === "leadWeighted" &&
      spec.reference.params.leadVenues.some((venue) => !params.feeds.sources[pair].includes(venue))
    )
      throw new Error(`Policy lead venues must be configured for ${pair}`);
  }
  const serviceCap = Math.min(...mandate.service.maxHalfSpreadBps.map((bucket) => bucket.maxBps));
  if (
    spec.clamp.minBps < params.spread.min * 10000 ||
    spec.clamp.maxBps > params.spread.max * 10000 ||
    spec.clamp.maxBps > serviceCap
  )
    throw new Error("Policy clamp exceeds owner spread or mandate limits");
  if (spec.ttl.maxSec < params.quote.minTtlSec || spec.ttl.minSec > params.quote.ttlSec)
    throw new Error("Policy TTL has no overlap with owner lifetime limits");
  const config: PricingConfig = structuredClone({
    spread: params.spread,
    quote: params.quote,
    tiers: params.toxicity.tiers,
    sources: params.feeds.sources,
    tapeSource: params.feeds.tapeSource,
    staleMs: params.feeds.staleMs,
  });
  const quoteConfig = {
    ...config.quote,
    ttlVolK: spec.ttl.ttlVolK,
    ttlSec: Math.min(config.quote.ttlSec, spec.ttl.maxSec),
    minTtlSec: Math.max(config.quote.minTtlSec, spec.ttl.minSec),
    maxTtlSec: Math.min(config.quote.maxTtlSec, spec.ttl.maxSec),
  };
  const min = fraction(spec.clamp.minBps, config.spread.min);
  const max = fraction(spec.clamp.maxBps, config.spread.max);
  return {
    id: spec.id,
    decide(market, inventory, request) {
      if (market.fused.health === "down") return { kind: "reject", reason: "halted" };
      if (
        request.pair !== market.pair ||
        !spec.pairs.includes(request.pair) ||
        !Number.isFinite(market.fused.mid) ||
        market.fused.mid <= 0 ||
        !Number.isFinite(market.fused.sigma1) ||
        market.fused.sigma1 < 0
      )
        return { kind: "reject", reason: "policy_rule" };
      if (
        !Number.isFinite(request.notionalUsd) ||
        request.notionalUsd <= 0 ||
        (request.side === "sell" &&
          (!Number.isFinite(request.baseQuantity) || request.baseQuantity <= 0))
      )
        return { kind: "reject", reason: "size" };
      const venues = freshVenues(market, config.sources[request.pair], config.staleMs);
      const leads = leadVenues(spec.reference, request.pair, config);
      const rejects = spec.rejectIf;
      const maxLeadDivergence = rejects?.leadDivergenceBps;
      if (rejects?.maxSigma1 !== undefined && market.fused.sigma1 > rejects.maxSigma1)
        return { kind: "reject", reason: "policy_rule" };
      if (rejects?.minSources !== undefined && market.fused.sourceCount < rejects.minSources)
        return { kind: "reject", reason: "degraded_reject" };
      if (
        maxLeadDivergence !== undefined &&
        venues.some(
          (venue) =>
            leads.includes(venue.venue) &&
            Math.abs((venue.mid - market.fused.mid) / market.fused.mid) * 10000 > maxLeadDivergence,
        )
      )
        return { kind: "reject", reason: "lead_divergence" };
      const walked =
        request.side === "buy"
          ? vwapForQuote(market.book.asks, request.notionalUsd)
          : vwap(market.book.bids, request.baseQuantity);
      if (walked === null) return { kind: "reject", reason: "insufficient_reference_depth" };
      const ref = referencePrice(spec.reference, walked, market, venues);
      if (ref === null) return { kind: "reject", reason: "degraded_reject" };
      const tier = config.tiers[request.tier];
      const ttlSec = ttlSeconds(market.fused.sigma1, tier.ttlSec, quoteConfig);
      const sigmaT = market.fused.sigma1 * Math.sqrt(ttlSec);
      const terms: Record<string, number> = {
        base: 0,
        vol: 0,
        inventory: 0,
        toxicity: 0,
        degraded: market.fused.health === "degraded" ? config.spread.degradedAdd : 0,
        tuner: 1,
      };
      let raw = 0;
      for (const term of spec.terms) {
        if (term.kind === "tuner") {
          terms.tuner = market.tuner;
          continue;
        }
        const value = contribution(term, {
          market,
          inventory,
          request,
          sigmaT,
          config,
          venues,
          leads,
        });
        if (value === null) return { kind: "reject", reason: "inventory" };
        terms[term.kind] = value;
        raw += value;
      }
      raw += terms.degraded ?? 0;
      const halfSpread = clamp(clamp(raw, min, max) * (terms.tuner ?? 1), min, max);
      const price = request.side === "buy" ? ref * (1 + halfSpread) : ref * (1 - halfSpread);
      if (
        ![ref, ttlSec, sigmaT, halfSpread, price, ...Object.values(terms)].every(Number.isFinite) ||
        price <= 0
      )
        return { kind: "reject", reason: "policy_rule" };
      return { kind: "quote", price, ref, halfSpread, sigmaT, ttlSec, terms };
    },
  };
}
