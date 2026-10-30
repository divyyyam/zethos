// What the prompt offers as you type. Pure text: nothing here prices or runs anything, and every
// completion still goes through the parser and then the user's authorization.
import { parseIntent } from "./intent";

const TEMPLATES = [
  "Buy 500 USDT of HSK",
  "Buy 100 USDT of ETH",
  "Buy 2,000 USDT of HSK over 2 minutes",
  "Buy 300 USDT of HSK if it drops 1%",
  "Buy 500 USDT of HSK, max 90 bps",
  "Sell 0.1 ETH",
  "Sell 1,000 HSK",
  "Sell 0.1 ETH if it rises 0.5%",
  "Swap 100 USDT to WHSK",
  "Quote 5k USDT of HSK",
  "Scan HSK depth",
  "Scan ETH depth",
  "Why this price on HSK?",
  "Why this price on ETH?",
  "How’s the market?",
  "My position",
  "Flatten everything",
  "Stop",
  "Help",
];

const AMOUNT = "\\$?\\d[\\d,]*(?:\\.\\d+)?[km]?";

/** Up to five whole sentences that begin with, or contain, what's been typed. */
export function completions(text: string): string[] {
  const typed = text.trimStart();
  const lower = typed.toLowerCase().replace(/\s+$/, "");
  if (!lower) return [];
  const results: string[] = [];
  const add = (sentence: string) => {
    if (sentence.toLowerCase() !== typed.toLowerCase() && !results.includes(sentence))
      results.push(sentence);
  };

  // Keep the user's own words and number; only finish the sentence.
  const buying = new RegExp(`^((?:buy|get|grab|get me|i need|i want)\\s+(${AMOUNT}))$`, "i").exec(
    lower,
  );
  if (buying) {
    const head = typed.trimEnd();
    add(`${head} USDT of HSK`);
    add(`${head} USDT of ETH`);
    add(`${head} HSK`);
  }
  const selling = new RegExp(`^((?:sell|dump)\\s+(${AMOUNT}))$`, "i").exec(lower);
  if (selling) {
    const head = typed.trimEnd();
    add(`${head} HSK`);
    add(`${head} ETH`);
    add(`${head} USDT of HSK`);
  }
  if (new RegExp(`^(?:\\w+\\s+)?${AMOUNT}\\s+(?:usdt|usd)$`, "i").test(lower)) {
    const head = typed.trimEnd();
    add(`${head} of HSK`);
    add(`${head} of ETH`);
  }
  if (new RegExp(`\\b${AMOUNT}\\s+(?:usdt|usd)\\s+of$`, "i").test(lower)) {
    const head = typed.trimEnd();
    add(`${head} HSK`);
    add(`${head} ETH`);
  }

  // A complete swap gets its next clause.
  if (parseIntent(typed).intent.kind === "swap" && !/[.?!,]$/.test(lower)) {
    const head = typed.trimEnd();
    if (!/\b(over|slices?|clips?)\b/.test(lower)) add(`${head} over 2 minutes`);
    if (!/\b(if|when|once)\b/.test(lower)) add(`${head} if it drops 1%`);
    if (!/\b(max|within|slippage)\b/.test(lower)) add(`${head}, max 100 bps`);
  }

  const starts = TEMPLATES.filter((item) => item.toLowerCase().startsWith(lower));
  const contains = TEMPLATES.filter(
    (item) => !item.toLowerCase().startsWith(lower) && item.toLowerCase().includes(lower),
  );
  for (const item of [...starts, ...contains]) add(item);
  return results.slice(0, 5);
}

/** The inline ghost: only ever the rest of the top result, when it really continues the text. */
export function ghostOf(text: string, options: string[]): string {
  const first = options[0];
  if (!text || !first?.toLowerCase().startsWith(text.toLowerCase())) return "";
  return first.slice(text.length);
}

export interface Modifier {
  label: string;
  test: RegExp;
  apply: (text: string) => string;
  remove: (text: string) => string;
}

const dropMatch = (pattern: RegExp) => (text: string) =>
  text
    .replace(pattern, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/** One-click clauses for a sentence that's already a swap. Each writes into the prompt itself. */
export const MODIFIERS: Modifier[] = [
  {
    label: "Over 2 min",
    test: /\bover\s+\d/i,
    apply: (text) => `${text.trimEnd()} over 2 minutes`,
    remove: dropMatch(/\s*\bover\s+(?:the\s+next\s+)?\d+(?:\.\d+)?\s*\w+/i),
  },
  {
    label: "Max 100 bps",
    test: /\b(?:max|within)\s+\d/i,
    apply: (text) => `${text.trimEnd()}, max 100 bps`,
    remove: dropMatch(/,?\s*\b(?:max|within)\s+\d+(?:\.\d+)?\s*(?:bps|bp|%|percent)/i),
  },
  {
    label: "If it drops 1%",
    test: /\bif\s+it\s+drops\b/i,
    apply: (text) => `${text.trimEnd()} if it drops 1%`,
    remove: dropMatch(/\s*\bif\s+it\s+drops\s+\d+(?:\.\d+)?\s*%/i),
  },
  {
    label: "Dry run",
    test: /^quote\b/i,
    apply: (text) => `Quote ${text.trim().replace(/^(buy|get|grab)\s+/i, "")}`,
    remove: (text) => `Buy ${text.replace(/^quote\s+/i, "")}`,
  },
];

export const STARTERS = [
  "Buy 500 USDT of HSK",
  "Sell 0.1 ETH",
  "Scan HSK depth",
  "Why this price on ETH?",
  "My position",
  "Help",
];
