"use client";
import type { PairStatus } from "@zethos/sdk";
import { formatPrice } from "../../../lib/agent/runtime";
import { StatusDot } from "../primitives";
import { queueAndGo } from "./model";
import { Rolling } from "./rolling";
import { Spark } from "./spark";

export function MarketCard({
  pair,
  history,
  selected,
  onSelect,
}: {
  pair: PairStatus;
  history: number[];
  selected: boolean;
  onSelect: () => void;
}) {
  const symbol = pair.pair.split("/")[0] ?? pair.pair;
  const healthy = pair.sources.filter((source) => source.status === "ok").length;
  return (
    <div className="d-market" data-selected={selected}>
      <button
        type="button"
        className="d-market-main"
        aria-pressed={selected}
        data-cursor="hover"
        onClick={onSelect}
      >
        <span className="d-market-pair">
          {pair.pair}
          <small>
            <StatusDot tone={pair.health === "ok" ? "success" : "warning"} /> {healthy} of{" "}
            {pair.sources.length} sources
          </small>
        </span>
        <strong className="num">
          {pair.mid === null ? "Halted" : <Rolling value={pair.mid} format={formatPrice} />}
        </strong>
        <Spark values={history} label={`${pair.pair} recent mid`} />
      </button>
      {pair.mid !== null && pair.halfSpread && (
        <dl className="d-market-book">
          <div>
            <dt>Bid</dt>
            <dd>{formatPrice(pair.mid * (1 - pair.halfSpread.sell))}</dd>
          </div>
          <div>
            <dt>Ask</dt>
            <dd>{formatPrice(pair.mid * (1 + pair.halfSpread.buy))}</dd>
          </div>
          <div>
            <dt>Spread</dt>
            <dd>{((pair.halfSpread.buy + pair.halfSpread.sell) * 10_000).toFixed(1)} bps</dd>
          </div>
        </dl>
      )}
      <div className="d-market-actions">
        <button
          type="button"
          data-cursor="hover"
          onClick={() => queueAndGo(`Buy 500 USDT of ${symbol}`)}
        >
          Buy with agent
        </button>
        <button
          type="button"
          data-cursor="hover"
          onClick={() => queueAndGo(`Scan ${symbol} depth`)}
        >
          Scan depth
        </button>
      </div>
    </div>
  );
}
