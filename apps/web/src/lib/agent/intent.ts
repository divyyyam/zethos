// Turns a plain sentence into a typed intent. Deterministic on purpose: every number the agent acts
// on was typed by the user, and anything this parser can't fully read is refused rather than guessed.
import type { Pair, Side } from "@zethos/sdk";

export type Trigger =
  | { type: "below" | "above"; price: number }
  | { type: "drop" | "rise"; pct: number };

export interface SwapIntent {
  kind: "swap";
  pair: Pair;
  side: Side;
  /** Decimal string, in `amountIn` terms: the base or the quote token of the pair. */
  amount: string;
  amountIn: "base" | "quote";
  dryRun: boolean;
  slices: { count: number; durationMs: number } | null;
  trigger: Trigger | null;
  /** Largest accepted cost versus the fused mid, as stated by the user. */
  maxCostBps: number | null;
  /** How long a trigger stays armed, or a price hold keeps retrying. */
  expiresInMs: number | null;
}

export type Intent =
  | SwapIntent
  | { kind: "market"; pair: Pair | null }
  | { kind: "explain"; pair: Pair }
  | { kind: "scan"; pair: Pair }
  | { kind: "position" }
  | { kind: "flatten"; pair: Pair | null }
  | { kind: "stop" }
  | { kind: "help" }
  | { kind: "unknown"; reason: string };

export type SpanRole = "verb" | "amount" | "asset" | "guard" | "schedule" | "trigger" | "dry";
export interface Span {
  start: number;
  end: number;
  role: SpanRole;
}
export interface Parsed {
  intent: Intent;
  spans: Span[];
}

export const MAX_SLICES = 20;
const MAX_DURATION_MS = 3_600_000;
const MAX_EXPIRY_MS = 86_400_000;
const SECONDS_PER_DEFAULT_SLICE = 15;

type Asset = "HSK" | "ETH" | "USDT";
const ASSETS: Record<string, Asset> = {
  hsk: "HSK",
  whsk: "HSK",
  eth: "ETH",
  weth: "ETH",
  usdt: "USDT",
  usd: "USDT",
  dollar: "USDT",
  dollars: "USDT",
  bucks: "USDT",
};
const ASSET_WORD = "whsk|hsk|weth|eth|usdt|usd";
const pairOf = (asset: Asset): Pair | null =>
  asset === "HSK" ? "HSK/USDT" : asset === "ETH" ? "ETH/USDT" : null;

const BUY_VERBS = new Set(
  "buy get grab acquire purchase accumulate need want wanna bag long".split(" "),
);
const SELL_VERBS = new Set("sell dump unload offload".split(" "));
const SWAP_VERBS = new Set("swap convert exchange trade turn change".split(" "));
const TO_WORDS = new Set(["to", "for", "into", "with", "using", "->", "→"]);
const OF_WORDS = new Set(["of", "worth"]);
const FILLERS = new Set(
  (
    "please pls kindly hey hi ok okay zethos agent can could would will you i we me my us just " +
    "about around roughly approximately approx some a an the at best price rate good fair market " +
    "quickly fast now immediately right away asap do it this that like go ahead"
  ).split(" "),
);

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };
function toMs(value: string, unit: string): number {
  return Number(value) * (UNITS[unit[0] ?? "s"] ?? 1000);
}
const DURATION = "(\\d+(?:\\.\\d+)?)\\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\\b";
const NUMBER = "(\\d[\\d,]*(?:\\.\\d+)?)";
const plain = (value: string) => Number(value.replaceAll(",", ""));

function assetPair(text: string): Pair | null {
  const match = new RegExp(`\\b(${ASSET_WORD})\\b`).exec(text);
  const asset = match?.[1] ? ASSETS[match[1]] : undefined;
  return asset ? pairOf(asset) : null;
}

function readIntent(lower: string): Intent | null {
  const text = lower.replace(/[?.!]+$/, "").trim();
  if (
    /^(stop|cancel|abort|halt|kill|disarm)(\s+(it|all|everything|that|this|missions?))?$/.test(text)
  )
    return { kind: "stop" };
  if (/^(help|commands|examples|what can you do|what do you do)$/.test(text))
    return { kind: "help" };
  if (/\d/.test(text)) return null;
  if (
    /^(flatten|close|unwind|exit)\b/.test(text) ||
    /^(sell|dump) (all|everything)\b/.test(text) ||
    /^(sell|dump) (all )?my\b/.test(text)
  )
    return { kind: "flatten", pair: assetPair(text) };
  if (/\b(scan|ladder|depth|how deep|liquidity)\b/.test(text))
    return { kind: "scan", pair: assetPair(text) ?? "HSK/USDT" };
  if (/\b(why|explain|break ?down)\b/.test(text))
    return { kind: "explain", pair: assetPair(text) ?? "HSK/USDT" };
  if (/\b(positions?|pnl|p&l|portfolio|holdings|fills|trades|swaps|how am i doing)\b/.test(text))
    return { kind: "position" };
  if (
    /\b(market|status|health|healthy|sources|venues|feeds)\b/.test(text) ||
    new RegExp(
      `^(how'?s|how is|what'?s|what is|show|check)\\b.*\\b(${ASSET_WORD})\\b|\\b(${ASSET_WORD}) (price|at)\\b|\\bprice of (${ASSET_WORD})\\b|^(${ASSET_WORD})$`,
    ).test(text)
  )
    return { kind: "market", pair: assetPair(text) };
  return null;
}

/** Parses one sentence. `spans` index into the original text, for live highlighting. */
export function parseIntent(input: string): Parsed {
  const original = input.trim();
  const offset = input.indexOf(original);
  const lower = original.toLowerCase();
  const fail = (reason: string, spans: Span[] = []): Parsed => ({
    intent: { kind: "unknown", reason },
    spans,
  });
  if (!original) return fail("Say what you want done.");

  const read = readIntent(lower);
  if (read) {
    return {
      intent: read,
      spans: [{ start: offset, end: offset + original.length, role: "verb" }],
    };
  }

  // Clauses are lifted out of a same-length copy, so spans still point at the original text.
  let rest = lower;
  const spans: Span[] = [];
  const lift = (pattern: RegExp, role: SpanRole): RegExpExecArray | null => {
    const match = pattern.exec(rest);
    if (!match) return null;
    spans.push({
      start: offset + match.index,
      end: offset + match.index + match[0].length,
      role,
    });
    rest =
      rest.slice(0, match.index) +
      " ".repeat(match[0].length) +
      rest.slice(match.index + match[0].length);
    return match;
  };

  let dryRun = false;
  if (
    lift(
      /^(?:quote|preview|simulate|dry[- ]?run|price check|how much (?:is|for|would|does|to)(?: it)?(?: cost)?(?: to)?|what(?:'s| is| would)(?: the)? (?:price|cost)(?: of| for| to)?|what would)\b/,
      "dry",
    )
  )
    dryRun = true;
  if (lift(/\b(?:dry[- ]?run|don'?t fill|without filling|no fill|just a quote|cost)$/, "dry"))
    dryRun = true;
  if (/-\s*\.?\d/.test(rest)) return fail("Amounts and limits can’t be negative.");

  let trigger: Trigger | null = null;
  let triggerAsset: string | undefined;
  const triggerPattern = new RegExp(
    "\\b(?:if|when|once|after)\\s+(?:the\\s+)?(?:price\\s+of\\s+)?" +
      `(?:(${ASSET_WORD})\\s+|(?:it|price)\\s+)?(?:price\\s+)?` +
      "(?:" +
      `(?:drops?|falls?|dips?|goes\\s+down|is\\s+down|gets\\s+down)\\s+(?:by\\s+)?${NUMBER}\\s*(?:%|percent)` +
      `|(?:rises?|pumps?|goes\\s+up|jumps?|is\\s+up|climbs?|gets\\s+up)\\s+(?:by\\s+)?${NUMBER}\\s*(?:%|percent)` +
      `|(?:is\\s+|goes\\s+|gets\\s+|drops?\\s+|falls?\\s+|dips?\\s+|trades\\s+)?(?:below|under|<)\\s*\\$?${NUMBER}` +
      `|(?:is\\s+|goes\\s+|gets\\s+|rises?\\s+|climbs?\\s+|trades\\s+)?(?:above|over|>)\\s*\\$?${NUMBER}` +
      ")",
  );
  const triggerMatch = lift(triggerPattern, "trigger");
  if (triggerMatch) {
    triggerAsset = triggerMatch[1];
    const [drop, rise, below, above] = triggerMatch.slice(2);
    if (drop) trigger = { type: "drop", pct: plain(drop) };
    else if (rise) trigger = { type: "rise", pct: plain(rise) };
    else if (below) trigger = { type: "below", price: plain(below) };
    else if (above) trigger = { type: "above", price: plain(above) };
    if (trigger && ("pct" in trigger ? trigger.pct : trigger.price) <= 0)
      return fail("A trigger needs a number above zero.", spans);
    if (trigger && "pct" in trigger && trigger.pct >= 100)
      return fail("A trigger move must be under 100%.", spans);
  } else if (/\b(if|when|once)\b/.test(rest)) {
    return fail(
      "I can arm on a price or a move: “if HSK drops 1%”, “when ETH is above 4000”.",
      spans,
    );
  }

  let maxCostBps: number | null = null;
  const guard = lift(
    new RegExp(
      `\\b(?:(?:max(?:imum)?|at most|within|no more than|cap(?:ped)?(?: at)?|under|up to)\\s+(?:cost\\s+|slippage\\s+|spread\\s+)?(?:of\\s+)?${NUMBER}\\s*(bps|bp|%|percent)(?![a-z])|${NUMBER}\\s*(bps|bp|%|percent)\\s+(?:max(?:imum)?|cap|slippage|cost))(?![a-z])|\\bslippage\\s+${NUMBER}\\s*(bps|bp|%|percent)`,
    ),
    "guard",
  );
  if (guard) {
    const value = guard[1] ?? guard[3] ?? guard[5];
    const unit = guard[2] ?? guard[4] ?? guard[6];
    const stated = plain(value ?? "0");
    maxCostBps = unit?.startsWith("bp") ? stated : stated * 100;
    if (maxCostBps <= 0) return fail("A cost limit needs a number above zero.", spans);
  }

  let durationMs: number | null = null;
  const duration = lift(
    new RegExp(`\\b(?:over|across|during)\\s+(?:the\\s+next\\s+)?${DURATION}`),
    "schedule",
  );
  if (duration?.[1] && duration[2]) durationMs = toMs(duration[1], duration[2]);
  let count: number | null = null;
  const sliced = lift(
    /\b(?:(?:in|into|across|using|with)\s+)?(\d+)\s+(?:slices?|clips?|chunks?|parts?|tranches?|pieces?)\b/,
    "schedule",
  );
  if (sliced?.[1]) count = Number(sliced[1]);
  let expiresInMs: number | null = null;
  const expiry = lift(
    new RegExp(`\\b(?:for|within)\\s+(?:the\\s+next\\s+)?${DURATION}`),
    "schedule",
  );
  if (expiry?.[1] && expiry[2]) expiresInMs = toMs(expiry[1], expiry[2]);
  rest = rest.replace(/\bfor gas\b/, (phrase) => " ".repeat(phrase.length));

  if (count !== null && (count < 2 || count > MAX_SLICES))
    return fail(`Slices must be between 2 and ${MAX_SLICES}.`, spans);
  if (durationMs !== null && (durationMs < 10_000 || durationMs > MAX_DURATION_MS))
    return fail("Run a slice schedule over 10 seconds to 1 hour.", spans);
  if (expiresInMs !== null && (expiresInMs < 5_000 || expiresInMs > MAX_EXPIRY_MS))
    return fail("A time limit must be between 5 seconds and 24 hours.", spans);
  const slices =
    count !== null || durationMs !== null
      ? {
          count:
            count ??
            Math.min(
              MAX_SLICES,
              Math.max(2, Math.round((durationMs ?? 0) / 1000 / SECONDS_PER_DEFAULT_SLICE)),
            ),
          durationMs: durationMs ?? ((count ?? 2) - 1) * SECONDS_PER_DEFAULT_SLICE * 1000,
        }
      : null;

  const core = readCore(rest, offset, spans);
  if ("reason" in core) return fail(core.reason, spans);

  const clauseAsset = triggerAsset ? ASSETS[triggerAsset] : undefined;
  if (clauseAsset && pairOf(clauseAsset) !== core.pair)
    return fail(`The trigger watches ${clauseAsset}, but the swap trades ${core.pair}.`, spans);

  return {
    intent: {
      kind: "swap",
      ...core,
      dryRun,
      slices,
      trigger,
      maxCostBps,
      expiresInMs,
    },
    spans,
  };
}

type Core = Pick<SwapIntent, "pair" | "side" | "amount" | "amountIn">;
type Token =
  | { type: "verb"; verb: "buy" | "sell" | "swap"; start: number; end: number }
  | { type: "amount"; value: string; dollar: boolean; start: number; end: number }
  | { type: "asset"; asset: Asset; start: number; end: number }
  | { type: "to" | "of"; start: number; end: number };

function readAmount(raw: string): { value: string; dollar: boolean } | null {
  const match = /^(\$?)(\d[\d,]*(?:\.\d+)?|\.\d+)([km])?$/.exec(raw);
  if (!match?.[2]) return null;
  const digits = match[2].replaceAll(",", "");
  const value = match[3]
    ? (Number(digits) * (match[3] === "k" ? 1_000 : 1_000_000)).toFixed(6).replace(/\.?0+$/, "")
    : digits.startsWith(".")
      ? `0${digits}`
      : digits;
  return Number(value) > 0 ? { value, dollar: match[1] === "$" } : null;
}

function readCore(rest: string, offset: number, spans: Span[]): Core | { reason: string } {
  // "want to buy" keeps the real verb; "want 500 USDT of HSK" keeps "want" as the buy verb.
  const text = rest.replace(/\b(need|want|wanna|like)\s+to\s+(?=[a-z])/g, (m) =>
    " ".repeat(m.length),
  );
  const tokens: Token[] = [];
  const unknown: string[] = [];
  for (const match of text.matchAll(/\$?\.?\d[\d,]*(?:\.\d+)?[km]?\b|->|→|[a-z&']+/g)) {
    const word = match[0];
    const start = match.index;
    const end = start + word.length;
    const amount = /[\d]/.test(word) ? readAmount(word) : null;
    if (/\d/.test(word)) {
      if (amount) tokens.push({ type: "amount", ...amount, start, end });
      else unknown.push(word);
    } else if (ASSETS[word]) tokens.push({ type: "asset", asset: ASSETS[word], start, end });
    else if (BUY_VERBS.has(word)) tokens.push({ type: "verb", verb: "buy", start, end });
    else if (SELL_VERBS.has(word)) tokens.push({ type: "verb", verb: "sell", start, end });
    else if (SWAP_VERBS.has(word)) tokens.push({ type: "verb", verb: "swap", start, end });
    else if (TO_WORDS.has(word)) tokens.push({ type: "to", start, end });
    else if (OF_WORDS.has(word)) {
      if (tokens.at(-1)?.type !== "of") tokens.push({ type: "of", start, end });
    } else if (!FILLERS.has(word) && word !== "and") unknown.push(word);
  }
  for (const token of tokens) {
    if (token.type === "verb" || token.type === "amount" || token.type === "asset")
      spans.push({ start: offset + token.start, end: offset + token.end, role: token.type });
  }
  if (unknown.length > 0)
    return { reason: `I can’t read “${unknown.slice(0, 3).join(" ")}” yet, so I won’t guess.` };

  const verbs = tokens.filter((token) => token.type === "verb");
  if (verbs.length > 1) return { reason: "Give me one action at a time." };
  const verb = verbs[0]?.type === "verb" ? verbs[0].verb : null;
  const shape = tokens.filter((token) => token.type !== "verb");
  const signature = shape.map((token) => token.type).join(" ");
  const [first, second, third, fourth] = shape;
  const amountOf = (token: Token | undefined) => (token?.type === "amount" ? token : null);
  const assetOf = (token: Token | undefined) => (token?.type === "asset" ? token.asset : null);
  const hint = "Try “buy 500 USDT of HSK” or “sell 0.1 ETH”.";
  const build = (side: Side, base: Asset, amount: string, amountIn: Core["amountIn"]) => {
    const pair = pairOf(base);
    return pair
      ? { pair, side, amount, amountIn }
      : { reason: `Name the token to ${side}: HSK or ETH.` };
  };

  if (signature === "amount asset to asset") {
    // "swap 100 USDT to HSK", "sell 1 ETH for USDT", "buy 100 HSK with USDT".
    const value = amountOf(first)?.value ?? "";
    const a = assetOf(second);
    const b = assetOf(fourth);
    if (!a || !b) return { reason: hint };
    if (a === b) return { reason: `Both sides of that swap are ${a}.` };
    if (a !== "USDT" && b !== "USDT")
      return {
        reason: `Zethos prices ${a} and ${b} against USDT. Swap through USDT in two steps.`,
      };
    if (verb === "buy")
      return a === "USDT" ? build("buy", b, value, "quote") : build("buy", a, value, "base");
    return a === "USDT" ? build("buy", b, value, "quote") : build("sell", a, value, "base");
  }
  if (signature === "amount asset of asset" || signature === "amount of asset") {
    // "buy 500 USDT of HSK", "sell $200 of ETH", "500 USDT of HSK".
    const amount = amountOf(first);
    const unit = signature === "amount of asset" ? null : assetOf(second);
    const base = assetOf(signature === "amount of asset" ? third : fourth);
    if (!amount || !base || base === "USDT" || (unit ? unit !== "USDT" : !amount.dollar))
      return { reason: hint };
    return build(verb === "sell" ? "sell" : "buy", base, amount.value, "quote");
  }
  if (signature === "amount asset" && verb && verb !== "swap") {
    const amount = amountOf(first);
    const asset = assetOf(second);
    if (!amount || !asset) return { reason: hint };
    if (asset === "USDT")
      return { reason: `${verb === "buy" ? "Buy" : "Sell"} USDT against what, HSK or ETH?` };
    return build(verb, asset, amount.value, amount.dollar ? "quote" : "base");
  }
  if (signature === "asset to amount asset" && verb === "buy") {
    // "buy HSK with 500 USDT".
    const base = assetOf(first);
    const amount = amountOf(third);
    if (!base || !amount || assetOf(fourth) !== "USDT") return { reason: hint };
    return build("buy", base, amount.value, "quote");
  }
  if (signature === "asset to amount" && verb === "buy") {
    const base = assetOf(first);
    const amount = amountOf(third);
    if (!base || !amount?.dollar) return { reason: hint };
    return build("buy", base, amount.value, "quote");
  }
  return { reason: hint };
}
