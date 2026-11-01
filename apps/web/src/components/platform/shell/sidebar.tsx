"use client";

import { ArrowUpRight, CircleHelp, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMissions } from "../../../hooks/platform/use-agent";
import { useEngineStatus } from "../../../hooks/platform/use-platform";
import { isActive } from "../../../lib/agent/runtime";
import { formatUsd } from "../../../lib/platform-config";
import { LogoMark } from "../../landing/logo-mark";
import { NAV_GROUPS } from "./nav";

export function Sidebar({
  collapsed,
  onToggle,
  open,
  onClose,
}: {
  collapsed: boolean;
  onToggle: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const status = useEngineStatus();
  const missions = useMissions();
  const still = useReducedMotion();
  const running = missions.filter((mission) => isActive(mission.status)).length;
  const waiting = missions.filter((mission) => mission.status === "draft").length;
  const equity = status.data?.equityUsd ?? null;
  return (
    <>
      {open && (
        <button type="button" className="d-scrim" aria-label="Close menu" onClick={onClose} />
      )}
      <aside className="d-sidebar" data-open={open}>
        <div className="d-sidebar-top">
          <Link className="d-brand group" href="/" aria-label="Zethos home">
            <LogoMark className="size-7 shrink-0" motion="hover" />
            <span className="d-hide-collapsed">zethos</span>
          </Link>
          <button
            type="button"
            className="d-icon d-hide-collapsed d-collapse"
            aria-label="Collapse sidebar"
            title="Collapse sidebar  ["
            onClick={onToggle}
          >
            <PanelLeftClose size={17} aria-hidden />
          </button>
        </div>

        <nav className="d-nav" aria-label="App navigation">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="d-nav-group">
              <p className="d-nav-title">
                <span className="d-hide-collapsed">{group.title}</span>
              </p>
              {group.items.map(({ href, label, icon: Icon, key }) => {
                if (href === "/operator" && status.data?.operator === null) return null;
                const active = pathname === href;
                const badge = href === "/agent" ? running + waiting : 0;
                return (
                  <Link
                    key={href}
                    href={href}
                    data-tip={label}
                    data-cursor="hover"
                    aria-current={active ? "page" : undefined}
                    className="d-nav-link"
                    onClick={onClose}
                  >
                    {active && (
                      <motion.span
                        {...(still ? {} : { layoutId: "d-nav-active" })}
                        className="d-nav-active"
                        transition={{ type: "spring", stiffness: 420, damping: 36 }}
                      />
                    )}
                    <Icon size={17} aria-hidden className="relative shrink-0" />
                    <span className="d-hide-collapsed relative flex-1">{label}</span>
                    {badge > 0 ? (
                      <span className="d-nav-badge" title={`${badge} open missions`}>
                        {badge}
                      </span>
                    ) : (
                      <kbd className="d-nav-key d-hide-collapsed">g {key}</kbd>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="d-sidebar-foot">
          <Link href="/arena" className="d-vault d-hide-collapsed" data-cursor="hover">
            <span className="d-vault-head">
              <span>{status.data?.mode === "live" ? "Vault" : "Paper vault"}</span>
              <ArrowUpRight size={13} aria-hidden />
            </span>
            <strong className="num">{equity === null ? "—" : formatUsd(equity)}</strong>
            <span className="d-vault-state">
              {status.data
                ? status.data.paused
                  ? "Paused"
                  : `Risk ${status.data.riskState}`
                : status.isError
                  ? "Engine unavailable"
                  : "Connecting"}
            </span>
          </Link>
          <a
            className="d-nav-link"
            data-tip="Documentation"
            href="https://github.com/divyyyam/zethos#readme"
            target="_blank"
            rel="noreferrer noopener"
          >
            <CircleHelp size={17} aria-hidden className="shrink-0" />
            <span className="d-hide-collapsed flex-1">Documentation</span>
          </a>
          {collapsed && (
            <button
              type="button"
              className="d-nav-link d-expand"
              data-tip="Expand sidebar"
              aria-label="Expand sidebar"
              onClick={onToggle}
            >
              <PanelLeftOpen size={17} aria-hidden className="shrink-0" />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
