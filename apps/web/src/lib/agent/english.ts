import type { ChatMessage, Zethos } from "@zethos/sdk";
import type { Address } from "viem";
import { parseIntent, type SwapIntent } from "./intent";

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Validate model output before it can become a reviewable plan. No signed data or
 * permissions are accepted from a language model. */
export function preparedIntent(value: unknown): SwapIntent | null {
  if (
    !object(value) ||
    value.kind !== "swap" ||
    !["HSK/USDT", "ETH/USDT"].includes(String(value.pair)) ||
    !["buy", "sell"].includes(String(value.side)) ||
    !["base", "quote"].includes(String(value.amountIn)) ||
    typeof value.dryRun !== "boolean" ||
    typeof value.amount !== "string" ||
    !/^\d+(\.\d+)?$/.test(value.amount) ||
    !positive(Number(value.amount))
  )
    return null;
  if (
    value.maxCostBps !== null &&
    !(
      typeof value.maxCostBps === "number" &&
      Number.isFinite(value.maxCostBps) &&
      value.maxCostBps >= 0 &&
      value.maxCostBps <= 10000
    )
  )
    return null;
  if (value.expiresInMs !== null && !(positive(value.expiresInMs) && value.expiresInMs <= 86400000))
    return null;
  let slices: SwapIntent["slices"] = null;
  if (value.slices !== null) {
    if (
      !object(value.slices) ||
      !positive(value.slices.count) ||
      !Number.isInteger(value.slices.count) ||
      value.slices.count < 2 ||
      value.slices.count > 20 ||
      !positive(value.slices.durationMs) ||
      value.slices.durationMs > 3600000
    )
      return null;
    slices = { count: value.slices.count, durationMs: value.slices.durationMs };
  }
  let trigger: SwapIntent["trigger"] = null;
  if (value.trigger !== null) {
    if (!object(value.trigger)) return null;
    if (
      (value.trigger.type === "above" || value.trigger.type === "below") &&
      positive(value.trigger.price)
    )
      trigger = { type: value.trigger.type, price: value.trigger.price };
    else if (
      (value.trigger.type === "rise" || value.trigger.type === "drop") &&
      positive(value.trigger.pct) &&
      value.trigger.pct <= 100
    )
      trigger = { type: value.trigger.type, pct: value.trigger.pct };
    else return null;
  }
  return {
    kind: "swap",
    pair: value.pair as SwapIntent["pair"],
    side: value.side as SwapIntent["side"],
    amount: value.amount,
    amountIn: value.amountIn as SwapIntent["amountIn"],
    dryRun: value.dryRun,
    maxCostBps: value.maxCostBps as number | null,
    expiresInMs: value.expiresInMs as number | null,
    slices,
    trigger,
  };
}

// Common price questions work without an LLM. Entire-sentence patterns preserve the
// existing strict parser's refusal of unparsed conditions or multiple trades.
export function englishQuote(text: string): SwapIntent | null {
  const sentence = text
    .trim()
    .replace(/[?.!]+$/g, "")
    .replace(/^(?:hey[, ]+|please\s+|could you\s+|can you\s+)/i, "")
    .replace(/\s+please$/i, "");
  const n = "(\\d[\\d,]*(?:\\.\\d+)?)";
  const asset = "(hsk|whsk|eth|weth)";
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [
      new RegExp(
        `^how much ${asset} (?:can|would|will|do) i (?:get|receive|buy) (?:for|with) \\$?${n}(?: (?:usdt|usd|dollars?|bucks))?$`,
        "i",
      ),
      (m) => `Buy ${m[2]} USDT of ${m[1]} dry run`,
    ],
    [
      new RegExp(
        `^what (?:would|will|do) i get (?:if i (?:spent|spend)|for|with) \\$?${n}(?: (?:usdt|usd|dollars?|bucks))? (?:on|in|of) ${asset}$`,
        "i",
      ),
      (m) => `Buy ${m[1]} USDT of ${m[2]} dry run`,
    ],
    [
      new RegExp(
        `^(?:give me|show me|i need|i want) (?:a |the )?(?:quote|price|estimate) (?:for |on )?(?:selling |to sell )${n} ${asset}$`,
        "i",
      ),
      (m) => `Sell ${m[1]} ${m[2]} dry run`,
    ],
    [
      new RegExp(
        `^(?:quote me|give me a quote for|how much usdt (?:would|will|do) i get for) ${n} ${asset}$`,
        "i",
      ),
      (m) => `Sell ${m[1]} ${m[2]} dry run`,
    ],
    [
      new RegExp(
        `^(?:quote me|give me a quote for) \\$?${n}(?: (?:usdt|usd|dollars?|bucks))? (?:of|into|to|in) ${asset}$`,
        "i",
      ),
      (m) => `Buy ${m[1]} USDT of ${m[2]} dry run`,
    ],
  ];
  for (const [rule, canonical] of rules) {
    const match = sentence.match(rule);
    if (!match) continue;
    const intent = parseIntent(canonical(match)).intent;
    return intent.kind === "swap" ? intent : null;
  }
  return null;
}

export async function interpretEnglish(
  text: string,
  address: Address,
  sdk: Pick<Zethos, "chat">,
  history: ChatMessage[] = [],
): Promise<SwapIntent> {
  const local = englishQuote(text);
  if (local) return local;
  const response = await sdk.chat({ message: text, address, history: history.slice(-10) });
  const cards = response.cards.filter((card) => card.type === "quote");
  if (cards.length !== 1)
    throw new Error(
      response.reply || "Please describe one supported swap, including the asset and amount.",
    );
  const intent = preparedIntent(cards[0]?.data.intent);
  if (!intent)
    throw new Error(
      "I couldn’t preserve all the details of that request. Please clarify the asset, amount and limits.",
    );
  return intent;
}
