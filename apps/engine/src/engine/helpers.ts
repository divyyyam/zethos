import type { Flow } from "../db";
import type { SignedQuote } from "../quotes";
import type { Token } from "../tokens";
export function flowOf(client: string | undefined): Flow {
  if (client === "web") return "user";
  if (client?.startsWith("sniper")) return "attacker";
  return "agent";
}

export function nonceKey(quote: SignedQuote): string {
  return `${quote.taker.toLowerCase()}:${quote.nonce}`;
}

export function tokenView(token: Token) {
  return { symbol: token.symbol, address: token.address, decimals: token.decimals };
}
