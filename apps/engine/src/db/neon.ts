import { and, desc, eq, lt, max } from "drizzle-orm";
import { getAddress } from "viem";
import type { Pair, Side } from "../config";
import type { PolicyLifecycleStatus } from "../policy";
import { type Inventory, TOKEN_SYMBOLS } from "../tokens";
import { createDb } from "./db";
import type { Fill, Flow, PolicyRecord, QuoteRecord, Store } from "./index";
import * as schema from "./schema";

export function neonStore(url: string): Store {
  const db = createDb(url);

  const inventoryRows = (epoch: number, inventory: Inventory) =>
    TOKEN_SYMBOLS.map((token) => ({ epoch, token, amount: inventory[token].toString() }));

  return {
    async loadArena() {
      const [latest] = await db.select({ epoch: max(schema.epochs.epoch) }).from(schema.epochs);
      if (latest?.epoch == null) return null;
      const epoch = latest.epoch;
      const [row] = await db.select().from(schema.epochs).where(eq(schema.epochs.epoch, epoch));
      const rows = await db
        .select()
        .from(schema.inventory)
        .where(eq(schema.inventory.epoch, epoch));
      const inventory = Object.fromEntries(
        TOKEN_SYMBOLS.map((token) => [
          token,
          BigInt(rows.find((item) => item.token === token)?.amount ?? "0"),
        ]),
      ) as Inventory;
      return { epoch, startedAt: row?.startedAt ?? 0, inventory };
    },

    async startArena(startedAt, inventory) {
      const [latest] = await db.select({ epoch: max(schema.epochs.epoch) }).from(schema.epochs);
      const epoch = (latest?.epoch ?? 0) + 1;
      await db.batch([
        db.insert(schema.epochs).values({ epoch, startedAt }),
        db.insert(schema.inventory).values(inventoryRows(epoch, inventory)),
      ]);
      return { epoch, startedAt, inventory };
    },

    async saveQuote(record) {
      await db.insert(schema.quotes).values({
        id: record.id,
        policyId: record.policyId,
        ts: record.ts,
        epoch: record.epoch,
        pair: record.pair,
        side: record.side,
        client: record.client,
        taker: record.quote.taker.toLowerCase(),
        tokenIn: record.quote.tokenIn,
        tokenOut: record.quote.tokenOut,
        amountIn: record.quote.amountIn,
        amountOut: record.quote.amountOut,
        nonce: record.quote.nonce,
        issuedAt: record.quote.issuedAt,
        expiry: record.quote.expiry,
        signature: record.signature,
        breakdown: record.breakdown,
      });
    },

    async loadQuotes(epoch) {
      const rows = await db.select().from(schema.quotes).where(eq(schema.quotes.epoch, epoch));
      return rows.map(
        (row): QuoteRecord => ({
          id: row.id,
          policyId: row.policyId,
          ts: row.ts,
          epoch: row.epoch,
          pair: row.pair as Pair,
          side: row.side as Side,
          client: row.client,
          signature: row.signature as `0x${string}`,
          breakdown: row.breakdown,
          status: row.status as NonNullable<QuoteRecord["status"]>,
          quote: {
            taker: row.taker,
            tokenIn: row.tokenIn,
            tokenOut: row.tokenOut,
            amountIn: row.amountIn,
            amountOut: row.amountOut,
            nonce: row.nonce,
            issuedAt: row.issuedAt,
            expiry: row.expiry,
          },
        }),
      );
    },

    async expireQuotes(nowSec) {
      await db
        .update(schema.quotes)
        .set({ status: "expired" })
        .where(and(eq(schema.quotes.status, "issued"), lt(schema.quotes.expiry, String(nowSec))));
    },

    async nonceUsed(taker, nonce) {
      const rows = await db
        .select({ id: schema.fills.id })
        .from(schema.fills)
        .where(and(eq(schema.fills.taker, taker.toLowerCase()), eq(schema.fills.nonce, nonce)))
        .limit(1);
      return rows.length > 0;
    },

    async loadState(epoch) {
      if (epoch === undefined) {
        const [latest] = await db.select({ epoch: max(schema.epochs.epoch) }).from(schema.epochs);
        epoch = latest?.epoch ?? undefined;
      }
      if (epoch === undefined) return null;
      const [row] = await db
        .select()
        .from(schema.engineState)
        .where(eq(schema.engineState.id, `epoch:${epoch}`));
      return row?.state ?? null;
    },

    async saveState(state) {
      await db
        .insert(schema.engineState)
        .values({ id: `epoch:${state.epoch}`, state })
        .onConflictDoUpdate({ target: schema.engineState.id, set: { state } });
    },

    async saveFill(fill, nonce, epoch, inventory) {
      await db.batch([
        db.insert(schema.fills).values({
          id: fill.id,
          policyId: fill.policyId,
          quoteId: fill.quoteId,
          ts: fill.ts,
          epoch,
          pair: fill.pair,
          side: fill.side,
          taker: fill.taker.toLowerCase(),
          tokenIn: fill.tokenIn,
          tokenOut: fill.tokenOut,
          amountIn: fill.amountIn,
          amountOut: fill.amountOut,
          nonce,
          price: fill.price,
          midAtFill: fill.midAtFill,
          flow: fill.flow,
          gasUsd: fill.gasUsd ?? 0,
        }),
        db
          .update(schema.quotes)
          .set({ status: "filled" })
          .where(eq(schema.quotes.id, fill.quoteId)),
        ...inventoryRows(epoch, inventory).map((row) =>
          db
            .insert(schema.inventory)
            .values(row)
            .onConflictDoUpdate({
              target: [schema.inventory.epoch, schema.inventory.token],
              set: { amount: row.amount },
            }),
        ),
      ]);
    },

    async fills({ taker, limit, epoch }) {
      const rows = await db
        .select()
        .from(schema.fills)
        .where(
          and(
            taker ? eq(schema.fills.taker, taker.toLowerCase()) : undefined,
            epoch === undefined ? undefined : eq(schema.fills.epoch, epoch),
          ),
        )
        .orderBy(desc(schema.fills.ts))
        .limit(limit);
      return rows.map(
        (row): Fill => ({
          id: row.id,
          quoteId: row.quoteId,
          policyId: row.policyId,
          ts: row.ts,
          taker: getAddress(row.taker),
          pair: row.pair as Pair,
          side: row.side as Side,
          tokenIn: getAddress(row.tokenIn),
          tokenOut: getAddress(row.tokenOut),
          amountIn: row.amountIn,
          amountOut: row.amountOut,
          price: row.price,
          midAtFill: row.midAtFill,
          flow: row.flow as Flow,
          paper: true,
          txHash: null,
          gasUsd: row.gasUsd,
          epoch: row.epoch,
        }),
      );
    },

    async savePolicy(record: PolicyRecord) {
      await db
        .insert(schema.policies)
        .values({
          id: record.id,
          parent: record.parent,
          hypothesis: record.hypothesis,
          spec: record.spec,
          report: record.report,
          status: record.status,
          allocationPct: record.allocationPct,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        })
        .onConflictDoUpdate({
          target: schema.policies.id,
          set: {
            parent: record.parent,
            hypothesis: record.hypothesis,
            spec: record.spec,
            report: record.report,
            status: record.status,
            allocationPct: record.allocationPct,
            updatedAt: record.updatedAt,
          },
        });
    },

    async getPolicy(id: string) {
      const [row] = await db.select().from(schema.policies).where(eq(schema.policies.id, id));
      if (!row) return null;
      return {
        id: row.id,
        parent: row.parent,
        hypothesis: row.hypothesis,
        spec: row.spec as PolicyRecord["spec"],
        report: (row.report ?? null) as PolicyRecord["report"],
        status: row.status as PolicyLifecycleStatus,
        allocationPct: row.allocationPct,
        createdAt: Number(row.createdAt),
        updatedAt: Number(row.updatedAt),
      };
    },

    async listPolicies() {
      const rows = await db.select().from(schema.policies).orderBy(desc(schema.policies.createdAt));
      return rows.map((row) => ({
        id: row.id,
        parent: row.parent,
        hypothesis: row.hypothesis,
        spec: row.spec as PolicyRecord["spec"],
        report: (row.report ?? null) as PolicyRecord["report"],
        status: row.status as PolicyLifecycleStatus,
        allocationPct: row.allocationPct,
        createdAt: Number(row.createdAt),
        updatedAt: Number(row.updatedAt),
      }));
    },
  };
}
