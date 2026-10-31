import type { Address } from "viem";
import { emptyFlow, initialState } from "../agent/types";
import { baseQuantity, spreadCapture } from "../markouts";
import { type Inventory, TOKEN_SYMBOLS, toUnits } from "../tokens";
import { EngineError } from "./errors";
import { decision } from "./journal";
import { equityUsdFor, getMarket, pairTokens, refresh } from "./market";
import { checkpoint } from "./persistence";
import type { EngineState } from "./state";

// Paper epoch lifecycle, inventory seeding and Arena accounting.
export function ensureArena(context: EngineState, now: number): Promise<void> {
  if (context.inventory) return Promise.resolve();
  return context.exclusive(() => seedArena(context, now));
}

export async function seedArena(context: EngineState, now: number, force = false): Promise<void> {
  if (context.inventory && !force) return;
  const mids = context.deps.params.pairs.map((pair) => getMarket(context, pair).fused.mid);
  if (mids.some((mid) => mid === null)) return;
  const usd = context.deps.params.arena.initialUsdPerSide;
  const inventory = Object.fromEntries(TOKEN_SYMBOLS.map((symbol) => [symbol, 0n])) as Inventory;
  context.deps.params.pairs.forEach((pair, index) => {
    const { base, quote } = pairTokens(context, pair);
    inventory[quote.symbol] += toUnits(usd, quote.decimals);
    inventory[base.symbol] += toUnits(usd / (mids[index] as number), base.decimals);
  });
  const arena = await context.deps.store.startArena(now, inventory);
  setArena(context, arena.epoch, arena.startedAt, arena.inventory);
  context.state = initialState(arena.epoch, equityUsdFor(context, inventory) ?? 0);
  context.state.points.push({ t: now, equity: context.state.initialEquity, byFlow: emptyFlow() });
  context.state.strategy = context.deps.params;
  if (!force) await checkpoint(context);
}

export function arenaView(context: EngineState) {
  if (!context.arena || !context.inventory) throw new EngineError("warming_up", 503);
  const equity = equityUsdFor(context, context.inventory);
  // Value inventory at the most recent healthy mid during an outage; never substitute
  // sample prices. If no recorded price exists, report warming_up.
  const equityUsd = equity ?? context.state.points.at(-1)?.equity;
  if (equityUsd === undefined) throw new EngineError("warming_up", 503, "No healthy valuation yet");
  const byFlow = emptyFlow();
  const byPolicy: Record<string, { fills: number; volumeUsd: number; pnlUsd: number }> = {};
  let spread = 0;
  let volumeUsd = 0;
  for (const fill of context.ledger) {
    const qty = baseQuantity(fill, pairTokens(context, fill.pair).base.decimals);
    const notional = fill.price * qty;
    spread += spreadCapture(fill, qty);
    volumeUsd += notional;
    const mark = context.state.markouts.find((m) => m.fillId === fill.id && m.horizon === 300);
    const markoutPnlUsd = mark ? (mark.bps * notional) / 10000 : 0;
    if (mark) byFlow[fill.flow] += markoutPnlUsd;
    let policy = byPolicy[fill.policyId];
    if (!policy) {
      policy = { fills: 0, volumeUsd: 0, pnlUsd: 0 };
      byPolicy[fill.policyId] = policy;
    }
    policy.fills += 1;
    policy.volumeUsd += notional;
    policy.pnlUsd += markoutPnlUsd;
  }
  const totalBeforeGas = equityUsd - context.state.initialEquity;
  return {
    epoch: context.arena.epoch,
    startedAt: context.arena.startedAt,
    paper: true,
    equityUsd,
    pnl: {
      total: totalBeforeGas - context.state.gasUsd,
      spread,
      inventory: totalBeforeGas - spread,
      arb: 0,
      gas: context.state.gasUsd,
    },
    valuationStale: equity === null,
    unpricedFills: context.ledger.filter((fill) => fill.midAtFill === null).length,
    byFlow,
    byPolicy,
    series: context.state.points.slice(-1800),
    fills: context.ledger.length,
    volumeUsd,
    takers: new Set(context.ledger.map((f) => f.taker.toLowerCase())).size,
    tapeCaptureRate: context.state.tape.attempts
      ? context.state.tape.wins / context.state.tape.attempts
      : null,
    tape: { ...context.state.tape },
    methodology: {
      settlement: "paper",
      byFlowHorizonSec: 300,
      spreadCapture: "signed edge at fill mid",
      gas: "modelled from latest RPC gas price; zero until available",
      tapeCaptureRate: context.deps.params.arena.tapeCaptureRate,
      tapeSizeScale: context.deps.params.arena.tapeSizeScale,
    },
  };
}

export function resetArena(context: EngineState, operator: Address, now: number): Promise<void> {
  return context.exclusive(async () => {
    for (const pair of context.deps.params.pairs) {
      refresh(context, pair, now);
      if (getMarket(context, pair).fused.mid === null)
        throw new EngineError("warming_up", 503, "Fresh prices are required to fund a paper epoch");
    }
    await checkpoint(context);
    await seedArena(context, now, true);
    context.issued.clear();
    context.pendingTape.length = 0;
    context.ledger = [];
    context.paused = false;
    decision(
      context,
      "arena_reset",
      now,
      `Operator ${operator} started paper epoch ${context.arena?.epoch}`,
      { operator, epoch: context.arena?.epoch ?? 0 },
    );
    await checkpoint(context);
  });
}

export function setArena(
  context: EngineState,
  epoch: number,
  startedAt: number,
  inventory: Inventory,
): void {
  context.arena = { epoch, startedAt };
  context.inventory = { ...inventory };
}
