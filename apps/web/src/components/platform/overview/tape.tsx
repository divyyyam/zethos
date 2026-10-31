"use client";
import type { Fill } from "@zethos/sdk";
import { useMemo, useState } from "react";
import { formatPrice } from "../../../lib/agent/runtime";
import { formatNumber, shortAddress } from "../../../lib/platform-config";
import { clock, FLOW_COLOR, FLOW_LABEL, FLOWS, type FlowName } from "./model";

export function Tape({ fills }: { fills: Fill[] }) {
  const [flow, setFlow] = useState<FlowName | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const fill of fills) result[fill.flow] = (result[fill.flow] ?? 0) + 1;
    return result;
  }, [fills]);
  const rows = fills.filter((fill) => flow === "all" || fill.flow === flow).slice(0, 12);
  return (
    <section className="d-card d-span-5" aria-labelledby="tape-title">
      <header className="d-card-head">
        <div>
          <h2 id="tape-title">Fill tape</h2>
          <p>Every paper fill, by who it came from</p>
        </div>
      </header>
      <fieldset className="d-filter" aria-label="Filter by flow">
        <button
          type="button"
          aria-pressed={flow === "all"}
          data-cursor="hover"
          onClick={() => setFlow("all")}
        >
          All <b>{fills.length}</b>
        </button>
        {FLOWS.map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={flow === item}
            disabled={!counts[item]}
            data-cursor="hover"
            onClick={() => setFlow(item)}
          >
            {FLOW_LABEL[item]} <b>{counts[item] ?? 0}</b>
          </button>
        ))}
      </fieldset>
      {rows.length === 0 ? (
        <p className="d-empty-line">No fills here yet.</p>
      ) : (
        <ol className="d-tape">
          {rows.map((fill) => {
            const five = fill.markouts?.["5"];
            const expanded = open === fill.id;
            return (
              <li key={fill.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  data-cursor="hover"
                  onClick={() => setOpen(expanded ? null : fill.id)}
                >
                  <i style={{ background: FLOW_COLOR[fill.flow] }} aria-hidden />
                  <span>{FLOW_LABEL[fill.flow]}</span>
                  <span>
                    {fill.side === "buy" ? "Buy" : "Sell"} {fill.pair.split("/")[0]}
                  </span>
                  <b>{formatPrice(fill.price)}</b>
                  <time>{clock(fill.ts)}</time>
                </button>
                {expanded && (
                  <dl>
                    <div>
                      <dt>Taker</dt>
                      <dd>{shortAddress(fill.taker)}</dd>
                    </div>
                    <div>
                      <dt>Mid at fill</dt>
                      <dd>
                        {fill.midAtFill === null
                          ? "Unavailable during feed outage"
                          : formatPrice(fill.midAtFill)}
                      </dd>
                    </div>
                    <div>
                      <dt>5 s markout</dt>
                      <dd>{five === undefined ? "Measuring" : `${formatNumber(five, 1)} bps`}</dd>
                    </div>
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
