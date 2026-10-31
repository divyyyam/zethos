import { z } from "zod";

const positive = z.number().finite().positive();
// An interpretation is a proposed, reviewable instruction, never permission to trade.
export const preparedSwap = z
  .object({
    pair: z.enum(["HSK/USDT", "ETH/USDT"]),
    side: z.enum(["buy", "sell"]),
    amount: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .refine((s) => Number.isFinite(Number(s)) && Number(s) > 0),
    amountIn: z.enum(["base", "quote"]).optional(),
    dryRun: z.boolean().default(true),
    maxCostBps: z.number().finite().nonnegative().max(10000).nullable().default(null),
    expiresInMs: positive.max(86400000).nullable().default(null),
    slices: z
      .object({ count: z.number().int().min(2).max(20), durationMs: positive.max(3600000) })
      .nullable()
      .default(null),
    trigger: z
      .union([
        z.object({ type: z.enum(["above", "below"]), price: positive }),
        z.object({ type: z.enum(["rise", "drop"]), pct: positive.max(100) }),
      ])
      .nullable()
      .default(null),
  })
  .transform((v) => ({
    ...v,
    kind: "swap" as const,
    amountIn: v.amountIn ?? (v.side === "buy" ? ("quote" as const) : ("base" as const)),
  }));

export const prepareDeclaration = {
  name: "prepare_quote",
  description:
    "Understand ordinary English and prepare one reviewable swap or quote. Never executes. Quotes/questions set dryRun true. Preserve every requested constraint; ask for clarification instead of inventing an amount, pair or limit.",
  parameters: {
    type: "OBJECT",
    properties: {
      pair: { type: "STRING", enum: ["HSK/USDT", "ETH/USDT"] },
      side: { type: "STRING", enum: ["buy", "sell"] },
      amount: { type: "STRING" },
      amountIn: {
        type: "STRING",
        enum: ["base", "quote"],
        description:
          "Unit of the user's stated amount. Buying 100 HSK uses base; spending $500 uses quote. Selling 0.1 ETH uses base.",
      },
      dryRun: {
        type: "BOOLEAN",
        description:
          "True for a quote, estimate, how-much question or price check. False for an explicit request to trade; that still creates a draft requiring human authorization.",
      },
      maxCostBps: { type: "NUMBER", nullable: true },
      expiresInMs: { type: "NUMBER", nullable: true },
      slices: {
        type: "OBJECT",
        nullable: true,
        properties: { count: { type: "INTEGER" }, durationMs: { type: "NUMBER" } },
        required: ["count", "durationMs"],
      },
      trigger: {
        type: "OBJECT",
        nullable: true,
        properties: {
          type: { type: "STRING", enum: ["above", "below", "rise", "drop"] },
          price: { type: "NUMBER" },
          pct: { type: "NUMBER" },
        },
        required: ["type"],
      },
    },
    required: ["pair", "side", "amount", "amountIn", "dryRun"],
  },
};
