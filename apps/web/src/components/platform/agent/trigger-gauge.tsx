"use client";
import { useNow } from "../../../hooks/platform/use-agent";
import { formatPrice, type Mission } from "../../../lib/agent/runtime";

export function Countdown({ until, label }: { until: number; label: string }) {
  const now = useNow();
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <span className="num-sm text-sm">
      {label} {left >= 60 ? `${Math.floor(left / 60)}m ${left % 60}s` : `${left}s`}
    </span>
  );
}

export function TriggerGauge({ mission }: { mission: Mission }) {
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
