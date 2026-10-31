import type { AgentState } from "../agent/types";
import type { Inventory } from "../tokens";
import type { ArenaState, Fill, PolicyRecord, QuoteRecord, Store } from "./index";

export function memoryStore(): Store {
  let arena: ArenaState | null = null;
  const quotes: QuoteRecord[] = [];
  const fills: (Fill & { epoch: number })[] = [];
  const nonces = new Set<string>();
  let state: AgentState | null = null;
  const epochs = new Map<number, AgentState>();
  const policies = new Map<string, PolicyRecord>();

  return {
    loadArena: async () => (arena ? { ...arena, inventory: { ...arena.inventory } } : null),
    startArena: async (startedAt: number, inventory: Inventory) => {
      arena = { epoch: (arena?.epoch ?? 0) + 1, startedAt, inventory: { ...inventory } };
      return arena;
    },
    saveQuote: async (record) => {
      quotes.push(structuredClone({ ...record, status: "issued" as const }));
    },
    loadQuotes: async (epoch) => structuredClone(quotes.filter((q) => q.epoch === epoch)),
    expireQuotes: async (nowSec) => {
      for (const q of quotes)
        if (q.status === "issued" && Number(q.quote.expiry) < nowSec) q.status = "expired";
    },
    nonceUsed: async (taker, nonce) => nonces.has(`${taker.toLowerCase()}:${nonce}`),
    loadState: async (epoch) =>
      structuredClone(epoch === undefined ? state : (epochs.get(epoch) ?? null)),
    saveState: async (value) => {
      state = structuredClone(value);
      epochs.set(value.epoch, structuredClone(value));
    },
    saveFill: async (fill, nonce, epoch, inventory) => {
      const key = `${fill.taker.toLowerCase()}:${nonce}`;
      if (nonces.has(key)) throw new Error("duplicate nonce");
      nonces.add(key);
      fills.push({ ...fill, epoch });
      const record = quotes.find((q) => q.id === fill.quoteId);
      if (record) record.status = "filled";
      if (arena) arena = { ...arena, inventory: { ...inventory } };
    },
    fills: async ({ taker, limit, epoch }) =>
      fills
        .filter(
          (fill) =>
            (epoch === undefined || fill.epoch === epoch) &&
            (!taker || fill.taker.toLowerCase() === taker.toLowerCase()),
        )
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit),
    savePolicy: async (record: PolicyRecord) => {
      policies.set(record.id, structuredClone(record));
    },
    getPolicy: async (id: string) => {
      const record = policies.get(id);
      return record ? structuredClone(record) : null;
    },
    listPolicies: async () =>
      Array.from(policies.values())
        .map((p) => structuredClone(p))
        .sort((a, b) => b.createdAt - a.createdAt),
  };
}
