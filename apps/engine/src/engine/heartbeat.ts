import { HORIZONS } from "../agent/types";
import { baseQuantity, markoutBps } from "../markouts";
import { observeMarkout } from "../toxicity";
import { arenaView } from "./arena";
import { EngineError } from "./errors";
import { equityUsdFor, getMarket, pairTokens, prune, refresh } from "./market";
import { checkpoint, withMarkouts } from "./persistence";
import { checkRisk } from "./risk";
import { fillQuote } from "./settlement";
import type { EngineState } from "./state";
import { observeOutcome } from "./tape";
import { getTaker, rescore } from "./toxicity";
import { tune } from "./tuner";

// Serialized heartbeat: markouts, risk, tape settlement and checkpointing.
export function tick(context: EngineState, now: number, gasPrice?: bigint): Promise<void> {
  return context.exclusive(async () => {
    for (const pair of context.deps.params.pairs) refresh(context, pair, now);
    if (!context.inventory) return;
    if (gasPrice !== undefined) {
      const hsk = context.markets.get("HSK/USDT")?.fused.mid;
      if (hsk)
        context.modeledGasUsd =
          ((Number(gasPrice) * context.deps.params.arena.gasUnits) / 1e18) * hsk;
    }
    for (const issued of context.issued.values()) {
      if (issued.record.status !== "filled" && now > issued.expiresAtMs) {
        const market = getMarket(context, issued.pair);
        const point = market.history.find((p) => p.t >= issued.expiresAtMs);
        if (point && point.t - issued.expiresAtMs <= context.deps.params.feeds.staleMs)
          observeOutcome(context, issued, false, point.mid);
        issued.record.status = "expired";
      }
    }
    for (const fill of context.ledger) {
      for (const horizon of HORIZONS) {
        if (
          now < fill.ts + horizon * 1000 ||
          context.state.markouts.some((m) => m.fillId === fill.id && m.horizon === horizon)
        )
          continue;
        const due = fill.ts + horizon * 1000;
        const point = getMarket(context, fill.pair).history.find((p) => p.t >= due);
        if (!point || point.t - due > context.deps.params.feeds.staleMs) continue;
        const bps = markoutBps(fill, point.mid);
        context.state.markouts.push({ fillId: fill.id, horizon, mid: point.mid, bps, ts: point.t });
        const taker = getTaker(context, fill.taker, fill.ts);
        if (horizon === 5) {
          observeMarkout(taker, bps, context.deps.params.toxicity);
          const loss = Math.max(
            0,
            (-bps / 10000) *
              fill.price *
              baseQuantity(fill, pairTokens(context, fill.pair).base.decimals),
          );
          const detectedAt =
            taker.detectedAfter && taker.firstFillAt !== null
              ? taker.firstFillAt + taker.detectedAfter.seconds * 1000
              : null;
          if (detectedAt !== null && fill.ts >= detectedAt) taker.postDetectionLossUsd += loss;
          else taker.preDetectionLossUsd += loss;
        }
        if (horizon === 300)
          taker.pnlUsd -=
            (bps / 10000) *
            fill.price *
            baseQuantity(fill, pairTokens(context, fill.pair).base.decimals);
        context.deps.emit?.({ type: "fill", fill: withMarkouts(context, fill) });
      }
    }
    if (now - context.lastTick >= context.deps.params.agent.tickMs) {
      checkRisk(context, now);
      rescore(context, now);
      tune(context, now);
      context.lastTick = now;
    }
    for (let i = context.pendingTape.length - 1; i >= 0; i--) {
      const item = context.pendingTape[i];
      if (!item || item.due > now) continue;
      context.pendingTape.splice(i, 1);
      try {
        await fillQuote(
          context,
          { quote: item.quote, signature: item.signature },
          "tape",
          now,
          "tape",
        );
        context.state.tape.wins += 1;
      } catch (error) {
        if (!(error instanceof EngineError)) throw error;
        context.state.tape.lost += 1;
      }
    }
    if (now - (context.state.points.at(-1)?.t ?? 0) >= context.deps.params.arena.pnlTickMs) {
      const { series: _series, ...arena } = arenaView(context);
      if (equityUsdFor(context, context.inventory) !== null)
        context.state.points.push({ t: now, equity: arena.equityUsd, byFlow: { ...arena.byFlow } });
      context.state.points = context.state.points.slice(-43200);
      context.deps.emit?.({ type: "arena", arena });
    }
    await context.deps.store.expireQuotes(Math.floor(now / 1000));
    await checkpoint(context);
    prune(context, now);
  });
}
