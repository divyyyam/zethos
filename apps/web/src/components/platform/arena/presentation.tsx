"use client";
import type { Tier } from "@zethos/sdk";

export const flowNames = {
  tape: "Exchange tape",
  user: "People",
  agent: "AI agents",
  attacker: "Attacker",
};

export const flowColors = {
  tape: "#247b64",
  user: "#356bb3",
  agent: "#7955ac",
  attacker: "#b74c35",
};

export const time = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export function TierChip({ tier }: { tier: Tier }) {
  return <span className={`p-pill p-tier p-tier-${tier}`}>{tier}</span>;
}
