"use client";
import {
  formatPrice,
  formatToken,
  isActive,
  type Mission,
  missionTotals,
} from "../../../lib/agent/runtime";
import { STATUS_LABEL } from "./mission-card";

export function LedgerRow({
  mission,
  focused,
  onFocus,
  onDismiss,
}: {
  mission: Mission;
  focused: boolean;
  onFocus: () => void;
  onDismiss: () => void;
}) {
  const totals = missionTotals(mission);
  const plan = mission.plan;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 border-t border-line py-3 md:grid-cols-[minmax(0,1fr)_16rem_7rem_auto]">
      <button
        type="button"
        data-cursor="hover"
        aria-current={focused}
        onClick={onFocus}
        className={`min-w-0 truncate text-left ${focused ? "font-medium" : "text-fg-soft hover:text-fg"}`}
      >
        {mission.text}
      </button>
      <span className="num-sm hidden text-sm text-fg-soft md:block">
        {plan && totals.filled > 0
          ? `${formatToken(totals.received)} ${plan.boughtSymbol} at ${totals.avgPrice === null ? "—" : formatPrice(totals.avgPrice)}`
          : ""}
      </span>
      <span className="flex items-center gap-2 text-sm">
        {isActive(mission.status) && (
          <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-fg" />
        )}
        {STATUS_LABEL[mission.status]}
      </span>
      {!isActive(mission.status) && mission.status !== "draft" ? (
        <button
          type="button"
          data-cursor="hover"
          className="hidden text-sm text-fg-soft hover:text-fg md:block"
          onClick={onDismiss}
        >
          Clear
        </button>
      ) : (
        <span className="hidden md:block" />
      )}
    </li>
  );
}
