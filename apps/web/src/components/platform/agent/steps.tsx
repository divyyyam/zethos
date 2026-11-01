"use client";
import { Check, CircleDashed, X } from "lucide-react";
import { useLiveSettlement } from "../../../hooks/platform/use-agent";
import { type Mission, STAGES } from "../../../lib/agent/runtime";
import { STAGE_LABEL, STAGE_PLAN } from "./mission-presentation";

export function Steps({ mission }: { mission: Mission }) {
  const live = useLiveSettlement();
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
              {detail ??
                (state === "idle"
                  ? stage === "settle" && live
                    ? "Sign and fill on-chain from your wallet"
                    : STAGE_PLAN[stage]
                  : "")}
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
