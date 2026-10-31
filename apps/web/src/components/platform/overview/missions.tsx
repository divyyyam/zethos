"use client";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { agent, useMissions } from "../../../hooks/platform/use-agent";
import { formatToken, isActive, isStoppable, missionTotals } from "../../../lib/agent/runtime";
import { STATUS_LABEL } from "../agent/mission-card";
import { queueAndGo } from "./model";

export function Missions() {
  const missions = useMissions();
  const swaps = missions.filter((mission) => mission.plan).slice(0, 5);
  if (swaps.length === 0)
    return (
      <div className="d-empty">
        <p>No missions this session.</p>
        <button type="button" data-cursor="hover" onClick={() => queueAndGo("Buy 500 USDT of HSK")}>
          Try “Buy 500 USDT of HSK”
          <ArrowUpRight size={13} aria-hidden />
        </button>
      </div>
    );
  return (
    <ol className="d-missions">
      {swaps.map((mission) => {
        const totals = missionTotals(mission);
        return (
          <li key={mission.id}>
            <Link href="/agent" data-cursor="hover">
              <span className="d-mission-text">{mission.text}</span>
              <small>
                {totals.filled > 0 && mission.plan
                  ? `${formatToken(totals.received)} ${mission.plan.boughtSymbol}`
                  : STATUS_LABEL[mission.status]}
              </small>
            </Link>
            {isActive(mission.status) && (
              <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-[#5b4fd1]" />
            )}
            {isStoppable(mission.status) && (
              <button type="button" data-cursor="hover" onClick={() => agent.stop(mission.id)}>
                Stop
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
