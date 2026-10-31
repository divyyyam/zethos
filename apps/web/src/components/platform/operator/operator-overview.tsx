"use client";
import { Command, Pause, Play } from "lucide-react";
import { formatUsd } from "../../../lib/platform-config";
import type { OperatorDashboardState } from "./use-operator-dashboard";

type Props = Pick<
  OperatorDashboardState,
  | "setConfirmControl"
  | "setConfirmReset"
  | "setControlError"
  | "status"
  | "shadow"
  | "owner"
  | "inventory"
  | "paused"
  | "canControl"
> & { preview: boolean };

export function OperatorOverview({
  preview,
  setConfirmControl,
  setConfirmReset,
  setControlError,
  status,
  shadow,
  owner,
  inventory,
  paused,
  canControl,
}: Props) {
  return (
    <div className="p-operator-overview">
      <div>
        <span className="p-overview-icon">
          <Command size={21} strokeWidth={1.5} />
        </span>
        <div>
          <span>Vault status</span>
          <strong>
            {preview
              ? "Normal operation"
              : status.data
                ? paused
                  ? "Vault paused"
                  : status.data.riskState
                : "Awaiting status"}
          </strong>
        </div>
      </div>
      <div>
        <span>Vault value</span>
        <strong>
          {preview
            ? "$48,000.00"
            : status.data?.equityUsd != null
              ? formatUsd(status.data.equityUsd)
              : "—"}
        </strong>
      </div>
      <div>
        <span>Assets under management</span>
        <strong>
          {preview
            ? "3 assets"
            : shadow
              ? "3 paper assets"
              : inventory.data
                ? `${inventory.data.length} assets`
                : "—"}
        </strong>
      </div>
      <button
        type="button"
        className="p-button p-button-secondary"
        disabled={!canControl}
        onClick={() => {
          setControlError(null);
          setConfirmControl(true);
        }}
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
        {paused ? "Resume vault" : "Pause vault"}
      </button>
      {!preview && shadow && (
        <button
          type="button"
          className="p-button p-button-secondary"
          disabled={!owner.isOwner}
          onClick={() => {
            setControlError(null);
            setConfirmReset(true);
          }}
        >
          Reset paper Arena
        </button>
      )}
    </div>
  );
}
