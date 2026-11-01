"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";
import type { Attempt } from "../../../lib/arena/attack";
import { formatFractionAsPct, formatUsdOrUnavailable } from "../../../lib/engine/desk-types";
import { failureMessage, zethos } from "../../../lib/engine/sdk";
import { platformConfig } from "../../../lib/platform-config";
import { useWallet } from "../../wallet/wallet-provider";
import { ExternalLink, StatusDot } from "../primitives";
import { ActivePoliciesCard } from "./active-policies-card";
import { DeskTester } from "./desk-tester";
import { InventoryBandCard } from "./inventory-band-card";
import { LossCapCard } from "./loss-cap-card";
import { MandatePairsCard } from "./mandate-pairs-card";
import { ServiceCapsCard } from "./service-caps-card";
import { useDeskController } from "./use-desk-controller";

export function DeskPage() {
  const account = useAccount();
  const { openWallet } = useWallet();
  const verified = useQuery<{ quoteId: string; route: string }>({
    queryKey: ["desk", "verifiedQuote", account.address],
    queryFn: skipToken,
  });
  const attempts = useQuery<Attempt[]>({
    queryKey: ["arena", "sessionAttempts"],
    queryFn: skipToken,
  });
  const myFills = useQuery({
    queryKey: ["engine", "fills", "guided", account.address],
    queryFn: async () => {
      if (!zethos || !account.address) throw new Error("Connect a wallet and engine.");
      return zethos.fills({ taker: account.address, limit: 100 });
    },
    enabled: Boolean(zethos && account.address),
    refetchInterval: 15000,
    retry: false,
  });
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
  const traded =
    myFills.data?.some((fill) =>
      status.data?.mode === "live" ? !fill.paper : status.data?.mode === "shadow" && fill.paper,
    ) ?? false;
  const vault =
    status.data?.verifyingContract && status.data.verifyingContract !== zeroAddress
      ? status.data.verifyingContract
      : platformConfig.vaultAddress;

  return (
    <>
      <section className="p-card mb-6" aria-label="Guided start">
        <div className="flex flex-wrap gap-4">
          <button type="button" className="p-text-button" onClick={openWallet}>
            {account.isConnected ? "✓" : "1."} Connect wallet
          </button>
          <a className="p-text-link" href="#test-the-desk">
            {verified.data ? "✓" : "2."} Test a quote
          </a>
          <a className="p-text-link" href="#test-the-desk">
            {traded ? "✓" : "3."} Make a trade
          </a>
          <Link className="p-text-link" href="/arena#launch-attack">
            {attempts.data?.length ? "✓" : "4."} Try an attack
          </Link>
        </div>
        <p className="p-card-footnote">
          {status.data?.mode === "live"
            ? status.data.chainId === 133
              ? "Live vault settlement on HashKey testnet with test tokens."
              : "Live vault settlement on HashKey Chain."
            : status.data?.mode === "shadow"
              ? "Paper quotes and simulated fills; no tokens move."
              : zethos
                ? "Checking the engine’s current mode…"
                : "No engine is configured."}{" "}
          {vault && (
            <ExternalLink href={`${platformConfig.explorer}/address/${vault}`}>
              View vault
            </ExternalLink>
          )}
        </p>
      </section>
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
          <span>Operating-Loss Limit</span>
          <strong>{formatUsdOrUnavailable(mandateData?.loss.maxOperatingLossUsd)}</strong>
          <small>Max adverse epoch loss</small>
        </div>
      </section>

      <DeskTester mandate={mandateData} />

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
