import { type FillCalls, resolveQuoteIntent, schemas, type Zethos, ZethosError } from "@zethos/sdk";
import { encodeFunctionData, formatUnits } from "viem";
import { z } from "zod";
import { type Config, decimal } from "./config.js";
import { failure, ToolError } from "./errors.js";
import { notional, perSwap, usdUnits } from "./limits.js";
import { type Ledger, makeEntry, type StoredResult } from "./store.js";

export const inputs = {
  get_market: z.strictObject({ pair: schemas.pair.optional() }),
  get_market_status: z.strictObject({ pair: schemas.pair.optional() }),
  get_quote: z.strictObject({
    pair: schemas.pair,
    side: schemas.side,
    amount: decimal.describe(
      "Decimal amount of the token SOLD: USDT for buy, HSK/ETH for sell. Never guess an amount.",
    ),
  }),
  verify_quote: z.strictObject({ quoteId: z.string().min(1).max(100) }),
  execute_swap: z.strictObject({ quoteId: z.string().min(1).max(100), confirm: z.literal(true) }),
  build_fill_tx: z.strictObject({ quoteId: z.string().min(1).max(100) }),
  get_my_fills: z.strictObject({ limit: z.number().int().min(1).max(100).default(20) }),
  explain_decision: z.strictObject({ decisionId: z.string().min(1).max(100).optional() }),
  get_arena: z.strictObject({}),
  get_stats: z.strictObject({
    pair: schemas.pair,
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
  }),
};
export type ToolName = keyof typeof inputs;
export type EngineClient = Pick<
  Zethos,
  | "status"
  | "quote"
  | "verifyQuote"
  | "paperFill"
  | "buildFill"
  | "fills"
  | "stats"
  | "arena"
  | "arenaTakers"
  | "decisions"
>;

export class TradingService {
  private readonly inFlight = new Map<string, Promise<StoredResult>>();
  constructor(
    readonly sdk: EngineClient,
    readonly config: Config,
    readonly ledger: Ledger,
    private readonly now: () => number = Date.now,
  ) {}

  async call(name: ToolName, input: unknown): Promise<StoredResult> {
    try {
      const parsed = inputs[name].safeParse(input);
      if (!parsed.success)
        throw new ToolError(
          "invalid_request",
          parsed.error.issues[0]?.message ?? "Invalid tool arguments",
        );
      const args = parsed.data;
      switch (name) {
        case "get_market":
        case "get_market_status":
          return { data: await this.market(inputs.get_market.parse(args).pair) };
        case "get_quote":
          return { data: await this.quote(inputs.get_quote.parse(args)) };
        case "verify_quote": {
          const { quoteId } = inputs.verify_quote.parse(args);
          const entry = this.ledger.quote(quoteId);
          return {
            data: {
              quoteId,
              ...(await this.sdk.verifyQuote(entry.quote, entry.request)),
              paper: entry.quote.route === "paper",
            },
          };
        }
        case "execute_swap":
        case "build_fill_tx": {
          const { quoteId } = inputs.verify_quote.parse({
            quoteId: "quoteId" in args ? args.quoteId : "",
          });
          return await this.execute(quoteId, name === "build_fill_tx");
        }
        case "get_my_fills": {
          const { limit } = inputs.get_my_fills.parse(args);
          const fills = await this.sdk.fills({ taker: this.config.taker, limit });
          return {
            data: {
              taker: this.config.taker,
              fills: fills.map((fill) => ({
                ...fill,
                markout5sBps: fill.markouts?.["5"] ?? null,
              })),
            },
          };
        }
        case "explain_decision": {
          const { decisionId } = inputs.explain_decision.parse(args);
          const decisions = await this.sdk.decisions({ limit: 1000 });
          const important = new Set([
            "pause",
            "pair_halt",
            "taker_tier_change",
            "spread_widen",
            "spread_narrow",
          ]);
          const latest = [...decisions].sort((a, b) => b.ts - a.ts);
          const decision = decisionId
            ? latest.find((d) => d.id === decisionId)
            : (latest.find((d) => important.has(d.type)) ?? latest[0]);
          if (!decision)
            throw new ToolError("decision_not_found", "No matching decision is available.");
          return {
            data: { decision, source: "engine decision journal; narration is explanatory only" },
          };
        }
        case "get_arena": {
          const [arena, takers] = await Promise.all([
            this.sdk.arena(),
            this.sdk.arenaTakers({ limit: 10000 }),
          ]);
          const { series: _series, ...summary } = arena;
          return {
            data: {
              paper: true,
              ...summary,
              tierCounts: Object.fromEntries(
                schemas.tier.options.map((tier) => [
                  tier,
                  takers.filter((t) => t.tier === tier).length,
                ]),
              ),
              methodology: "zethos://methodology",
              arenaUrl: `${this.config.webUrl}/arena`,
            },
          };
        }
        case "get_stats": {
          const query = inputs.get_stats.parse(args);
          if (query.from !== undefined && query.to !== undefined && query.from > query.to)
            throw new ToolError(
              "invalid_request",
              "from must be at or before to (Unix milliseconds).",
            );
          const [status, stats] = await Promise.all([
            this.sdk.status(),
            this.sdk.stats({
              pair: query.pair,
              ...(query.from !== undefined ? { from: query.from } : {}),
              ...(query.to !== undefined ? { to: query.to } : {}),
            }),
          ]);
          return { data: { mode: status.mode, paper: status.mode === "shadow", ...stats } };
        }
      }
    } catch (error) {
      return { data: failure(error), isError: true };
    }
  }

  private async market(pair?: z.infer<typeof schemas.pair>): Promise<Record<string, unknown>> {
    const status = await this.sdk.status();
    const markets = status.pairs.filter((p) => pair === undefined || p.pair === pair);
    if (!markets.length) throw new ToolError("invalid_request", "This pair is not enabled.");
    const pairs = await Promise.all(
      markets.map(async (p) => ({ ...p, venues: (await this.sdk.stats({ pair: p.pair })).venues })),
    );
    return {
      mode: status.mode,
      paper: status.mode === "shadow",
      dataSource: status.dataSource ?? "live",
      chainId: status.chainId,
      paused: status.paused,
      riskState: status.riskState,
      pairs,
      taker: this.config.taker,
      maxNotionalUsd: this.config.maxNotionalUsd,
      dailyNotionalUsd: this.config.dailyNotionalUsd,
    };
  }

  private async quote(input: z.infer<typeof inputs.get_quote>): Promise<Record<string, unknown>> {
    const status = await this.sdk.status();
    const market = status.pairs.find((p) => p.pair === input.pair);
    if (!market) throw new ToolError("invalid_request", "This pair is not enabled.");
    const request = resolveQuoteIntent({ ...input, taker: this.config.taker }, status);
    const initial = notional(request, input.side, market, this.now());
    perSwap(initial, this.config.maxNotionalUsd);
    const quote = await this.sdk.quote(request);
    if (quote.route === "hskswap")
      throw new ToolError(
        "pool_route",
        `No firm vault quote: ${quote.reason}. Pool execution is unavailable through MCP.`,
      );
    const verification = await this.sdk.verifyQuote(quote, request);
    if (!verification.ok)
      throw new ToolError(
        "unverified_quote",
        `Local verification failed: ${verification.reasons.join(", ")}`,
      );
    if ((status.mode === "shadow") !== (quote.route === "paper"))
      throw new ToolError(
        "wrong_mode",
        "The quote route does not match the configured engine mode.",
      );
    const outputUsd =
      input.side === "sell"
        ? (BigInt(quote.quote.amountOut) * 1000000n + 10n ** BigInt(market.quote.decimals) - 1n) /
          10n ** BigInt(market.quote.decimals)
        : initial;
    let value = initial;
    if (outputUsd > value) value = outputUsd;
    perSwap(value, this.config.maxNotionalUsd);
    const quoteId = `mq_${crypto.randomUUID()}`;
    this.ledger.save(quoteId, makeEntry(quote, request, market, input.side, value));
    const [sold, bought] =
      input.side === "buy" ? [market.quote, market.base] : [market.base, market.quote];
    const paid = formatUnits(BigInt(request.amountIn), sold.decimals);
    const received = formatUnits(BigInt(quote.quote.amountOut), bought.decimals);
    const price =
      input.side === "buy" ? Number(paid) / Number(received) : Number(received) / Number(paid);
    return {
      quoteId,
      paper: quote.route === "paper",
      pair: input.pair,
      side: input.side,
      youPay: { amount: paid, symbol: sold.symbol },
      youReceive: { amount: received, symbol: bought.symbol },
      price,
      costVsMidBps:
        (input.side === "buy" ? price / quote.breakdown.mid - 1 : 1 - price / quote.breakdown.mid) *
        10000,
      onChainComparison:
        quote.route === "paper" && quote.poolOut === null
          ? "no on-chain venue"
          : { savingPct: quote.route === "paper" ? quote.savingVsPoolPct : quote.savingPct },
      expiry: quote.quote.expiry,
      expiresInSeconds: Math.max(0, Number(quote.quote.expiry) - Math.floor(this.now() / 1000)),
      notionalUsd: formatUnits(value, 6),
      breakdown: quote.breakdown,
      verification,
      next: "Show the amounts and expiry to the user. Call verify_quote; get explicit permission before execute_swap. A quote never fills automatically.",
    };
  }

  private execute(id: string, liveOnly: boolean): Promise<StoredResult> {
    const existing = this.inFlight.get(id);
    if (existing)
      return liveOnly
        ? existing.then((r) =>
            r.data.paper === true
              ? {
                  data: { error: "wrong_mode", message: "build_fill_tx is live-only." },
                  isError: true,
                }
              : r,
          )
        : existing;
    const task = this.submit(id, liveOnly).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, task);
    return task;
  }

  private async submit(id: string, liveOnly: boolean): Promise<StoredResult> {
    const entry = this.ledger.quote(id);
    if (liveOnly && entry.quote.route === "paper")
      throw new ToolError(
        "wrong_mode",
        "build_fill_tx is live-only. This engine uses paper settlement.",
      );
    const receipt = this.ledger.receipt(id);
    if (receipt) return receipt;
    const status = await this.sdk.status();
    if ((status.mode === "shadow") !== (entry.quote.route === "paper"))
      throw new ToolError("wrong_mode", "Engine mode changed. Request a fresh quote.");
    const check = await this.sdk.verifyQuote(entry.quote, entry.request);
    if (!check.ok)
      throw new ToolError(
        check.reasons.includes("expired") ? "quote_expired" : "unverified_quote",
        `Quote verification failed: ${check.reasons.join(", ")}. Request a fresh quote.`,
      );
    const market = status.pairs.find((p) => p.pair === entry.market.pair);
    if (!market) throw new ToolError("invalid_request", "This pair is no longer enabled.");
    for (const leg of ["base", "quote"] as const)
      if (
        market[leg].address.toLowerCase() !== entry.market[leg].address.toLowerCase() ||
        market[leg].decimals !== entry.market[leg].decimals
      )
        throw new ToolError("invalid_request", "Token metadata changed. Request a fresh quote.");
    const current = notional(entry.request, entry.side, market, this.now());
    const value = current > BigInt(entry.notional) ? current : BigInt(entry.notional);
    perSwap(value, this.config.maxNotionalUsd);
    // Reserve before the first settlement await; SQLite also serializes other processes.
    const existing = this.ledger.reserve(
      id,
      new Date(this.now()).toISOString().slice(0, 10),
      value,
      usdUnits(this.config.dailyNotionalUsd),
    );
    if (existing) return existing;
    try {
      let result: StoredResult;
      if (entry.quote.route === "paper") {
        const fill = await this.sdk.paperFill(entry.quote, entry.request);
        result = {
          data: {
            quoteId: id,
            paper: true,
            fill,
            arenaUrl: `${this.config.webUrl}/arena`,
            message: "Paper fill settled. No wallet transaction was sent.",
          },
        };
      } else {
        const calls = await this.sdk.buildFill(
          entry.quote,
          { account: this.config.taker },
          entry.request,
        );
        result = {
          data: {
            quoteId: id,
            paper: false,
            submitted: false,
            chainId: this.config.chainId,
            transactions: [
              ...(calls.approve ? [unsigned(calls.approve)] : []),
              unsigned(calls.fill),
            ],
            appUrl: `${this.config.webUrl}/app`,
            message:
              "Unsigned transactions only. The user's wallet must review and sign. The notional budget is reserved; no on-chain fill is claimed.",
          },
        };
      }
      this.ledger.finish(id, result);
      return result;
    } catch (error) {
      const definite =
        error instanceof ZethosError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.code !== "nonce_used";
      const result: StoredResult = {
        isError: true,
        data: {
          ...failure(error),
          quoteId: id,
          execution: definite ? "rejected" : "unknown",
          retryable: false,
          ...(!definite
            ? {
                message:
                  "The submission outcome is unknown. Check get_my_fills before any new trade. This quote will never be submitted again; its budget stays reserved.",
              }
            : {}),
        },
      };
      this.ledger.finish(id, result, !definite);
      return result;
    }
  }
}

function unsigned(call: FillCalls["fill"] | NonNullable<FillCalls["approve"]>) {
  const data = call.functionName === "fill" ? encodeFunctionData(call) : encodeFunctionData(call);
  return { to: call.address, data, value: "0", account: call.account };
}
