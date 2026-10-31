"use client";
import { ActionPill } from "./action-pill";
import { STATUS_HEADLINE } from "./mission-presentation";
import { MissionTicket } from "./mission-ticket";
import { Result } from "./result";
import { Slices } from "./slices";
import { Steps } from "./steps";
import { TriggerGauge } from "./trigger-gauge";

export { STATUS_LABEL } from "./mission-presentation";

import { ChevronDown } from "lucide-react";
import { isStoppable, type Mission } from "../../../lib/agent/runtime";
import { Rich } from "../../landing/primitives";
import { PriceAnatomy } from "../price-anatomy";
import { ReportView, reportTitle } from "./reports";

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
