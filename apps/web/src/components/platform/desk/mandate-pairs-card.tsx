"use client";

import type { PairStatus } from "@zethos/sdk";
import type { Mandate } from "../../../lib/engine/desk-types";
import { formatNumber, shortAddress } from "../../../lib/platform-config";
import { StatusDot } from "../primitives";

export function MandatePairsCard({
  mandate,
  pairs,
}: {
  mandate: Mandate | undefined;
  pairs: PairStatus[];
}) {
  if (!mandate) {
    return (
      <div className="d-card">
        <div className="d-card-head">
          <h2>Mandate Pairs</h2>
          <p>Configured trading pairs for desk operation</p>
        </div>
        <p className="p-metric-sub">Unavailable</p>
      </div>
    );
  }

  return (
    <div className="d-card">
      <div className="d-card-head">
        <h2>Mandate Pairs</h2>
        <p>Pairs the desk is mandated to provide two-way liquidity for</p>
      </div>

      <div className="p-table-wrap">
        <table className="p-table" aria-label="Mandate pairs table">
          <thead>
            <tr>
              <th scope="col">Pair</th>
              <th scope="col">Exchange Mid</th>
              <th scope="col">Feed Health</th>
              <th scope="col">Trading State</th>
              <th scope="col">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {mandate.pairs.map((pairName) => {
              const pairStatus = pairs.find((p) => p.pair === pairName);
              const mid = pairStatus?.mid ?? null;
              const health = pairStatus?.health ?? "unknown";
              const isHalted = pairStatus?.halted ?? false;
              const tone =
                health === "ok" && !isHalted
                  ? "success"
                  : health === "degraded"
                    ? "warning"
                    : "neutral";

              return (
                <tr key={pairName}>
                  <td>
                    <strong>{pairName}</strong>
                  </td>
                  <td>{mid !== null ? `${formatNumber(mid, 5)} USDT` : "Unavailable"}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 capitalize">
                      <StatusDot tone={tone} />
                      {pairStatus ? health : "Unavailable"}
                    </span>
                  </td>
                  <td>
                    {pairStatus ? (
                      <span className={`p-pill ${isHalted ? "p-pill-neutral" : "p-pill-success"}`}>
                        {isHalted ? "Halted" : "Active"}
                      </span>
                    ) : (
                      "Unavailable"
                    )}
                  </td>
                  <td>
                    {pairStatus ? (
                      <span className="text-xs text-neutral-400">
                        {pairStatus.base.symbol} ({shortAddress(pairStatus.base.address)}) /{" "}
                        {pairStatus.quote.symbol}
                      </span>
                    ) : (
                      "Unavailable"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
