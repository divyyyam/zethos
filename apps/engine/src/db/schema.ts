import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AgentState } from "../agent/types";

const ms = (name: string) => bigint(name, { mode: "number" });
const uint = (name: string) => numeric(name, { precision: 78, scale: 0 });

export const epochs = pgTable("epochs", {
  epoch: integer().primaryKey(),
  startedAt: ms("started_at").notNull(),
});

export const inventory = pgTable(
  "inventory",
  {
    epoch: integer().notNull(),
    token: text().notNull(),
    amount: uint("amount").notNull(),
  },
  (table) => [primaryKey({ columns: [table.epoch, table.token] })],
);

export const quotes = pgTable(
  "quotes",
  {
    id: text().primaryKey(),
    ts: ms("ts").notNull(),
    epoch: integer().notNull(),
    pair: text().notNull(),
    side: text().notNull(),
    client: text().notNull(),
    taker: text().notNull(),
    tokenIn: text("token_in").notNull(),
    tokenOut: text("token_out").notNull(),
    amountIn: uint("amount_in").notNull(),
    amountOut: uint("amount_out").notNull(),
    nonce: uint("nonce").notNull(),
    issuedAt: uint("issued_at").notNull(),
    expiry: uint("expiry").notNull(),
    status: text().notNull().default("issued"),
    signature: text().notNull(),
    breakdown: jsonb().notNull(),
  },
  (table) => [
    index("quotes_epoch_idx").on(table.epoch),
    uniqueIndex("quotes_taker_nonce_idx").on(table.taker, table.nonce),
  ],
);

export const engineState = pgTable("engine_state", {
  id: text().primaryKey(),
  state: jsonb().$type<AgentState>().notNull(),
});

export const fills = pgTable(
  "fills",
  {
    id: text().primaryKey(),
    quoteId: text("quote_id").notNull().unique("fills_quoteId_unique"),
    ts: ms("ts").notNull(),
    epoch: integer().notNull(),
    pair: text().notNull(),
    side: text().notNull(),
    taker: text().notNull(),
    tokenIn: text("token_in").notNull(),
    tokenOut: text("token_out").notNull(),
    amountIn: uint("amount_in").notNull(),
    amountOut: uint("amount_out").notNull(),
    nonce: uint("nonce").notNull(),
    price: doublePrecision().notNull(),
    midAtFill: doublePrecision("mid_at_fill"),
    flow: text().notNull(),
    gasUsd: doublePrecision("gas_usd").notNull().default(0),
  },
  (table) => [
    uniqueIndex("fills_taker_nonce").on(table.taker, table.nonce),
    index("fills_epoch_ts_idx").on(table.epoch, table.ts),
  ],
);

export const policies = pgTable("policies", {
  id: text().primaryKey(),
  parent: text().notNull(),
  hypothesis: text().notNull(),
  spec: jsonb().notNull(),
  report: jsonb(),
  status: text().notNull(),
  allocationPct: doublePrecision("allocation_pct").notNull().default(0),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});
