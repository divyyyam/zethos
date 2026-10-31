import { decision } from "./journal";
import { baseShareFor, equityUsdFor, getMarket, getStatus } from "./market";
import type { EngineState } from "./state";

// Deterministic risk gates; all autonomous actions enter the journal.
export function checkRisk(context: EngineState, now: number): void {
  const { params } = context.deps;
  const equity = context.inventory ? equityUsdFor(context, context.inventory) : null;
  if (equity !== null) {
    context.state.peakEquity = Math.max(context.state.peakEquity, equity);
    const drawdown =
      context.state.peakEquity > 0
        ? (context.state.peakEquity - equity) / context.state.peakEquity
        : 0;
    if (!context.paused && drawdown > params.risk.maxDrawdownPct) {
      context.paused = context.state.paused = true;
      decision(
        context,
        "pause",
        now,
        [
          `Equity drawdown ${(drawdown * 100).toFixed(2)}% exceeds `,
          `${(params.risk.maxDrawdownPct * 100).toFixed(2)}%; operator resume `,
          `required`,
        ].join(""),
        { equity, peak: context.state.peakEquity, drawdown },
      );
    }
  }
  for (const pair of params.pairs) {
    const market = getMarket(context, pair);
    const health = market.fused.health;
    const previous = context.state.health[pair];
    if (health === "down") {
      context.state.downSince[pair] ??= now;
      delete context.state.healthySince[pair];
      if (
        !context.state.halts[pair] &&
        now - (context.state.downSince[pair] ?? now) >= params.risk.feedOutagePauseSec * 1000
      ) {
        context.state.halts[pair] = true;
        decision(
          context,
          "pair_halt",
          now,
          `${pair} has no healthy feeds for ${params.risk.feedOutagePauseSec}s`,
          { health, outageSeconds: (now - (context.state.downSince[pair] ?? now)) / 1000 },
          pair,
        );
      }
    } else {
      delete context.state.downSince[pair];
      if (health === "ok") context.state.healthySince[pair] ??= now;
      else delete context.state.healthySince[pair];
      if (context.state.halts[pair] && now - (context.state.healthySince[pair] ?? now) >= 30000) {
        delete context.state.halts[pair];
        decision(
          context,
          "pair_resume",
          now,
          `${pair} feeds healthy for 30s`,
          { healthySeconds: 30 },
          pair,
        );
      }
    }
    if (previous !== health) {
      if (health !== "ok")
        decision(
          context,
          "feed_degraded",
          now,
          `${pair} feed health is ${health}`,
          { health, sources: market.fused.sources.filter((s) => s.status === "ok").length },
          pair,
        );
      else if (previous)
        decision(context, "feed_recovered", now, `${pair} feeds recovered`, { health }, pair);
      context.state.health[pair] = health;
    }
    const recent = context.state.markouts.filter(
      (m) =>
        m.horizon === 30 &&
        now - m.ts <= 300000 &&
        context.ledger.some((f) => f.id === m.fillId && f.pair === pair),
    );
    const mean = recent.reduce((sum, m) => sum + m.bps, 0) / recent.length;
    if (
      recent.length &&
      mean < params.risk.markoutAlarm * 10000 &&
      now - (context.state.alarmAt[pair] ?? 0) >= params.agent.cooldownMs
    ) {
      const before = context.state.tuner[pair] ?? 1;
      const after = Math.min(3, before * 1.5);
      context.state.tuner[pair] = after;
      context.state.alarmAt[pair] = now;
      decision(
        context,
        "spread_widen",
        now,
        [
          `${pair} 5-minute mean markout ${mean.toFixed(1)} bps breached alarm; `,
          `multiplier ${before.toFixed(2)} → ${after.toFixed(2)}`,
        ].join(""),
        { meanBps: mean, alarmBps: params.risk.markoutAlarm * 10000 },
        pair,
        null,
        { multiplier: before },
        { multiplier: after },
      );
    }
    if (market.fused.mid && context.inventory) {
      const share = baseShareFor(context, pair, market.fused.mid, context.inventory);
      const limit =
        share < params.inventory.minShare ? "buy" : share > params.inventory.maxShare ? "sell" : "";
      if (limit && context.state.inventoryLimited[pair] !== limit)
        decision(
          context,
          "inventory_limit",
          now,
          `${pair} base share ${(share * 100).toFixed(1)}%; refusing taker ${limit}`,
          { share, refusedSide: limit },
          pair,
        );
      context.state.inventoryLimited[pair] = limit;
    }
  }
  const status = getStatus(context);
  context.deps.emit?.({
    type: "risk",
    paused: context.paused,
    riskState: status.riskState as "paused" | "normal" | "degraded",
    halted: params.pairs.filter((p) => context.state.halts[p]),
  });
}
