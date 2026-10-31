import type { Pair } from "../config";
import { baseQuantity, spreadCapture } from "../markouts";
import { arenaView } from "./arena";
import { EngineError } from "./errors";
import { getMarket, pairTokens } from "./market";
import type { EngineState } from "./state";

// Public statistics and operator paper P&L attribution.
export function stats(context: EngineState, pair: string, from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to)
    throw new EngineError("invalid_request", 400, "Invalid time range");
  if (!context.markets.has(pair as Pair))
    throw new EngineError("invalid_request", 400, "Unknown pair");
  const series = getMarket(context, pair as Pair).history.filter(
    (point) => point.t >= from && point.t <= to,
  );
  const fills = context.ledger.filter((f) => f.pair === pair && f.ts >= from && f.ts <= to);
  return {
    series,
    venues: [] as { venue: string; depthUsd: number }[],
    summary: {
      fills: fills.length,
      volumeUsd: fills.reduce(
        (sum, f) => sum + f.price * baseQuantity(f, pairTokens(context, f.pair).base.decimals),
        0,
      ),
      spreadCaptureUsd: fills.reduce(
        (sum, f) =>
          sum + spreadCapture(f, baseQuantity(f, pairTokens(context, f.pair).base.decimals)),
        0,
      ),
    },
  };
}

export function pnl(context: EngineState, period: "today" | "7d" | "all", now: number) {
  const arena = arenaView(context);
  if (period === "all")
    return {
      total: arena.pnl.total,
      spreadCapture: arena.pnl.spread,
      inventory: arena.pnl.inventory,
      arbitrage: 0,
      gas: arena.pnl.gas,
      paper: true,
    };
  const from =
    period === "7d"
      ? now - 7 * 86400000
      : new Date(new Date(now).toISOString().slice(0, 10)).getTime();
  const opening =
    context.state.points.findLast((p) => p.t <= from)?.equity ?? context.state.initialEquity;
  const fills = context.ledger.filter((f) => f.ts >= from);
  const spread = fills.reduce(
    (sum, f) => sum + spreadCapture(f, baseQuantity(f, pairTokens(context, f.pair).base.decimals)),
    0,
  );
  const gas = fills.reduce((sum, f) => sum + (f.gasUsd ?? 0), 0);
  const total = arena.equityUsd - opening - gas;
  return {
    total,
    spreadCapture: spread,
    inventory: total - spread + gas,
    arbitrage: 0,
    gas,
    paper: true,
  };
}
