"use client";

import { formatPrice, formatToken, type Report } from "../../../lib/agent/runtime";
import { formatUsd } from "../../../lib/platform-config";
import { PriceAnatomy } from "../price-anatomy";

const GRAMMAR: { title: string; items: string[] }[] = [
  { title: "Swap now", items: ["Buy 500 USDT of HSK", "Sell 0.1 ETH", "Swap 100 USDT to WHSK"] },
  {
    title: "Slice it",
    items: ["Buy 2,000 USDT of HSK over 2 minutes", "Sell 1 ETH in 4 slices"],
  },
  {
    title: "Wait for a price",
    items: ["Buy 300 USDT of HSK if it drops 1%", "Sell 0.1 ETH when ETH is above 2300"],
  },
  {
    title: "Set your limit",
    items: ["Buy 500 USDT of HSK, max 90 bps", "Sell 0.1 ETH within 0.5%"],
  },
  { title: "Price without filling", items: ["Quote 5k USDT of HSK", "Scan ETH depth"] },
  { title: "Ask", items: ["Why this price on HSK?", "How’s the market?", "My position"] },
  { title: "Manage", items: ["Flatten everything", "Stop"] },
];

const TITLES: Record<Report["type"], string> = {
  market: "The *market* right now",
  explain: "Why this *price*",
  ladder: "What size *costs*",
  position: "Your *position*",
  help: "What you can *say*",
  notice: "",
};

export function reportTitle(report: Report): string {
  return report.type === "notice" ? report.title : TITLES[report.type];
}

const LABEL = "text-sm text-fg-soft";

export function ReportView({ report, onRun }: { report: Report; onRun: (text: string) => void }) {
  switch (report.type) {
    case "notice":
      return <p className="mt-3 text-fg-soft">{report.detail}</p>;
    case "help":
      return (
        <div className="mt-6 grid gap-x-block gap-y-6 sm:grid-cols-2">
          {GRAMMAR.map((group) => (
            <div key={group.title} className="border-t border-line pt-3">
              <h4 className={`${LABEL} mb-1.5 font-normal`}>{group.title}</h4>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item}
                  data-cursor="hover"
                  className="block py-0.5 text-left text-[15px] hover:text-[#5b4fd1]"
                  onClick={() => onRun(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          ))}
        </div>
      );
    case "market":
      return (
        <div className="mt-6 grid gap-x-block gap-y-6 sm:grid-cols-2">
          {report.pairs.map((pair) => {
            const healthy = pair.sources.filter((source) => source.status === "ok").length;
            return (
              <div key={pair.pair} className="border-t border-line pt-3">
                <p className={LABEL}>{pair.pair}</p>
                <p className="num mt-2 text-[40px]">
                  {pair.mid === null ? "No price" : formatPrice(pair.mid)}
                </p>
                <p className={`${LABEL} mt-2`}>
                  Feed {pair.health}, {healthy} of {pair.sources.length} venues
                  {pair.halfSpread &&
                    `. Buy +${(pair.halfSpread.buy * 10_000).toFixed(1)}, sell −${(pair.halfSpread.sell * 10_000).toFixed(1)} bps`}
                </p>
              </div>
            );
          })}
          <div className="border-t border-line pt-3">
            <p className={LABEL}>Vault, paper</p>
            <p className="num mt-2 text-[40px]">
              {report.equityUsd === null ? "Unfunded" : formatUsd(report.equityUsd)}
            </p>
            <p className={`${LABEL} mt-2`}>Risk state {report.riskState}</p>
          </div>
        </div>
      );
    case "explain":
      return (
        <div className="mt-3">
          <p className="text-fg-soft">
            A {formatUsd(report.usd)} buy on {report.pair} right now, firm for {report.ttlSec}s. A
            fresh quote, not filled.
          </p>
          <div className="mt-5 border-t border-line pt-4">
            <PriceAnatomy breakdown={report.breakdown} vsMidBps={report.vsMidBps} />
          </div>
        </div>
      );
    case "ladder": {
      const max = Math.max(1, ...report.rungs.map((rung) => rung.costBps ?? 0));
      return (
        <div className="mt-3">
          <p className="text-fg-soft">
            Real signed quotes for {report.pair} at each size, buying. None were filled.
          </p>
          <div className="mt-5">
            {report.rungs.map((rung) => (
              <div
                key={rung.usd}
                className="grid grid-cols-[76px_minmax(0,1fr)_84px_44px] items-center gap-3 border-t border-line py-2.5 text-[15px]"
              >
                <span className="num-sm">{formatUsd(rung.usd)}</span>
                {rung.costBps === null ? (
                  <span className="col-span-3 text-sm text-fg-soft">{rung.note}</span>
                ) : (
                  <>
                    <span className="h-[2px] bg-line">
                      <span
                        className="block h-full bg-fg"
                        style={{ width: `${(rung.costBps / max) * 100}%` }}
                      />
                    </span>
                    <span className="num-sm text-right text-sm">{rung.costBps.toFixed(1)} bps</span>
                    <button
                      type="button"
                      data-cursor="hover"
                      className="text-right text-sm font-medium hover:text-[#5b4fd1]"
                      onClick={() =>
                        onRun(
                          `Buy ${rung.usd} USDT of ${report.pair.split("/")[0]}, max ${Math.ceil(rung.costBps ?? 0) + 15} bps`,
                        )
                      }
                    >
                      Use
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "position": {
      const open = report.rows.filter((row) => row.fills > 0);
      if (open.length === 0)
        return (
          <p className="mt-3 text-fg-soft">
            This identity hasn’t traded yet. Try “Buy 500 USDT of HSK”.
          </p>
        );
      return (
        <div className="mt-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] border-collapse text-[15px]">
              <thead>
                <tr className={LABEL}>
                  <th scope="col" className="pb-2 text-left font-normal">
                    Pair
                  </th>
                  <th scope="col" className="pb-2 text-left font-normal">
                    Net
                  </th>
                  <th scope="col" className="pb-2 text-left font-normal">
                    USDT flow
                  </th>
                  <th scope="col" className="pb-2 text-left font-normal">
                    Fills
                  </th>
                  <th scope="col" className="pb-2 text-right font-normal">
                    Paper P&amp;L
                  </th>
                </tr>
              </thead>
              <tbody className="num-sm">
                {open.map((row) => (
                  <tr key={row.pair} className="border-t border-line">
                    <td className="py-2.5">{row.pair}</td>
                    <td>
                      {row.net > 0 ? "+" : ""}
                      {formatToken(row.net)} {row.baseSymbol}
                    </td>
                    <td>
                      {row.quoteFlow > 0 ? "+" : ""}
                      {formatToken(row.quoteFlow)}
                    </td>
                    <td>{row.fills}</td>
                    <td className="text-right">
                      {row.pnlUsd === null ? "No price" : formatUsd(row.pnlUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`${LABEL} mt-3`}>
            Marked at the fused mid. Paper only.
            {report.truncated ? " Covers your latest 100 fills." : ""}
          </p>
        </div>
      );
    }
  }
}
