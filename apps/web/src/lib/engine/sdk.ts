import { createZethos, ZethosError } from "@zethos/sdk";
import { createPublicClient, http } from "viem";
import { platformConfig } from "../platform-config";
import { sharedStream } from "./shared-stream";

function client(name: string) {
  return platformConfig.engineUrl
    ? createZethos({
        engineUrl: platformConfig.engineUrl,
        chainId: platformConfig.chain.id === 133 ? 133 : 177,
        client: name,
        credentials: "include",
        publicClient: createPublicClient({
          chain: platformConfig.chain,
          transport: http(process.env.NEXT_PUBLIC_RPC_URL),
        }),
      })
    : null;
}

/** `null` when no engine is configured: the app shows its labeled preview, never a fake engine. */
const webClient = client("web");
const stream = webClient ? sharedStream((handlers) => webClient.stream(handlers)) : null;
export const zethos = webClient && stream ? { ...webClient, stream } : null;
/** Same API under a separate client name, so the engine attributes these fills to `agent` flow. */
const agentClient = client("web-agent");
export const agentZethos = agentClient && stream ? { ...agentClient, stream } : null;

const messages: Record<string, string> = {
  paused: "The vault is paused.",
  pair_halted: "Prices for this pair are temporarily unavailable.",
  vault_capacity: "This amount is above the vault’s current capacity. Try a smaller amount.",
  insufficient_reference_depth: "This amount is too large to price reliably. Try a smaller swap.",
  rate_limited: "A few too many requests. Give it a moment and try again.",
  warming_up: "The engine is warming up. Prices arrive within a few seconds.",
  quote_expired: "That price expired before it was filled.",
  quote_invalid: "The vault refused that quote.",
  nonce_used: "That quote has already been filled.",
  taker_restricted: "This address can’t get quotes right now.",
  network: "We couldn’t reach the engine.",
  timeout: "The engine didn’t answer in time.",
  invalid_response: "The engine returned something unexpected.",
  unverified_quote: "The quote failed local verification, so it was not used.",
  wrong_mode: "This action isn’t available in the engine’s current mode.",
  assistant_unavailable:
    "English interpretation is unavailable. Try a complete quote question such as ‘How much HSK can I get for $500?’, or configure Gemini on the engine.",
  assistant_timeout:
    "Understanding that request took too long. Please try again; nothing was filled.",
};

/** User-facing copy for any failure. Engine `invalid_request` messages are written for people. */
export function failureMessage(error: unknown): string {
  if (error instanceof ZethosError) {
    if (error.code === "invalid_request") return error.message;
    return messages[error.code] ?? error.message;
  }
  return "Something went wrong. Nothing was filled by this step.";
}
