"use client";
import { formatUnits } from "viem";
import { sampleInventory } from "../../../content/platform.mock";
import { formatNumber, formatUsd, platformTokens } from "../../../lib/platform-config";
import { TokenIcon } from "../primitives";
import type { OperatorDashboardState } from "./use-operator-dashboard";

type Props = Pick<OperatorDashboardState, "status" | "shadow" | "inventory"> & { preview: boolean };

export function OperatorInventory({ preview, status, shadow, inventory }: Props) {
  return (
    <section aria-labelledby="inventory-title">
      <div className="p-section-heading">
        <h2 id="inventory-title">Inventory</h2>
        <span>Vault inventory</span>
      </div>
      <div className="p-inventory-grid">
        {platformTokens.map((token) => {
          const sampleAsset = sampleInventory.find((asset) => asset.symbol === token.symbol);
          const metadata = status.data?.pairs
            .flatMap((p) => [p.base, p.quote])
            .find((t) => t.symbol === token.symbol);
          const paperAmount = status.data?.inventory[token.symbol];
          const liveAsset =
            shadow && metadata && paperAmount !== undefined
              ? {
                  symbol: token.symbol,
                  amount: formatUnits(BigInt(paperAmount), metadata.decimals),
                }
              : inventory.data?.find((asset) => asset.symbol === token.symbol);
          return (
            <div className="p-card p-inventory-card" key={token.symbol}>
              <div className="p-card-header">
                <div className="p-inventory-token">
                  <TokenIcon symbol={token.symbol} />
                  <div>
                    <strong>{token.symbol}</strong>
                    <small>{token.name}</small>
                  </div>
                </div>
                <span className="p-pill p-pill-neutral">
                  {preview && sampleAsset ? `${sampleAsset.share}%` : "On-chain"}
                </span>
              </div>
              <strong className="p-inventory-value">
                {preview && sampleAsset
                  ? formatUsd(sampleAsset.value)
                  : liveAsset
                    ? `${formatNumber(Number(liveAsset.amount), 5)} ${token.symbol}`
                    : "—"}
              </strong>
              <div className="p-inventory-band">
                <span />
                <span />
                <span />
                {preview && sampleAsset && (
                  <i style={{ left: `${Math.max(20, Math.min(80, sampleAsset.share))}%` }} />
                )}
              </div>
              <div className="p-inventory-band-label">
                <span>Minimum band</span>
                <span>{preview ? "Within range" : "On-chain balance"}</span>
                <span>Maximum band</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
