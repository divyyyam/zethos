"use client";

import { RefreshCw } from "lucide-react";
import {
  formatFractionAsPct,
  formatPct,
  formatUsdOrUnavailable,
} from "../../../lib/engine/desk-types";
import { failureMessage } from "../../../lib/engine/sdk";
import { StatusDot } from "../primitives";
import { ActivePoliciesCard } from "./active-policies-card";
import { InventoryBandCard } from "./inventory-band-card";
import { LossCapCard } from "./loss-cap-card";
import { MandatePairsCard } from "./mandate-pairs-card";
import { ServiceCapsCard } from "./service-caps-card";
import { useDeskController } from "./use-desk-controller";

export function DeskPage() {
  const {
    sample,
    status,
    mandate,
    observedInventory,
    incumbentPolicy,
    canaryPolicy,
    observedLossUsd,
    valuationStale,
    refresh,
    error,
    compliance,
  } = useDeskController();

  const mandateData = mandate.data;
  const pairs = status.data?.pairs ?? [];

  return (
    <>
      <div className="p-page-heading">
        <div>
          <h1>Trading Desk</h1>
          <p>Founder mandate targets, active policy allocations, and live desk compliance.</p>
        </div>
        <div className="p-page-tools">
          <span className="p-pill p-pill-neutral">
            <StatusDot />
            {sample
              ? "Sample mandate & targets"
              : status.data?.mode === "shadow"
                ? "Paper settlement"
                : "Live desk"}
          </span>
          <button
            type="button"
            className="p-icon-button"
            aria-label="Refresh desk data"
            onClick={refresh}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {error && !sample && (
        <p role="alert" className="p-form-error mb-4">
          {failureMessage(error)}{" "}
          <button type="button" className="p-text-button" onClick={refresh}>
            Try again
          </button>
        </p>
      )}

      {/* Summary KPI Cards */}
      <section className="p-metrics-grid mb-6" aria-label="Desk mandate highlights">
        <div className="p-metric p-metric-featured">
          <span>Mandate Pairs</span>
          <strong>{mandateData?.pairs.join(", ") ?? "Unavailable"}</strong>
          <small>{mandateData?.pairs.length ?? 0} active trading pairs</small>
        </div>
        <div className="p-metric">
          <span>Inventory Band</span>
          <strong>
            {mandateData
              ? `${formatFractionAsPct(mandateData.inventory.minShare)} – ${formatFractionAsPct(mandateData.inventory.maxShare)}`
              : "Unavailable"}
          </strong>
          <small>Target 50.0% base share</small>
        </div>
        <div className="p-metric">
          <span>Uptime Commitment</span>
          <strong>{formatPct(mandateData?.service.uptimeTargetPct)}</strong>
          <small>Service level target</small>
        </div>
        <div className="p-metric">
          <span>Operating-Loss Limit</span>
          <strong>{formatUsdOrUnavailable(mandateData?.loss.maxOperatingLossUsd)}</strong>
          <small>Max adverse epoch loss</small>
        </div>
      </section>

      {/* Detailed Mandate Cards */}
      <div className="flex flex-col gap-6">
        <MandatePairsCard mandate={mandateData} pairs={pairs} />
        <InventoryBandCard
          mandate={mandateData}
          observed={observedInventory}
          valuationStale={valuationStale}
        />
        <ServiceCapsCard mandate={mandateData} compliance={compliance.data} />
        <LossCapCard
          mandate={mandateData}
          observedLossUsd={observedLossUsd}
          valuationStale={valuationStale}
        />
        <ActivePoliciesCard
          mandate={mandateData}
          incumbent={incumbentPolicy}
          canary={canaryPolicy}
        />
      </div>
    </>
  );
}
