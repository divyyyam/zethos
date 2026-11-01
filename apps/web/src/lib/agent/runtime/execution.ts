// Sense, price, verify, guard and settle one slice. The retry budget stays local to this loop.
import {
  type Fill,
  type QuoteRequest,
  type SignedQuoteResponse,
  type Status,
  ZethosError,
} from "@zethos/sdk";
import { formatUnits } from "viem";
import { failureMessage } from "../../engine/sdk";
import { HOLD_RETRY_MS } from "./constants";
import { formatPrice, formatToken } from "./helpers";
import { measure } from "./measure";
import { findMission, finish, logMission, patchMission, setSlice, setStage } from "./missions";
import type { RuntimeState } from "./state";
import type { AgentSdk, Mission, Plan, Stage } from "./types";

export async function runSlice(
  context: RuntimeState,
  id: string,
  plan: Plan,
  index: number,
  dryRun: boolean,
  signal: AbortSignal,
  measures: Promise<void>[],
): Promise<"filled" | "failed" | "aborted" | "previewed"> {
  const sdk = context.sdk as AgentSdk;
  const label =
    plan.sliceAmounts.length > 1 ? `Slice ${index + 1}/${plan.sliceAmounts.length}: ` : "";
  const fail = (stage: Stage, text: string): "failed" => {
    setStage(context, id, stage, "failed", text);
    setSlice(context, id, index, { state: "failed" });
    logMission(context, id, `${label}${text}`, "bad");
    finish(context, id, "failed", text);
    return "failed";
  };
  setSlice(context, id, index, { state: "active" });
  const request: QuoteRequest = {
    taker: (findMission(context, id) as Mission).taker,
    tokenIn: plan.tokenIn,
    tokenOut: plan.tokenOut,
    amountIn: plan.sliceAmounts[index] as string,
  };
  const holdUntil = context.now() + plan.holdMs;
  let expiredRetries = 1;

  while (true) {
    if (signal.aborted) return "aborted";

    setStage(context, id, "sense", "active");
    let status: Status;
    try {
      status = await sdk.status();
    } catch (error) {
      return fail("sense", failureMessage(error));
    }
    if (signal.aborted) return "aborted";
    if (status.mode !== "shadow" && !context.settleLive)
      return fail("sense", "This agent can’t settle on-chain. Use the swap page.");
    if (status.paused) return fail("sense", "The vault is paused.");
    const pair = status.pairs.find((row) => row.pair === plan.pair);
    if (!pair || pair.halted || pair.mid === null)
      return fail("sense", `${plan.pair} is halted: no healthy price source.`);
    const healthy = pair.sources.filter((source) => source.status === "ok").length;
    setStage(
      context,
      id,
      "sense",
      "done",
      `${healthy}/${pair.sources.length} venues · mid ${formatPrice(pair.mid)}`,
    );
    if (healthy < pair.sources.length)
      logMission(
        context,
        id,
        `${label}${pair.sources.length - healthy} price source(s) excluded from the mid.`,
        "warn",
      );

    setStage(context, id, "price", "active");
    let quote: SignedQuoteResponse;
    try {
      const response = await sdk.quote(request);
      if (response.route !== (status.mode === "shadow" ? "paper" : "conduit"))
        return fail("price", "The engine offered a route this agent can’t settle.");
      quote = response as SignedQuoteResponse;
    } catch (error) {
      return fail("price", failureMessage(error));
    }
    if (signal.aborted) return "aborted";
    const out = Number(
      formatUnits(
        BigInt(quote.route === "paper" ? quote.paperOut : quote.conduitOut),
        plan.boughtDecimals,
      ),
    );
    const price =
      plan.side === "buy"
        ? Number(formatUnits(BigInt(request.amountIn), plan.soldDecimals)) / out
        : out / Number(formatUnits(BigInt(request.amountIn), plan.soldDecimals));
    patchMission(context, id, () => ({
      quote: {
        vsMidBps: quote.vsMidBps,
        ttlSec: quote.breakdown.ttlSec,
        expiresAt: quote.expiresAt,
        out,
        breakdown: quote.breakdown,
        signature: quote.signature,
        nonce: quote.quote.nonce,
        id: quote.id,
      },
    }));
    setStage(
      context,
      id,
      "price",
      "done",
      `${formatPrice(price)} · ${quote.breakdown.ttlSec}s firm`,
    );
    logMission(
      context,
      id,
      `${label}Quote ${quote.id.slice(0, 14)} at ${formatPrice(price)}, ${quote.vsMidBps.toFixed(1)} bps from mid.`,
    );

    setStage(context, id, "verify", "active");
    const verification = await sdk.verifyQuote(quote, request).catch((error: unknown) => error);
    if (verification instanceof Error) return fail("verify", failureMessage(verification));
    const checked = verification as Awaited<ReturnType<AgentSdk["verifyQuote"]>>;
    if (signal.aborted) return "aborted";
    if (!checked.ok) {
      // A quote that aged out while we looked at it is safe to re-price. Anything else is not.
      if (checked.reasons.length === 1 && checked.reasons[0] === "expired" && expiredRetries > 0) {
        expiredRetries -= 1;
        logMission(context, id, `${label}Quote aged out before settling. Re-pricing once.`, "warn");
        continue;
      }
      return fail("verify", `Refused the quote: ${checked.reasons.join(", ")}.`);
    }
    setStage(context, id, "verify", "done", "Signature and terms match");
    logMission(
      context,
      id,
      `${label}Checked locally: signer, taker, pair, amount, expiry and price sanity.`,
      "good",
    );

    setStage(context, id, "guard", "active");
    if (quote.vsMidBps > plan.maxCostBps) {
      if (context.now() + HOLD_RETRY_MS > holdUntil) {
        return fail(
          "guard",
          `Cost stayed at ${quote.vsMidBps.toFixed(1)} bps, above your ${plan.maxCostBps} bps limit. Nothing was filled.`,
        );
      }
      patchMission(context, id, () => ({ status: "holding" }));
      setStage(
        context,
        id,
        "guard",
        "active",
        `${quote.vsMidBps.toFixed(1)} bps > ${plan.maxCostBps} bps`,
      );
      logMission(
        context,
        id,
        `${label}Holding: ${quote.vsMidBps.toFixed(1)} bps is above your ${plan.maxCostBps} bps limit.`,
        "warn",
      );
      await context.sleep(HOLD_RETRY_MS, signal);
      continue;
    }
    patchMission(context, id, () => ({ status: "running" }));
    setStage(
      context,
      id,
      "guard",
      "done",
      `${quote.vsMidBps.toFixed(1)} of ${plan.maxCostBps} bps`,
    );

    if (dryRun) {
      setSlice(context, id, index, { state: "skipped", vsMidBps: quote.vsMidBps, price });
      setStage(context, id, "settle", "skipped", "Dry run");
      setStage(context, id, "measure", "skipped");
      return "previewed";
    }

    // Past this point the stop button no longer applies: the fill either lands or it doesn't.
    setStage(context, id, "settle", "active");
    let fill: Fill;
    try {
      if (quote.route === "paper") fill = await sdk.paperFill(quote, request);
      else if (context.settleLive)
        fill = await context.settleLive(quote, { pair: plan.pair, side: plan.side, price });
      else return fail("settle", "This agent can’t settle on-chain.");
    } catch (error) {
      if (error instanceof ZethosError && error.code === "quote_expired" && expiredRetries > 0) {
        expiredRetries -= 1;
        logMission(
          context,
          id,
          `${label}Quote expired at the vault, so it did not fill. Re-pricing once.`,
          "warn",
        );
        continue;
      }
      // Never retried: a network failure here leaves the outcome unknown, not failed.
      const ambiguous =
        error instanceof ZethosError && (error.code === "network" || error.code === "timeout");
      return fail(
        "settle",
        ambiguous
          ? `${failureMessage(error)} The fill may or may not have settled. Check “my position” before retrying.`
          : failureMessage(error),
      );
    }
    const paid = Number(formatUnits(BigInt(fill.amountIn), plan.soldDecimals));
    const received = Number(formatUnits(BigInt(fill.amountOut), plan.boughtDecimals));
    setSlice(context, id, index, {
      state: "filled",
      fill,
      paid,
      received,
      price: fill.price,
      vsMidBps: quote.vsMidBps,
    });
    setStage(
      context,
      id,
      "settle",
      "done",
      fill.txHash ? `Settled on-chain, ${fill.txHash.slice(0, 10)}…` : "Paper fill settled",
    );
    logMission(
      context,
      id,
      `${label}Filled: ${formatToken(paid)} ${plan.soldSymbol} for ${formatToken(received)} ${plan.boughtSymbol} at ${formatPrice(fill.price)}.`,
      "good",
    );
    measures.push(measure(context, id, index, plan, fill));
    return "filled";
  }
}
