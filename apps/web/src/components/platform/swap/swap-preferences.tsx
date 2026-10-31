"use client";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Modal } from "../primitives";
import type { SwapPageContentState } from "./use-swap-controller";

type Props = Pick<
  SwapPageContentState,
  "settings" | "setSettings" | "autoRefresh" | "setAutoRefresh"
>;

export function SwapPreferences({ settings, setSettings, autoRefresh, setAutoRefresh }: Props) {
  return (
    <Modal
      open={settings}
      onClose={() => setSettings(false)}
      title="Swap preferences"
      className="p-settings-modal"
    >
      <div className="p-settings-content">
        <h2>Preferences</h2>

        <div className="p-preference">
          <div>
            <strong>Price protection</strong>
            <p>Your settled output must beat the pool price.</p>
          </div>
          <span className="p-pill p-pill-success">
            <ShieldCheck size={12} />
            Always on
          </span>
        </div>
        <div className="p-preference">
          <div>
            <strong>Automatic quote refresh</strong>
            <p>Keep your price current while you decide.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            aria-label="Automatic quote refresh"
            className={`p-toggle ${autoRefresh ? "on" : ""}`}
            onClick={() => {
              setAutoRefresh(!autoRefresh);
              try {
                localStorage.setItem("zethos.auto-refresh", String(!autoRefresh));
              } catch {
                /* Local storage may be unavailable. */
              }
            }}
          >
            <span />
          </button>
        </div>
        <div className="p-preference">
          <div>
            <strong>Token approval</strong>
            <p>Approve only what this swap needs.</p>
          </div>
          <span className="p-pill p-pill-neutral">Exact amount</span>
        </div>
        <div className="p-settings-note">
          <LockKeyhole size={16} />
          <p>Your quoted output is fixed. No slippage slider, no unlimited approvals.</p>
        </div>
      </div>
    </Modal>
  );
}
