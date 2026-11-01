"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { type Address, bytesToHex, getAddress } from "viem";
import { useAccount } from "wagmi";
import { AgentRuntime } from "../../lib/agent/runtime";
import { agentZethos } from "../../lib/engine/sdk";
import { settleOnChain } from "../../lib/engine/settle-on-chain";
import { useEngineStatus } from "./use-platform";

/** One agent per tab, outside React, so armed missions keep running across page changes. */
export const agent = new AgentRuntime({ sdk: agentZethos, settleLive: settleOnChain });

/** True when authorized trades settle on-chain from the wallet rather than on paper. */
export function useLiveSettlement(): boolean {
  return useEngineStatus().data?.mode === "live";
}

export function useMissions() {
  return useSyncExternalStore(agent.subscribe, agent.getMissions, agent.getMissions);
}
export function useAgentMarket() {
  return useSyncExternalStore(agent.subscribe, agent.getMarket, agent.getMarket);
}
export function useAgentFeed() {
  useEffect(() => agent.retain(), []);
}

// A sentence typed elsewhere in the shell, waiting for the agent page to draft it.
let queuedIntent: string | null = null;
export const INTENT_EVENT = "zethos:intent";
export function queueIntent(sentence: string): void {
  queuedIntent = sentence;
  window.dispatchEvent(new Event(INTENT_EVENT));
}
export function takeQueuedIntent(): string | null {
  const sentence = queuedIntent;
  queuedIntent = null;
  return sentence;
}

const IDENTITY_KEY = "zethos.agent.identity";

// Paper fills need a taker address, not a signature. Without a wallet, the agent trades under a
// random address local to this browser. No private key exists for it, so it can never hold funds.
function paperIdentity(): Address {
  try {
    const saved = localStorage.getItem(IDENTITY_KEY);
    if (saved && /^0x[\da-fA-F]{40}$/.test(saved)) return getAddress(saved);
  } catch {
    /* Storage may be unavailable; the identity then lasts for this page view. */
  }
  const address = getAddress(bytesToHex(crypto.getRandomValues(new Uint8Array(20))));
  try {
    localStorage.setItem(IDENTITY_KEY, address);
  } catch {
    /* See above. */
  }
  return address;
}

export function useAgentIdentity(): { address: Address; source: "wallet" | "paper" } | null {
  const account = useAccount();
  const [paper, setPaper] = useState<Address | null>(null);
  useEffect(() => setPaper(paperIdentity()), []);
  if (account.address) return { address: account.address, source: "wallet" };
  return paper ? { address: paper, source: "paper" } : null;
}

/** A clock for countdowns; only ticks while a component needs it. */
export function useNow(active = true, intervalMs = 250): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}
