"use client";
import type { TakerRow } from "@zethos/sdk";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { shortAddress } from "../../../lib/platform-config";
import { plural } from "./model";

export function Takers({ takers: all }: { takers: TakerRow[] }) {
  // Quoting alone creates a taker row. The ones worth watching are those who have actually filled.
  const takers = all
    .filter((taker) => taker.fills > 0)
    .sort((a, b) => b.score - a.score || b.fills - a.fills);
  return (
    <section className="d-card d-span-3" aria-labelledby="takers-title">
      <header className="d-card-head">
        <div>
          <h2 id="takers-title">Takers</h2>
          <p>Filled takers, scored on behaviour only</p>
        </div>
        <Link href="/arena" className="d-link" data-cursor="hover">
          All <ArrowUpRight size={13} aria-hidden />
        </Link>
      </header>
      {takers.length === 0 ? (
        <p className="d-empty-line">Nobody has filled yet.</p>
      ) : (
        <ol className="d-takers">
          {takers.slice(0, 7).map((taker) => (
            <li key={taker.address}>
              <span>
                {taker.label ?? shortAddress(taker.address)}
                <small>{plural(taker.fills, "fill")}</small>
              </span>
              <span className={`p-pill p-tier p-tier-${taker.tier}`}>{taker.tier}</span>
              <meter
                min={0}
                max={1}
                value={taker.score}
                aria-label={`Toxicity score ${taker.score.toFixed(2)}`}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
