"use client";
import type { PairStatus } from "@zethos/sdk";
import { formatUnits } from "viem";
import { formatToken } from "../../../lib/agent/runtime";
import { formatUsd } from "../../../lib/platform-config";

export function Inventory({
  pairs,
  inventory,
}: {
  pairs: PairStatus[];
  inventory: Record<string, string>;
}) {
  return (
    <div className="d-inventory">
      {pairs.map((pair) => {
        const baseRaw = inventory[pair.base.symbol];
        const quoteRaw = inventory[pair.quote.symbol];
        if (baseRaw === undefined || quoteRaw === undefined || pair.mid === null) return null;
        const base = Number(formatUnits(BigInt(baseRaw), pair.base.decimals));
        const quote = Number(formatUnits(BigInt(quoteRaw), pair.quote.decimals));
        const value = base * pair.mid;
        // USDT backs both pairs, so each is measured against its share, as the engine does.
        const share = value / (value + quote / pairs.length || 1);
        return (
          <div key={pair.pair}>
            <p>
              {pair.base.symbol} <b>{(share * 100).toFixed(1)}%</b>
            </p>
            <div
              className="d-balance"
              role="img"
              aria-label={`${pair.base.symbol} is ${(share * 100).toFixed(1)} percent of its side, target 50.`}
            >
              <span style={{ width: `${share * 100}%` }} />
              <i aria-hidden />
            </div>
            <small>
              {formatToken(base)} {pair.base.symbol}, worth {formatUsd(value)}
            </small>
          </div>
        );
      })}
    </div>
  );
}
