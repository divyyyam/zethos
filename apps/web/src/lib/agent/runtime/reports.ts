// Read-only reports and flattening proposals, using the same authorization gate.
import { type QuoteRequest, type QuoteResponse, ZethosError } from "@zethos/sdk";
import { type Address, formatUnits, parseUnits } from "viem";
import { failureMessage } from "../../engine/sdk";
import type { Intent, SwapIntent } from "../intent";
import { LADDER_USD } from "./constants";
import { decimalString, formatToken } from "./helpers";
import { addDraft, addReport, emit, patchMission } from "./missions";
import { compilePlan } from "./planning";
import { pairStatus } from "./sense";
import type { RuntimeState } from "./state";
import type { AgentSdk, Pair, Report } from "./types";

export async function runRead(
  context: RuntimeState,
  id: string,
  intent: Exclude<Intent, SwapIntent | { kind: "unknown" | "stop" | "help" }>,
  taker: Address,
): Promise<void> {
  if (!context.sdk) return;
  try {
    if (intent.kind === "flatten") {
      await flatten(context, id, intent.pair, taker);
      return;
    }
    const report = await readReport(context, intent, taker);
    patchMission(context, id, () => ({ status: "done", report }));
  } catch (error) {
    patchMission(context, id, () => ({ status: "failed", error: failureMessage(error) }));
  }
}

export async function readReport(
  context: RuntimeState,
  intent: Exclude<Intent, SwapIntent | { kind: "unknown" | "stop" | "help" | "flatten" }>,
  taker: Address,
): Promise<Report> {
  const sdk = context.sdk as AgentSdk;
  if (intent.kind === "market") {
    const status = await sdk.status();
    return {
      type: "market",
      mode: status.mode,
      pairs: status.pairs.filter((row) => !intent.pair || row.pair === intent.pair),
      equityUsd: status.equityUsd,
      riskState: status.riskState,
    };
  }
  if (intent.kind === "position") return readPosition(context, taker);
  const status = await sdk.status();
  const pair = status.pairs.find((row) => row.pair === intent.pair);
  if (!pair) throw new ZethosError("invalid_request", `${intent.pair} isn’t enabled.`);
  const request = (usd: number): QuoteRequest => ({
    taker,
    tokenIn: pair.quote.address,
    tokenOut: pair.base.address,
    amountIn: parseUnits(String(usd), pair.quote.decimals).toString(),
  });
  const route = pair.vaultRoutes?.buy;
  const cap = route ? Number(formatUnits(BigInt(route.maxAmountIn), pair.quote.decimals)) : null;
  const inventory = status.inventory[pair.base.symbol];
  const capacity = route
    ? `The vault buy route is ${route.enabled ? "enabled" : "switched off"}, capped at ${formatToken(cap ?? 0)} ${pair.quote.label ?? pair.quote.symbol} per fill.${inventory === undefined ? "" : ` Available inventory: ${formatUnits(BigInt(inventory), pair.base.decimals)} ${pair.base.label ?? pair.base.symbol}.`} Taker and mandate limits can reduce the available size; signed quotes include those checks.`
    : "This is paper settlement; no on-chain route cap is configured. Inventory and mandate checks still apply.";
  if (intent.kind === "explain") {
    const usd = cap !== null && cap > 0 ? Math.min(500, cap) : 500;
    let quote: QuoteResponse;
    try {
      quote = await sdk.quote(request(usd));
    } catch (error) {
      return {
        type: "notice",
        title: "Current capacity",
        detail: `${capacity} Engine refusal: ${failureMessage(error)}`,
      };
    }
    if (quote.route !== "paper" && quote.route !== "conduit")
      throw new ZethosError("wrong_mode", "No signed quote available");
    return {
      type: "explain",
      capacity,
      pair: pair.pair,
      usd,
      vsMidBps: quote.vsMidBps,
      ttlSec: quote.breakdown.ttlSec,
      breakdown: quote.breakdown,
    };
  }
  const rungs: Extract<Report, { type: "ladder" }>["rungs"] = [];
  for (const usd of LADDER_USD) {
    try {
      const quote = await sdk.quote(request(usd));
      rungs.push(
        quote.route === "paper" || quote.route === "conduit"
          ? { usd, costBps: quote.vsMidBps, ttlSec: quote.breakdown.ttlSec, note: null }
          : { usd, costBps: null, ttlSec: null, note: "No signed route" },
      );
    } catch (error) {
      rungs.push({ usd, costBps: null, ttlSec: null, note: failureMessage(error) });
    }
  }
  return { type: "ladder", pair: pair.pair, capacity, rungs };
}

export async function readPosition(context: RuntimeState, taker: Address): Promise<Report> {
  const sdk = context.sdk as AgentSdk;
  const [status, fills] = await Promise.all([sdk.status(), sdk.fills({ taker, limit: 100 })]);
  const rows = status.pairs.flatMap((pair) =>
    (["paper", "onchain"] as const)
      .filter(
        (settlement) =>
          settlement === (status.mode === "live" ? "onchain" : "paper") ||
          fills.some((fill) => fill.pair === pair.pair && fill.paper === (settlement === "paper")),
      )
      .map((settlement) => {
        const mine = fills.filter(
          (fill) => fill.pair === pair.pair && fill.paper === (settlement === "paper"),
        );
        let net = 0;
        let quoteFlow = 0;
        for (const fill of mine) {
          const [baseRaw, quoteRaw] =
            fill.side === "buy" ? [fill.amountOut, fill.amountIn] : [fill.amountIn, fill.amountOut];
          const sign = fill.side === "buy" ? 1 : -1;
          net += sign * Number(formatUnits(BigInt(baseRaw), pair.base.decimals));
          quoteFlow -= sign * Number(formatUnits(BigInt(quoteRaw), pair.quote.decimals));
        }
        return {
          pair: pair.pair,
          settlement,
          baseSymbol: pair.base.label ?? pair.base.symbol,
          quoteSymbol: pair.quote.label ?? pair.quote.symbol,
          net,
          quoteFlow,
          mid: pair.mid,
          pnlUsd: pair.mid === null ? null : net * pair.mid + quoteFlow,
          fills: mine.length,
        };
      }),
  );
  return { type: "position", mode: status.mode, rows, truncated: fills.length >= 100 };
}

export async function flatten(
  context: RuntimeState,
  id: string,
  pair: Pair | null,
  taker: Address,
): Promise<void> {
  const report = await readPosition(context, taker);
  if (report.type !== "position") return;
  const open = report.rows.filter(
    (row) =>
      row.settlement === (report.mode === "live" ? "onchain" : "paper") &&
      (!pair || row.pair === pair) &&
      row.mid !== null &&
      Math.abs(row.net * row.mid) >= 5,
  );
  if (open.length === 0) {
    patchMission(context, id, () => ({
      status: "done",
      report: {
        type: "notice",
        title: "Nothing to flatten",
        detail: "This identity holds no position worth $5 or more.",
      },
    }));
    return;
  }
  context.missions = context.missions.filter((mission) => mission.id !== id);
  for (const row of open) {
    const intent: SwapIntent = {
      kind: "swap",
      pair: row.pair,
      side: row.net > 0 ? "sell" : "buy",
      amount: decimalString(Math.abs(row.net), 18),
      amountIn: "base",
      dryRun: false,
      slices: null,
      trigger: null,
      maxCostBps: null,
      expiresInMs: null,
    };
    const status = pairStatus(context, row.pair);
    const plan = status ? compilePlan(intent, status) : "Waiting for the first market read.";
    if (typeof plan === "string") {
      addReport(context, `Flatten ${row.pair}`, taker, {
        type: "notice",
        title: `Can’t flatten ${row.pair}`,
        detail: plan,
      });
    } else {
      addDraft(
        context,
        `Flatten ${row.baseSymbol}: ${row.net > 0 ? "sell" : "buy back"} ${formatToken(Math.abs(row.net))}`,
        taker,
        plan,
        false,
      );
    }
  }
  emit(context);
}
