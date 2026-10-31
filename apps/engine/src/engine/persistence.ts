import type { Address } from "viem";
import { initialState } from "../agent/types";
import type { Fill, QuoteRecord } from "../db";
import { compile } from "../research/compile";
import { setArena } from "./arena";
import { EngineError } from "./errors";
import { nonceKey } from "./helpers";
import { decision } from "./journal";
import { isLiveRecord, reserveOpenQuote } from "./live";
import { getMarket, pairTokens } from "./market";
import type { EngineState } from "./state";
import { accountFill, observeQuote } from "./toxicity";
import type { PriceBreakdown } from "./types";

// Restore durable records and checkpoint the shared analytics state.
export async function init(context: EngineState): Promise<void> {
  const registeredPolicies = await context.deps.store.listPolicies();
  const incumbents = registeredPolicies.filter((policy) => policy.status === "incumbent");
  const canaries = registeredPolicies.filter((policy) => policy.status === "canary");
  if (incumbents.length > 1 || canaries.length > 1)
    throw new Error("Policy registry has multiple active incumbents or canaries");
  const incumbent = incumbents[0];
  if (incumbent) {
    context.activePolicy = {
      record: incumbent,
      policy: compile(incumbent.spec, { params: context.deps.params, mandate: context.mandate }),
    };
  }
  const canary = canaries[0];
  if (canary) {
    context.canary = {
      record: canary,
      policy: compile(canary.spec, { params: context.deps.params, mandate: context.mandate }),
    };
  }

  const arena = await context.deps.store.loadArena();
  if (!arena) return;
  setArena(context, arena.epoch, arena.startedAt, arena.inventory);
  const state = await context.deps.store.loadState(arena.epoch);
  context.state =
    state?.epoch === arena.epoch
      ? state
      : initialState(
          arena.epoch,
          context.deps.params.arena.initialUsdPerSide * context.deps.params.pairs.length * 2,
        );
  context.paused = context.state.paused;
  context.operatingLossStopped =
    context.paused &&
    context.state.decisions.some(
      (entry) => entry.type === "mandate_breach" && entry.inputs.rule === "operating_loss",
    );
  for (const pair of context.deps.params.pairs)
    getMarket(context, pair).history = context.state.prices[pair] ?? [];
  context.ledger = (
    await context.deps.store.fills({ epoch: arena.epoch, limit: 1_000_000 })
  ).reverse();
  const records = await context.deps.store.loadQuotes(arena.epoch);
  for (const record of records) {
    if (isLiveRecord(record)) {
      // Vault quotes aren't part of the paper analytics, but they still hold inventory until expiry.
      const { base, quote } = pairTokens(context, record.pair);
      if (context.deps.live)
        reserveOpenQuote(context, record, record.side === "buy" ? base.symbol : quote.symbol);
      continue;
    }
    restoreQuote(context, record);
    observeQuote(context, record);
  }
  for (const fill of context.ledger) accountFill(context, fill);
  if (
    context.state.strategy &&
    JSON.stringify(context.state.strategy) !== JSON.stringify(context.deps.params)
  ) {
    decision(context, "param_reload", Date.now(), "Strategy bundle changed since previous boot", {
      changed: "deployment params.json",
    });
  }
  context.state.strategy = context.deps.params;
}

export function restoreQuote(context: EngineState, record: QuoteRecord): void {
  const breakdown = record.breakdown as PriceBreakdown;
  context.issued.set(nonceKey(record.quote), {
    id: record.id,
    policyId: record.policyId,
    pair: record.pair,
    side: record.side,
    quote: record.quote,
    mid: breakdown.mid,
    expiresAtMs: Number(record.quote.expiry) * 1000,
    record,
  });
}

export function checkpoint(context: EngineState): Promise<void> {
  for (const pair of context.deps.params.pairs)
    context.state.prices[pair] = getMarket(context, pair).history;
  context.state.strategy = context.deps.params;
  return context.deps.store.saveState(structuredClone(context.state));
}

export function withMarkouts(context: EngineState, fill: Fill): Fill {
  return {
    ...fill,
    markouts: Object.fromEntries(
      context.state.markouts
        .filter((m) => m.fillId === fill.id)
        .map((m) => [String(m.horizon), m.bps]),
    ),
  };
}

export async function fills(
  context: EngineState,
  taker: string | undefined,
  limit: number,
  epoch?: number,
): Promise<Fill[]> {
  if (epoch !== undefined && (!Number.isSafeInteger(epoch) || epoch < 1))
    throw new EngineError("invalid_request", 400, "Invalid epoch");
  if (taker !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(taker)) {
    throw new EngineError("invalid_request", 400, "taker must be an address");
  }
  const fills = await context.deps.store.fills({
    ...(epoch === undefined ? {} : { epoch }),
    ...(taker ? { taker: taker as Address } : {}),
    limit,
  });
  return fills.map((fill) => withMarkouts(context, fill));
}
