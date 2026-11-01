"use client";

import { ArrowUpRight } from "lucide-react";
import { MotionConfig } from "motion/react";
import { useRouter } from "next/navigation";
import { type PointerEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useEngineStatus } from "../../hooks/platform/use-platform";
import { platformConfig } from "../../lib/platform-config";
import { Cursor } from "../landing/cursor";
import { useWallet } from "../wallet/wallet-provider";
import { StatusDot } from "./primitives";
import { CommandPalette } from "./shell/command-palette";
import { NAV_ITEMS } from "./shell/nav";
import { Sidebar } from "./shell/sidebar";
import { Topbar } from "./shell/topbar";

const COLLAPSED_KEY = "zethos.sidebar.collapsed";

/** Cards light up under the pointer. One listener for the whole page, so cards stay plain markup. */
function spotlight(event: PointerEvent<HTMLElement>) {
  const card = (event.target as Element).closest<HTMLElement>(".d-card, .p-card, .p-metric");
  if (!card) return;
  const box = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${event.clientX - box.left}px`);
  card.style.setProperty("--my", `${event.clientY - box.top}px`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { openNetwork } = useWallet();
  const { isConnected, chainId } = useAccount();
  const status = useEngineStatus();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "true");
    } catch {
      /* Preferences are optional. */
    }
  }, []);
  const toggleSidebar = useCallback(() => {
    setCollapsed((current) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, String(!current));
      } catch {
        /* Preferences are optional. */
      }
      return !current;
    });
  }, []);
  const closePalette = useCallback(() => setPalette(false), []);

  useEffect(() => {
    let leader = 0;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((current) => !current);
        return;
      }
      const target = event.target as HTMLElement;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target.closest("input, textarea, select, dialog, [contenteditable]")
      )
        return;
      if (event.key === "[") toggleSidebar();
      else if (event.key === "g") leader = Date.now();
      else if (Date.now() - leader < 900) {
        const page = NAV_ITEMS.find((item) => item.key === event.key);
        leader = 0;
        if (page && (page.href !== "/operator" || status.data?.operator !== null))
          router.push(page.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, toggleSidebar, status.data?.operator]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="d-app" data-collapsed={collapsed}>
        <a className="p-skip-link" href="#platform-main">
          Skip to main content
        </a>
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleSidebar}
          open={drawer}
          onClose={() => setDrawer(false)}
        />
        <div className="d-column">
          <Topbar onMenu={() => setDrawer(true)} onPalette={() => setPalette(true)} />
          {status.data?.mode !== "shadow" && isConnected && chainId !== platformConfig.chain.id && (
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
          <main id="platform-main" className="p-main d-page" onPointerMove={spotlight}>
            {children}
          </main>
          <footer className="d-footer">
            <span>
              {!status.data
                ? status.isError
                  ? "Engine status unavailable."
                  : "Checking settlement mode…"
                : status.data.mode === "shadow"
                  ? `Shadow mode: ${status.data.dataSource === "replay" ? "replayed" : "live"} exchange prices, paper settlement. No funds move.`
                  : platformConfig.chain.testnet
                    ? `${platformConfig.chain.name}: real settlement with test tokens that have no market value.`
                    : platformConfig.chain.name}
            </span>
            {platformConfig.vaultAddress && (
              <a
                href={`${platformConfig.explorer}/address/${platformConfig.vaultAddress}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Vault contract <ArrowUpRight size={12} aria-hidden />
              </a>
            )}
          </footer>
        </div>
        <CommandPalette open={palette} onClose={closePalette} onToggleSidebar={toggleSidebar} />
        <Cursor />
      </div>
    </MotionConfig>
  );
}
