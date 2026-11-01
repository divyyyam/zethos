import { z } from "zod";
import type { Pair, Params, Side, TierName } from "../config";
import { EngineError } from "../engine/errors";
import { baseShare } from "../engine/valuation";
import { vwap, vwapForQuote } from "../feeds/fuse";
import type { Book } from "../feeds/types";
import { amountOut } from "../pricing";
import { type Inventory, PAIR_TOKENS, type Tokens, units } from "../tokens";
import type { Mandate } from "./mandate";
import type { PolicyQuote } from "./types";

const finite = z.number().finite();
const policyQuoteSchema = z.strictObject({
  kind: z.literal("quote"),
  price: finite.positive(),
  ref: finite.positive(),
  halfSpread: finite.min(0).lt(1),
  sigmaT: finite.nonnegative(),
  ttlSec: z.number().int().positive().max(120),
  terms: z.record(z.string(), finite),
  feeBps: finite.nonnegative().optional(),
});

export class MandateBreach extends EngineError {
  constructor(
    readonly rule: string,
    readonly actual: number | string,
    readonly limit: number | string,
    readonly pair: Pair,
  ) {
    super("mandate_breach", 422, `Desk mandate ${rule}: ${actual} (limit ${limit})`);
  }
}

/** The evaluator and live quote path share this deterministic authority boundary. */
export interface ExecutionInput {
  pair: Pair;
  side: Side;
  amountIn: string;
  tier: TierName;
  params: Params;
  mandate: Mandate;
  tokens: Tokens;
  inventory: Inventory;
  mids: Partial<Record<Pair, number | null>>;
  book: Book;
  sourceMids: number[];
  outstanding?: { pair: Pair; side: Side; amountIn: string; amountOut: string }[];
  /**
   * Live vault quotes only. A person has to confirm in a wallet, the vault's own small inventory
   * sets capacity, and its balances needn't sit inside the paper desk's band.
   */
  live?: { minNotionalUsd: number; maxTtlSec: number };
}

export function enforceExecution(
  input: ExecutionInput,
  decision: unknown,
): { quote: PolicyQuote; amountOut: string; inventory: Inventory } {
  const { pair, side, params, mandate, tokens, inventory } = input;
  const parsed = policyQuoteSchema.safeParse(decision);
  if (!parsed.success) throw new EngineError("policy_invalid", 422, "Invalid policy quote");
  const quote = parsed.data;
  const invalid = (message: string): never => {
    throw new EngineError("policy_invalid", 422, message);
  };
  if (input.tier === "blocked") throw new EngineError("taker_restricted", 403);
  const tier = params.toxicity.tiers[input.tier];
  const maxTtl =
    input.live?.maxTtlSec ??
    Math.min(120, params.quote.maxTtlSec, params.quote.ttlSec, tier.ttlSec);
  if (quote.ttlSec > maxTtl || (!input.live && quote.ttlSec < params.quote.minTtlSec))
    invalid("Policy TTL exceeds execution limits");
  if (quote.halfSpread < params.spread.min || quote.halfSpread > params.spread.max)
    invalid("Policy spread exceeds execution limits");
  const expectedPrice =
    side === "buy" ? quote.ref * (1 + quote.halfSpread) : quote.ref * (1 - quote.halfSpread);
  if (quote.price !== expectedPrice) invalid("Policy price and half spread disagree");
  if (!mandate.pairs.includes(pair))
    throw new MandateBreach("pair", pair, mandate.pairs.join(","), pair);
  const { base: baseSymbol, quote: quoteSymbol } = PAIR_TOKENS[pair];
  const base = tokens[baseSymbol];
  const quoteToken = tokens[quoteSymbol];
  const mid = input.mids[pair];
  if (!mid || !Number.isFinite(mid)) throw new EngineError("pair_halted", 503);
  const rawIn = BigInt(input.amountIn);
  const notional =
    side === "buy" ? units(rawIn, quoteToken.decimals) : units(rawIn, base.decimals) * mid;
  if (!Number.isFinite(notional) || notional <= 0) throw new EngineError("invalid_request", 400);
  const minNotional = input.live?.minNotionalUsd ?? params.quote.minNotionalUsd;
  if (notional < minNotional) throw new EngineError("invalid_request", 400);
  if (notional > params.quote.maxNotionalUsd[pair] * tier.sizeCap)
    throw new EngineError("vault_capacity", 422, "Amount is above the per-swap limit");
  if (!input.live && notional < mandate.service.minQuoteNotionalUsd)
    throw new MandateBreach(
      "minimum_notional",
      notional,
      mandate.service.minQuoteNotionalUsd,
      pair,
    );
  const bucket = mandate.service.maxHalfSpreadBps.find(
    (bucket) => notional <= bucket.maxNotionalUsd,
  );
  if (!bucket)
    throw new MandateBreach(
      "size_bucket",
      notional,
      mandate.service.maxHalfSpreadBps.at(-1)?.maxNotionalUsd ?? 0,
      pair,
    );
  // Measure the actual price against the fused mid, including reference-book impact.
  const actualSpreadBps = (side === "buy" ? quote.price / mid - 1 : 1 - quote.price / mid) * 10000;
  if (actualSpreadBps > bucket.maxBps)
    throw new MandateBreach("maximum_half_spread", actualSpreadBps, bucket.maxBps, pair);
  const walked =
    side === "buy"
      ? vwapForQuote(input.book.asks, notional)
      : vwap(input.book.bids, units(rawIn, base.decimals));
  if (walked === null) throw new EngineError("insufficient_reference_depth", 422);
  // Reference choices may blend fresh venues and the size walk, never invent a price.
  const references = [
    mid,
    walked,
    ...input.sourceMids.filter((price) => Number.isFinite(price) && price > 0),
  ];
  const low = Math.min(...references);
  const high = Math.max(...references);
  const tolerance = mid * Number.EPSILON * 8;
  if (quote.ref < low - tolerance || quote.ref > high + tolerance)
    invalid("Policy reference is outside observed market prices");

  const rawOut = amountOut(side, rawIn, quote.price, base.decimals, quoteToken.decimals);
  const [tokenIn, tokenOut] = side === "buy" ? [quoteToken, base] : [base, quoteToken];
  if (rawOut <= 0n) throw new EngineError("invalid_request", 400, "Amount is too small");
  if (rawOut > inventory[tokenOut.symbol]) throw new EngineError("vault_capacity", 422);
  const projected = { ...inventory };
  projected[tokenIn.symbol] += rawIn;
  projected[tokenOut.symbol] -= rawOut;
  const lower = { ...projected };
  const upper = { ...projected };
  for (const firm of input.outstanding ?? []) {
    const symbols = PAIR_TOKENS[firm.pair];
    const exposed = firm.side === "buy" ? lower : upper;
    const [incoming, outgoing] =
      firm.side === "buy" ? [symbols.quote, symbols.base] : [symbols.base, symbols.quote];
    exposed[incoming] += BigInt(firm.amountIn);
    exposed[outgoing] -= BigInt(firm.amountOut);
  }
  if (Object.values(lower).some((raw) => raw < 0n) || Object.values(upper).some((raw) => raw < 0n))
    throw new EngineError(
      "vault_capacity",
      422,
      "Inventory is committed to outstanding firm quotes",
    );
  // USDT is shared, so a fill also changes the inventory share of the other pair.
  // Buys monotonically lower shares; sells raise them. These two extreme subsets cover
  // every possible combination of outstanding executions without netting away liabilities.
  for (const affected of input.live ? [] : params.pairs) {
    const affectedMid = input.mids[affected];
    if (!affectedMid || !Number.isFinite(affectedMid))
      throw new EngineError("pair_halted", 503, "Fresh prices are required for inventory limits");
    const symbols = PAIR_TOKENS[affected];
    const shareAt = (balances: Inventory) =>
      baseShare(
        affectedMid,
        balances,
        { base: tokens[symbols.base], quote: tokens[symbols.quote] },
        params.pairs.length,
      );
    const minShare = shareAt(lower);
    const maxShare = shareAt(upper);
    if (minShare < mandate.inventory.minShare)
      throw new MandateBreach("inventory_min", minShare, mandate.inventory.minShare, affected);
    if (maxShare > mandate.inventory.maxShare)
      throw new MandateBreach("inventory_max", maxShare, mandate.inventory.maxShare, affected);
  }
  const { feeBps, ...fields } = quote;
  return {
    quote: { ...fields, ...(feeBps === undefined ? {} : { feeBps }) },
    amountOut: rawOut.toString(),
    inventory: projected,
  };
}

/** Net operating loss includes residual inventory moves and modelled settlement gas. */
export function operatingLossUsd(initialEquity: number, equity: number, gasUsd: number): number {
  return Math.max(0, initialEquity - equity + gasUsd);
}
