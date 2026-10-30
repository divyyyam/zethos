"use client";

import { ArrowUpRight, Check, ChevronDown, CircleDashed, X } from "lucide-react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import type { ReactNode } from "react";
import { useNow } from "../../../hooks/platform/use-agent";
import { useFinePointerDesktop, useReducedMotionPref } from "../../../hooks/use-media-query";
import {
  formatBps,
  formatPrice,
  formatToken,
  isStoppable,
  MARKOUT_HORIZONS,
  type Mission,
  type MissionStatus,
  missionTotals,
  STAGES,
  type Stage,
} from "../../../lib/agent/runtime";
import { shortAddress } from "../../../lib/platform-config";
import { Magnetic } from "../../landing/magnetic";
import { Rich } from "../../landing/primitives";
import { Ring, Signature } from "../../landing/quote-anatomy";
import { PriceAnatomy } from "../price-anatomy";
import { ReportView, reportTitle } from "./reports";

export const STATUS_LABEL: Record<MissionStatus, string> = {
  draft: "Awaiting you",
  armed: "Armed",
  running: "Running",
  holding: "Holding",
  measuring: "Measuring",
  done: "Done",
  stopped: "Stopped",
  failed: "Failed",
};
const STAGE_LABEL: Record<Stage, string> = {
  sense: "Sense",
  price: "Price",
  verify: "Verify",
  guard: "Guard",
  settle: "Settle",
  measure: "Measure",
};
const STAGE_PLAN: Record<Stage, string> = {
  sense: "Read every venue and the vault",
  price: "Get a firm signed quote",
  verify: "Check the signature and terms itself",
  guard: "Refuse anything over your limit",
  settle: "Fill in the paper vault",
  measure: "See how the price moved after",
};

const TILT = { stiffness: 140, damping: 18, mass: 0.6 };

/** The landing's quote ticket, with this mission's real terms on it. */
function MissionTicket({ mission }: { mission: Mission }) {
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
    ["Settlement", mission.dryRun ? "None, dry run" : "Paper vault"],
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

function Steps({ mission }: { mission: Mission }) {
  return (
    <ol className="mt-5" aria-label="Mission progress">
      {STAGES.map((stage, index) => {
        const { state, detail } = mission.stages[stage];
        return (
          <li
            key={stage}
            data-state={state}
            className="a-step grid grid-cols-[1.75rem_6.5rem_minmax(0,1fr)] items-baseline gap-2 border-t border-line py-2.5"
          >
            <span className="num-sm text-sm text-fg-faint">{index + 1}</span>
            <span className="t-title !text-[22px]">{STAGE_LABEL[stage]}</span>
            <span className="flex min-w-0 items-center justify-end gap-2 text-right text-sm text-fg-soft">
              <span className="sr-only">{state}. </span>
              {detail ?? (state === "idle" ? STAGE_PLAN[stage] : "")}
              {state === "active" && (
                <span aria-hidden className="pulse-dot size-1.5 shrink-0 rounded-full bg-white" />
              )}
              {state === "done" && <Check aria-hidden className="size-3.5 shrink-0" />}
              {state === "failed" && <X aria-hidden className="size-3.5 shrink-0" />}
              {state === "skipped" && <CircleDashed aria-hidden className="size-3.5 shrink-0" />}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Countdown({ until, label }: { until: number; label: string }) {
  const now = useNow();
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <span className="num-sm text-sm">
      {label} {left >= 60 ? `${Math.floor(left / 60)}m ${left % 60}s` : `${left}s`}
    </span>
  );
}

function TriggerGauge({ mission }: { mission: Mission }) {
  const trigger = mission.trigger;
  if (!trigger) return null;
  const { referenceMid, currentMid, targetPrice, direction, firedAt, expiresAt } = trigger;
  const span = Math.abs(targetPrice - referenceMid) || 1;
  const moved = direction === "below" ? referenceMid - currentMid : currentMid - referenceMid;
  const progress = firedAt ? 100 : Math.min(100, Math.max(0, (moved / span) * 100));
  const away = (Math.abs(currentMid - targetPrice) / currentMid) * 10_000;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[15px]">Acts when {trigger.label}</p>
        {firedAt ? (
          <span className="text-sm font-medium">Fired</span>
        ) : mission.status === "armed" ? (
          <Countdown until={expiresAt} label="Expires in" />
        ) : (
          <span className="text-sm">Not fired</span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Distance moved toward the trigger"
        className="mt-3 h-[2px] bg-line"
      >
        <div
          className="h-full bg-fg transition-[width] duration-700 ease-expo"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="num-sm mt-2 flex justify-between gap-3 text-sm text-fg-soft">
        <span>Armed at {formatPrice(referenceMid)}</span>
        <span className="text-fg">
          Mid {formatPrice(currentMid)}
          {!firedAt && `, ${away.toFixed(1)} bps away`}
        </span>
        <span>Target {formatPrice(targetPrice)}</span>
      </div>
    </div>
  );
}

function Slices({ mission }: { mission: Mission }) {
  if (mission.slices.length < 2) return null;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex justify-between gap-3 text-sm text-fg-soft">
        <span>
          {mission.slices.filter((slice) => slice.state === "filled").length} of{" "}
          {mission.slices.length} slices filled
        </span>
        {mission.nextSliceAt && <Countdown until={mission.nextSliceAt} label="Next in" />}
      </div>
      <div className="mt-3 grid auto-cols-fr grid-flow-col gap-1">
        {mission.slices.map((slice) => (
          <span
            key={slice.index}
            data-state={slice.state}
            title={
              slice.price
                ? `Slice ${slice.index + 1}: ${formatPrice(slice.price)}, ${slice.vsMidBps?.toFixed(1)} bps from mid`
                : `Slice ${slice.index + 1}: ${slice.state}`
            }
            className="a-slice num-sm overflow-hidden rounded-md border border-line py-1 text-center text-[11px] whitespace-nowrap"
          >
            {slice.price ? formatPrice(slice.price) : slice.index + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

function Result({ mission }: { mission: Mission }) {
  const totals = missionTotals(mission);
  if (totals.filled === 0) return null;
  const last = mission.slices.filter((slice) => slice.state === "filled").at(-1);
  return (
    <dl className="mt-5 grid gap-x-block gap-y-4 border-t border-line pt-4 sm:grid-cols-2">
      <div>
        <dt className="text-sm text-fg-soft">Average price</dt>
        <dd className="num mt-1.5 text-[max(1.75rem,calc(var(--cw)*0.026))]">
          {totals.avgPrice === null ? "—" : formatPrice(totals.avgPrice)}
        </dd>
        <dd className="mt-1 text-sm text-fg-soft">
          {totals.costBps === null
            ? "Arrival mid unknown"
            : `${totals.costBps.toFixed(1)} bps from arrival mid`}
        </dd>
      </div>
      <div>
        <dt className="text-sm text-fg-soft">Mid versus your fill price, after</dt>
        <dd className="mt-2 flex gap-4">
          {MARKOUT_HORIZONS.map((horizon) => {
            const value = last?.markouts[horizon];
            return (
              <span key={horizon} className="grid">
                <small className="text-[13px] text-fg-soft">{horizon}s</small>
                <span className="num-sm text-[15px]">
                  {value === undefined ? "…" : formatBps(value)}
                </span>
              </span>
            );
          })}
        </dd>
      </div>
    </dl>
  );
}

/** The landing's primary pill and rolling arrow, as a button. */
function ActionPill({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Magnetic strength={0.22}>
      <button
        type="button"
        onClick={onClick}
        data-cursor="hover"
        className="group inline-flex h-14 items-center gap-5 rounded-full bg-fg pr-2 pl-6 text-[15px] font-medium text-inverse transition-transform duration-500 ease-expo active:scale-[0.97]"
      >
        <span>{children}</span>
        <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-full bg-inverse text-fg">
          <ArrowUpRight
            aria-hidden
            className="size-[45%] transition-transform duration-500 ease-expo group-hover:translate-x-[180%] group-hover:-translate-y-[180%]"
          />
          <ArrowUpRight
            aria-hidden
            className="absolute size-[45%] -translate-x-[180%] translate-y-[180%] transition-transform duration-500 ease-expo group-hover:translate-x-0 group-hover:translate-y-0"
          />
        </span>
      </button>
    </Magnetic>
  );
}

const STATUS_HEADLINE: Record<MissionStatus, string> = {
  draft: "Your limits, *your go-ahead.*",
  armed: "Armed, *and watching.*",
  running: "On it, *right now.*",
  holding: "Holding *for a better price.*",
  measuring: "Filled. *Measuring.*",
  done: "Done, *with receipts.*",
  stopped: "Stopped.",
  failed: "It *refused.*",
};

/** Everything about one mission, set in a world window. */
export function MissionStage({
  mission,
  onAuthorize,
  onDiscard,
  onStop,
  onRun,
}: {
  mission: Mission;
  onAuthorize: () => void;
  onDiscard: () => void;
  onStop: () => void;
  onRun: (text: string) => void;
}) {
  if (!mission.plan) {
    return (
      <div className="a-sheet mx-auto w-full max-w-[760px] rounded-[22px] p-6 shadow-[0_60px_120px_-30px_rgb(5_5_27/0.8)] md:p-8">
        <p className="mb-3 text-sm text-fg-soft">“{mission.text}”</p>
        {mission.status === "running" && (
          <p className="t-title mt-3 !text-[30px]">
            <span aria-hidden className="pulse-dot mr-3 inline-block size-2 rounded-full bg-fg" />
            Reading the engine
          </p>
        )}
        {mission.error && (
          <>
            <p className="t-title mt-3 !text-[30px]">It couldn’t answer.</p>
            <p role="alert" className="mt-3 text-fg-soft">
              {mission.error}
            </p>
          </>
        )}
        {mission.report && (
          <>
            <h3 className="t-title !text-[34px]">
              <Rich text={reportTitle(mission.report)} />
            </h3>
            <ReportView report={mission.report} onRun={onRun} />
          </>
        )}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-block lg:grid-cols-[minmax(0,410px)_minmax(0,1fr)]">
      <MissionTicket mission={mission} />
      <div className="ink-light min-w-0">
        <p className="eyebrow mb-3 text-fg-soft">“{mission.text}”</p>
        <h3 className="display t-statement text-fg">
          <Rich text={STATUS_HEADLINE[mission.status]} />
        </h3>
        {mission.error && (
          <p role="alert" className="lead mt-4 font-medium">
            {mission.error}
          </p>
        )}
        {mission.plan.notes.map((note) => (
          <p key={note} className="mt-3 text-[15px] text-fg-soft">
            {note}
          </p>
        ))}
        <TriggerGauge mission={mission} />
        {(mission.status !== "armed" || !mission.trigger) && <Steps mission={mission} />}
        <Slices mission={mission} />
        <Result mission={mission} />
        {mission.status === "draft" && (
          <div className="mt-6 flex flex-wrap items-center gap-6">
            <ActionPill onClick={onAuthorize}>
              {mission.dryRun ? "Run it dry" : "Authorize"}
            </ActionPill>
            <button type="button" className="font-medium" data-cursor="hover" onClick={onDiscard}>
              Discard
            </button>
            <span className="text-sm text-fg-soft">
              Paper only. No funds move and no wallet prompt.
            </span>
          </div>
        )}
        {isStoppable(mission.status) && (
          <button
            type="button"
            className="mt-5 font-medium underline underline-offset-4"
            data-cursor="hover"
            onClick={onStop}
          >
            Stop this mission
          </button>
        )}
      </div>
    </div>
  );
}

/** On paper, under the window: the price's make-up and the full trace. */
export function MissionDetail({ mission }: { mission: Mission }) {
  if (!mission.quote && mission.log.length === 0) return null;
  return (
    <div className="grid gap-x-block gap-y-8 md:grid-cols-2">
      {mission.quote && (
        <div className="border-t border-line pt-6">
          <h3 className="t-title text-fg">
            Why this <em>price</em>
          </h3>
          <div className="mt-4 text-[14px]">
            <PriceAnatomy breakdown={mission.quote.breakdown} vsMidBps={mission.quote.vsMidBps} />
          </div>
          <p className="mt-4 font-mono text-xs break-all text-fg-faint">
            {mission.quote.id} · nonce {mission.quote.nonce.slice(0, 16)}…
          </p>
        </div>
      )}
      {mission.log.length > 0 && (
        <details className="a-why border-t border-line pt-6" open>
          <summary className="flex items-center justify-between">
            <h3 className="t-title text-fg">
              What it <em>did</em>
            </h3>
            <ChevronDown
              aria-hidden
              className="size-5 transition-transform duration-500 ease-expo"
            />
          </summary>
          <ol className="mt-4 space-y-2 text-[14px]">
            {mission.log.map((line, index) => (
              // Log lines are append-only, so position is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <li key={index} className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-2">
                <time className="num-sm text-fg-faint">
                  {new Date(line.t).toLocaleTimeString("en-GB", { hour12: false })}
                </time>
                <span
                  className={
                    line.tone === "bad" || line.tone === "warn" ? "font-medium" : "text-fg-soft"
                  }
                >
                  {line.text}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
