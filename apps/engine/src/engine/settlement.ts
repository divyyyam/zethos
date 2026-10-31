import { getAddress, type Hex } from "viem";
import type { Fill, Flow } from "../db";
import { fillRequestSchema, sameQuote, verifyQuote } from "../quotes";
import { units } from "../tokens";
import { MAX_TTL_SEC } from "./constants";
import { EngineError } from "./errors";
import { flowOf, nonceKey } from "./helpers";
import { getMarket, pairTokens, refresh, requireInventory } from "./market";
import type { EngineState } from "./state";
import { observeOutcome } from "./tape";
import { accountFill } from "./toxicity";
import { parse } from "./validation";

// Paper vault settlement, with validation and persistence in their original order.
export function paperFill(
  context: EngineState,
  input: unknown,
  client: string | undefined,
  now: number,
): Promise<Fill> {
  return context.exclusive(() => fillQuote(context, input, client, now));
}

export async function fillQuote(
  context: EngineState,
  input: unknown,
  client: string | undefined,
  now: number,
  internalFlow?: Flow,
): Promise<Fill> {
  const { quote, signature } = parse(fillRequestSchema, input);
  const valid = await verifyQuote(
    context.signerAddress,
    context.deps.chainId,
    quote,
    signature as Hex,
  );
  if (!valid) throw new EngineError("quote_invalid", 400, "Signature does not match the quote");

  const nowSec = BigInt(Math.floor(now / 1000));
  if (nowSec > BigInt(quote.expiry)) throw new EngineError("quote_expired", 409);
  if (
    BigInt(quote.expiry) < BigInt(quote.issuedAt) ||
    BigInt(quote.issuedAt) > nowSec ||
    BigInt(quote.expiry) - BigInt(quote.issuedAt) > MAX_TTL_SEC
  ) {
    throw new EngineError("quote_invalid", 400, "Quote lifetime is too long");
  }
  const key = nonceKey(quote);
  if (context.usedNonces.has(key) || (await context.deps.store.nonceUsed(quote.taker, quote.nonce)))
    throw new EngineError("nonce_used", 409);
  const issued = context.issued.get(key);
  if (!issued || !sameQuote(issued.quote, quote)) {
    throw new EngineError("quote_invalid", 400, "Quote was not issued by this engine");
  }
  if (context.paused) throw new EngineError("paused", 503);
  // Feed freshness, inventory skew and new taker restrictions cannot revoke a firm
  // quote. Only the same explicit pause/halt gates as the vault apply at settlement.
  if (context.state.halts[issued.pair]) throw new EngineError("pair_halted", 503);

  const inventory = requireInventory(context);
  const { base, quote: quoteToken } = pairTokens(context, issued.pair);
  const [tokenIn, tokenOut] = issued.side === "buy" ? [quoteToken, base] : [base, quoteToken];
  const amountIn = BigInt(quote.amountIn);
  const amountOutValue = BigInt(quote.amountOut);
  if (amountOutValue > inventory[tokenOut.symbol]) throw new EngineError("vault_capacity", 422);

  // Reserve synchronously before any await, so concurrent fills cannot double-spend.
  const nextInventory = { ...inventory };
  nextInventory[tokenOut.symbol] -= amountOutValue;
  nextInventory[tokenIn.symbol] += amountIn;

  const [baseAmount, quoteAmount] =
    issued.side === "buy" ? [amountOutValue, amountIn] : [amountIn, amountOutValue];
  refresh(context, issued.pair, now);
  const fill: Fill = {
    id: `f_${crypto.randomUUID()}`,
    quoteId: issued.id,
    policyId: issued.policyId,
    ts: now,
    taker: getAddress(quote.taker),
    pair: issued.pair,
    side: issued.side,
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    price: units(quoteAmount, quoteToken.decimals) / units(baseAmount, base.decimals),
    midAtFill: getMarket(context, issued.pair).fused.mid,
    flow: internalFlow ?? flowOf(client),
    paper: true,
    txHash: null,
    gasUsd: context.modeledGasUsd,
    epoch: context.arena?.epoch ?? 0,
  };

  await context.deps.store.saveFill(fill, quote.nonce, context.arena?.epoch ?? 0, nextInventory);
  context.inventory = nextInventory;
  context.usedNonces.add(key);
  issued.record.status = "filled";
  context.ledger.push(fill);
  accountFill(context, fill);
  observeOutcome(context, issued, true, fill.midAtFill);
  context.deps.emit?.({ type: "fill", fill });
  return fill;
}
