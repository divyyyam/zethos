"use client";
import { Check } from "lucide-react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useLiveSettlement, useNow } from "../../../hooks/platform/use-agent";
import { useFinePointerDesktop, useReducedMotionPref } from "../../../hooks/use-media-query";
import { formatToken, type Mission, missionTotals } from "../../../lib/agent/runtime";
import { shortAddress } from "../../../lib/platform-config";
import { Ring, Signature } from "../../landing/quote-anatomy";
import { STATUS_LABEL, TILT } from "./mission-presentation";

/** The landing's quote ticket, with this mission's real terms on it. */
export function MissionTicket({ mission }: { mission: Mission }) {
  const live = useLiveSettlement();
  const plan = mission.plan;
  const reduced = useReducedMotionPref();
  const desktop = useFinePointerDesktop();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [7, -7]), TILT);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-10, 10]), TILT);
  const foilX = useTransform(px, [-0.5, 0.5], ["0%", "100%"]);
  const foilY = useTransform(py, [-0.5, 0.5], ["0%", "100%"]);
  const now = useNow(Boolean(mission.quote));
  if (!plan) return null;

  const totals = missionTotals(mission);
  const filled = totals.filled > 0;
  const planned = Number(plan.amountIn) / 10 ** plan.soldDecimals;
  const quote = mission.quote;
  const ttlLeft = quote ? Math.max(0, Math.ceil(quote.expiresAt - now / 1000)) : 0;
  const rows: [string, string][] = [
    ["Cost limit", `${plan.maxCostBps} bps from mid`],
    ...(quote ? ([["Quoted cost", `${quote.vsMidBps.toFixed(1)} bps`]] as [string, string][]) : []),
    ...(plan.sliceAmounts.length > 1
      ? ([
          [
            "Schedule",
            `${plan.sliceAmounts.length} slices, every ${Math.round(plan.intervalMs / 1000)}s`,
          ],
        ] as [string, string][])
      : []),
    ...(plan.trigger
      ? ([["Stays armed", `${Math.round(plan.triggerMs / 60_000)} min, in this tab`]] as [
          string,
          string,
        ][])
      : []),
    ["Settlement", mission.dryRun ? "None, dry run" : live ? "On-chain vault" : "Paper vault"],
    ["Taker", shortAddress(mission.taker)],
  ];
  return (
    <div className="[perspective:1400px]">
      <motion.div
        style={{ rotateX, rotateY }}
        className="relative mx-auto w-[min(100%,410px)] transform-gpu"
        data-cursor="hover"
        initial={reduced ? false : { opacity: 0, y: 60 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        onPointerMove={(event) => {
          if (!desktop || reduced || event.pointerType !== "mouse") return;
          const box = event.currentTarget.getBoundingClientRect();
          px.set((event.clientX - box.left) / box.width - 0.5);
          py.set((event.clientY - box.top) / box.height - 0.5);
        }}
        onPointerLeave={() => {
          px.set(0);
          py.set(0);
        }}
      >
        <div className="a-sheet ticket-stub relative overflow-hidden rounded-[22px] shadow-[0_60px_120px_-30px_rgb(5_5_27/0.8)] [--stub-y:calc(100%-96px)]">
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 opacity-40 mix-blend-multiply"
            style={{
              backgroundImage:
                "linear-gradient(115deg, #ffd6c2 0%, #e4dcff 28%, #c8ecff 52%, #ffdcec 78%, #fff1c9 100%)",
              backgroundSize: "260% 260%",
              backgroundPositionX: foilX,
              backgroundPositionY: foilY,
            }}
          />
          <div className="relative p-6">
            <div className="flex items-center justify-between gap-3">
              <span className="t-title !text-[30px]">
                {plan.side === "buy" ? "Buy" : "Sell"} {plan.pair.split("/")[0]}
              </span>
              <span className="shrink-0 rounded-full border border-[#14113a]/25 px-2.5 py-1 text-[13px] font-medium">
                {STATUS_LABEL[mission.status]}
              </span>
            </div>
            <div className="mt-6">
              <p className="text-sm text-fg-soft">{filled ? "You paid" : "You pay"}</p>
              <p className="num mt-2 flex items-baseline justify-between text-[40px]">
                {filled
                  ? formatToken(totals.paid)
                  : `${plan.approximate ? "≈ " : ""}${formatToken(planned)}`}
                <span className="font-sans text-sm tracking-normal">{plan.soldSymbol}</span>
              </p>
            </div>
            <div className="mt-6 border-t border-line pt-6">
              <p className="text-sm text-fg-soft">{filled ? "You received" : "You receive"}</p>
              <p className="num mt-2 flex items-baseline justify-between text-[40px]">
                {filled ? formatToken(totals.received) : `≈ ${formatToken(plan.estOut ?? 0)}`}
                <span className="font-sans text-sm tracking-normal">{plan.boughtSymbol}</span>
              </p>
            </div>
            <dl className="mt-6 space-y-2 border-t border-line pt-6">
              {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 text-[14px]">
                  <dt className="text-fg-soft">{label}</dt>
                  <dd className="num-sm text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div aria-hidden className="mx-6 border-t-2 border-dashed border-line" />
          <div className="relative flex h-[94px] items-center justify-between gap-4 px-6">
            <div className="min-w-0">
              <p className="text-sm text-fg-soft">
                {quote ? "Signed by Zethos" : "Not signed yet"}
              </p>
              <p className="mt-2 truncate font-mono text-xs tabular-nums">
                {quote ? <Signature value={quote.signature} run /> : "Signs when it runs"}
              </p>
            </div>
            {quote && !filled && mission.status !== "failed" && (
              <div className="flex shrink-0 items-center gap-2">
                <Ring left={ttlLeft} total={quote.ttlSec} />
                <span className="num-sm text-sm font-medium">{ttlLeft}s</span>
              </div>
            )}
            {filled && (
              <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium">
                <Check aria-hidden className="size-4" /> Paper fill
              </span>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
