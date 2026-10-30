"use client";

import type { PriceBreakdown } from "@zethos/sdk";

const TERMS = [
  { key: "size", label: "Size impact", hint: "Walking the merged book for this amount" },
  { key: "base", label: "Base spread", hint: "The vault's standing margin" },
  { key: "vol", label: "Volatility", hint: "Scales with how fast the mid is moving" },
  { key: "inventory", label: "Inventory", hint: "Skews to pull the vault back to balance" },
  { key: "toxicity", label: "Taker tier", hint: "Added for takers who pick off stale quotes" },
  { key: "degraded", label: "Degraded feed", hint: "Added when few price sources are healthy" },
] as const;

/** Where the distance from the fused mid comes from, in bps. Works on light and deck surfaces. */
export function PriceAnatomy({
  breakdown,
  vsMidBps,
}: {
  breakdown: PriceBreakdown;
  vsMidBps: number;
}) {
  const size = (Math.abs(breakdown.ref - breakdown.mid) / breakdown.mid) * 10_000;
  const values: Record<(typeof TERMS)[number]["key"], number> = {
    size,
    base: breakdown.base * 10_000,
    vol: breakdown.vol * 10_000,
    inventory: breakdown.inventory * 10_000,
    toxicity: breakdown.toxicity * 10_000,
    degraded: breakdown.degraded * 10_000,
  };
  const rows = TERMS.map((term, slot) => ({ ...term, slot, value: values[term.key] })).filter(
    (row) => Math.abs(row.value) >= 0.05,
  );
  const positive = rows.filter((row) => row.value > 0);
  const total = positive.reduce((sum, row) => sum + row.value, 0);
  const summary = rows.map((row) => `${row.label} ${row.value.toFixed(1)} bps`).join(", ");
  return (
    <div className="a-anatomy">
      <div className="a-anatomy-head">
        <span>Cost versus fused mid</span>
        <strong>{vsMidBps.toFixed(1)} bps</strong>
      </div>
      <div className="a-anatomy-bar" role="img" aria-label={`Price terms: ${summary}.`}>
        {positive.map((row) => (
          <span
            key={row.key}
            data-slot={row.slot}
            style={{ flexGrow: row.value / (total || 1) }}
            title={`${row.label}: ${row.value.toFixed(1)} bps`}
          />
        ))}
      </div>
      <ul className="a-anatomy-terms">
        {rows.map((row) => (
          <li key={row.key} title={row.hint}>
            <i data-slot={row.slot} aria-hidden />
            <span>{row.label}</span>
            <b>
              {row.value > 0 ? "+" : ""}
              {row.value.toFixed(1)}
            </b>
          </li>
        ))}
      </ul>
      {breakdown.sources.length > 0 && (
        <p className="a-anatomy-note">
          Fused from{" "}
          {breakdown.sources
            .filter((source) => source.status === "ok")
            .map((source) => `${source.venue} ${(source.weight * 100).toFixed(0)}%`)
            .join(" · ")}
          . Tier {breakdown.tier}, firm for {breakdown.ttlSec}s.
        </p>
      )}
    </div>
  );
}
