"use client";

import {
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  ChevronDown,
  CircleHelp,
  Command,
  Layers3,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { useEngineStatus, useEngineStream, useVaultOwner } from "../../hooks/platform/use-platform";
import { platformConfig } from "../../lib/platform-config";
import { LogoMark } from "../landing/logo-mark";
import { ConnectWalletButton, useWallet } from "../wallet/wallet-provider";
import { StatusDot } from "./primitives";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { openNetwork } = useWallet();
  const { isOwner } = useVaultOwner();
  const { isConnected, chainId } = useAccount();
  const status = useEngineStatus();
  const streaming = useEngineStream();
  const nav = [
    { href: "/app", label: "Swap", icon: ArrowLeftRight },
    { href: "/stats", label: "Insights", icon: BarChart3 },
    ...(isOwner ? [{ href: "/operator", label: "Workspace", icon: Command }] : []),
  ];
  return (
    <>
      <a className="p-skip-link" href="#platform-main">
        Skip to main content
      </a>
      <header className="p-header">
        <div className="p-header-inner">
          <Link className="p-brand group" href="/" aria-label="Zethos home">
            <LogoMark className="size-7" motion="hover" />
            <span>zethos</span>
          </Link>
          <nav className="p-navigation" aria-label="App navigation">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                className={pathname === href ? "active" : ""}
              >
                <Icon size={15} aria-hidden />
                {label}
              </Link>
            ))}
          </nav>
          <div className="p-header-actions">
            <button type="button" className="p-network-button" onClick={openNetwork}>
              <span className="p-chain-mark" aria-hidden>
                H
              </span>
              <span>
                HashKey<small>{platformConfig.chain.testnet ? "Testnet" : "Chain"}</small>
              </span>
              <ChevronDown size={12} aria-hidden />
            </button>
            <ConnectWalletButton />
          </div>
        </div>
      </header>
      {isConnected && chainId !== platformConfig.chain.id && (
        <div className="p-network-banner">
          <span>
            <StatusDot tone="warning" />
            Your wallet is on a different network.
          </span>
          <button type="button" onClick={openNetwork}>
            Switch to {platformConfig.chain.name}
            <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      <main id="platform-main" className="p-main">
        {children}
      </main>
      <footer className="p-footer">
        <div className="p-footer-status">
          <StatusDot tone={status.data && !status.data.paused ? "success" : "neutral"} />
          <span>
            {!platformConfig.engineUrl
              ? "Preview environment"
              : status.isError
                ? "Service unavailable"
                : status.data?.paused
                  ? "Vault paused"
                  : status.data
                    ? streaming
                      ? "Connected to the market"
                      : "Market service connected"
                    : "Connecting to the market"}
          </span>
          <span className="p-footer-separator">/</span>
          <span>{platformConfig.chain.name}</span>
        </div>
        <div className="p-footer-links">
          <Link href="/operator">
            <Layers3 size={13} />
            Operator workspace
          </Link>
          <a
            href="https://github.com/divyyyam/zethos/tree/main/docs"
            target="_blank"
            rel="noreferrer noopener"
          >
            <CircleHelp size={13} />
            Documentation
            <ArrowUpRight size={12} />
          </a>
          {platformConfig.vaultAddress && (
            <a
              href={`${platformConfig.explorer}/address/${platformConfig.vaultAddress}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Vault contract
              <ArrowUpRight size={12} />
            </a>
          )}
        </div>
      </footer>
    </>
  );
}
