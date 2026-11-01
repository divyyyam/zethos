"use client";

import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { useEngineStatus } from "../../../hooks/platform/use-platform";
import { failureMessage, zethos } from "../../../lib/engine/sdk";
import { platformConfig } from "../../../lib/platform-config";
import { ExternalLink } from "../primitives";
import { time } from "./presentation";

export function RealFills() {
  const status = useEngineStatus();
  const fills = useQuery({
    queryKey: ["engine", "fills", "real"],
    queryFn: async () => {
      if (!zethos) throw new Error("Engine unavailable");
      return (await zethos.fills({ limit: 100 })).filter((fill) => !fill.paper);
    },
    enabled: Boolean(zethos),
    refetchInterval: 15000,
    retry: false,
  });
  if (!status.data || (status.data.mode === "shadow" && !fills.data?.length)) return null;
  return (
    <section className="p-card mb-6" aria-label="Real vault fills">
      <div className="p-card-header">
        <h2>Real vault fills</h2>
        <span className="p-pill">
          {status.data.chainId === 133 ? "On-chain · testnet" : "On-chain"}
        </span>
      </div>
      <p>
        Confirmed vault swaps from the latest 100 fills. These are separate from the paper results
        below.
      </p>
      {fills.error && (
        <p role="alert" className="p-form-error">
          {failureMessage(fills.error)}
        </p>
      )}
      <div className="p-table-wrap">
        <table className="p-table">
          <thead>
            <tr>
              <th>Pair</th>
              <th>Side</th>
              <th>Paid</th>
              <th>Received</th>
              <th>Time</th>
              <th>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {fills.data?.map((fill) => {
              const pair = status.data.pairs.find((p) => p.pair === fill.pair);
              const sold = pair && (fill.side === "buy" ? pair.quote : pair.base);
              const bought = pair && (fill.side === "buy" ? pair.base : pair.quote);
              return (
                <tr key={fill.id}>
                  <td>
                    {pair
                      ? `${pair.base.label ?? pair.base.symbol} / ${pair.quote.label ?? pair.quote.symbol}`
                      : fill.pair}
                  </td>
                  <td>{fill.side}</td>
                  <td>
                    {sold
                      ? `${formatUnits(BigInt(fill.amountIn), sold.decimals)} ${sold.label ?? sold.symbol}`
                      : "Unavailable"}
                  </td>
                  <td>
                    {bought
                      ? `${formatUnits(BigInt(fill.amountOut), bought.decimals)} ${bought.label ?? bought.symbol}`
                      : "Unavailable"}
                  </td>
                  <td>{time(fill.ts)}</td>
                  <td>
                    {fill.txHash ? (
                      <ExternalLink href={`${platformConfig.explorer}/tx/${fill.txHash}`}>
                        View transaction
                      </ExternalLink>
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
      {!fills.error && !fills.data?.length && (
        <p className="p-card-footnote">
          {fills.isPending
            ? "Loading confirmed vault fills…"
            : "No confirmed vault fills in the latest 100 fills."}
        </p>
      )}
    </section>
  );
}
