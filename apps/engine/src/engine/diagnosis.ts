import type { Pair } from "../config";
import { attributeLosses, type LossAttributionResult } from "../research/attribution";
import { EngineError } from "./errors";
import { decision } from "./journal";
import { withMarkouts } from "./persistence";
import type { EngineState } from "./state";

const WINDOWS: Record<string, number> = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
};

export function diagnose(
  context: EngineState,
  now: number,
  pair?: string,
  window = "1h",
): LossAttributionResult {
  if (!(window in WINDOWS))
    throw new EngineError("invalid_request", 400, "window must be one of 1h, 24h, or 7d");
  if (pair !== undefined && !context.deps.params.pairs.includes(pair as Pair))
    throw new EngineError("invalid_request", 400, "pair is not enabled");
  const duration = WINDOWS[window] ?? 60 * 60_000;
  const fromTs = now - duration;
  const fills = context.ledger
    .filter((fill) => (!pair || fill.pair === pair) && fill.ts >= fromTs && fill.ts <= now)
    .map((fill) => withMarkouts(context, fill));
  const quotes = [...context.issued.values()].map(({ quote, record }) => ({
    id: record.id,
    issuedAt: quote.issuedAt,
    expiry: quote.expiry,
    ref: (record.breakdown as { ref?: number } | null)?.ref,
    midAtQuote: (record.breakdown as { mid?: number } | null)?.mid,
  }));
  const leadPrices = context.deps.params.pairs.flatMap((enabled) =>
    Object.entries(context.markets.get(enabled)?.venueHistory ?? {}).flatMap(([venue, samples]) =>
      (samples ?? []).map((sample) => ({
        venue,
        pair: enabled,
        ts: sample.t,
        mid: sample.mid,
        status: "ok" as const,
      })),
    ),
  );
  const result = attributeLosses({
    window: { fromTs, toTs: now },
    fills,
    quotes,
    leadPrices,
    tokens: context.deps.tokens,
    thresholds: { staleMs: context.deps.params.feeds.staleMs },
  });
  decision(
    context,
    "diagnosis",
    now,
    `Attributed $${result.totalLossUsd.toFixed(2)} analytical markout loss over ${window}`,
    {
      window,
      pair: pair ?? "all-enabled-pairs",
      totalLossUsd: result.totalLossUsd,
      causesUsd: JSON.stringify(
        Object.fromEntries(
          Object.entries(result.causes).map(([cause, attribution]) => [cause, attribution.usd]),
        ),
      ),
      unclassifiedLossUsd: result.unclassifiedLossUsd,
    },
  );
  return result;
}
