import { type Address, formatUnits, type PublicClient, parseUnits } from "viem";
import type { z } from "zod";
import { ZethosError } from "./errors.js";
import * as s from "./schemas.js";
import { type StreamHandlers, streamUrl, subscribe, type Unsubscribe } from "./stream.js";
import { buildFillCalls, type FillCalls } from "./tx.js";
import type {
  Arena,
  ChatMessage,
  ChatResponse,
  Decision,
  Fill,
  Market,
  Pair,
  PairStatus,
  PaperQuote,
  QuoteIntent,
  QuoteRequest,
  QuoteResponse,
  Stats,
  Status,
  TakerRow,
} from "./types.js";
import { type Verification, type VerifyOptions, verifyQuote } from "./verify.js";

export interface ZethosOptions {
  engineUrl: string;
  chainId: 177 | 133;
  publicClient?: PublicClient;
  client?: string;
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
  credentials?: RequestCredentials;
  /** Request timeout. Default 10 000 ms. */
  timeoutMs?: number;
  /** Optional Unix-seconds clock for deterministic replay clients. */
  now?: () => number;
}

export type VerifyQuoteOptions = Pick<VerifyOptions, "now" | "minRemainingSec" | "maxSpreadVsMid">;

type Query = Record<string, string | number | undefined>;

export type Zethos = ReturnType<typeof createZethos>;

export function createZethos(options: ZethosOptions) {
  const engineUrl = options.engineUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const sentRequests = new WeakMap<object, QuoteRequest>();

  async function send(path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { "X-Zethos-Client": options.client ?? "sdk" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
      const response = await (options.fetch ?? globalThis.fetch)(`${engineUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(options.credentials ? { credentials: options.credentials } : {}),
      });
      const data: unknown = await response.json().catch(() => undefined);
      const error = s.errorBody.safeParse(data);
      if (!response.ok || error.success) throw httpError(response.status, error.data);
      if (data === undefined) {
        throw new ZethosError("invalid_response", `${path}: body is not JSON`);
      }
      return data;
    } catch (error) {
      if (error instanceof ZethosError) throw error;
      if (controller.signal.aborted) {
        throw new ZethosError("timeout", `${path}: no response after ${timeoutMs} ms`);
      }
      throw new ZethosError("network", `${path}: engine unreachable`, 0, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async function call<T extends z.ZodType>(
    path: string,
    schema: T,
    body?: unknown,
  ): Promise<z.output<T>> {
    const parsed = schema.safeParse(await send(path, body));
    if (!parsed.success) {
      throw new ZethosError("invalid_response", `${path}: unexpected response shape`, 0, {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  async function status(): Promise<Status> {
    const result = await call("/status", s.status);
    if (result.chainId !== options.chainId) {
      throw new ZethosError(
        "invalid_response",
        `Engine runs on chain ${result.chainId}, client expects ${options.chainId}`,
      );
    }
    return result;
  }

  function verifyWith(
    current: Status,
    quote: QuoteResponse,
    request: QuoteRequest | undefined,
    verifyOptions: VerifyQuoteOptions = {},
  ): Promise<Verification> {
    return verifyQuote(quote, request ?? sentRequests.get(quote), {
      ...(options.now ? { now: options.now() } : {}),
      ...verifyOptions,
      chainId: options.chainId,
      status: current,
      publicClient: options.publicClient,
    });
  }

  async function requireVerified(
    current: Status,
    quote: QuoteResponse,
    request: QuoteRequest | undefined,
  ): Promise<void> {
    const verification = await verifyWith(
      current,
      quote,
      request,
      quote?.route === "paper" ? { minRemainingSec: 0 } : {},
    );
    if (!verification.ok) {
      throw new ZethosError("unverified_quote", "Quote failed local verification", 0, verification);
    }
  }

  return {
    status,

    async market(pair?: Pair): Promise<Market[]> {
      const { pairs } = await status();
      return pairs.filter((p) => pair === undefined || p.pair === pair).map(toMarket);
    },

    /** Validates the response shape only. Call `verifyQuote` before acting on it. */
    async quote(input: QuoteRequest | QuoteIntent): Promise<QuoteResponse> {
      const request = isIntent(input)
        ? resolveQuoteIntent(parseIntent(input), await status())
        : validateRequest(input);
      const response = await call("/quote", s.quoteResponse, request);
      sentRequests.set(response, request);
      return response;
    },

    /** Arena always returns a paper quote, including when the vault is live. */
    async arenaQuote(input: QuoteRequest | QuoteIntent): Promise<PaperQuote> {
      const request = isIntent(input)
        ? resolveQuoteIntent(parseIntent(input), await status())
        : validateRequest(input);
      const response = await call("/arena/quote", s.paperQuote, request);
      sentRequests.set(response, request);
      return response;
    },

    /** Verifies against the paper signer locally before paper settlement, in either mode. */
    async arenaFill(quote: QuoteResponse, request?: QuoteRequest): Promise<Fill> {
      if (quote.route !== "paper") {
        throw new ZethosError("unverified_quote", "Only paper quotes can be Arena-filled");
      }
      await requireVerified(await status(), quote, request);
      return call("/paper/fill", s.fill, { quote: quote.quote, signature: quote.signature });
    },

    /** `request` defaults to the request this client sent for `quote`. */
    async verifyQuote(
      quote: QuoteResponse,
      request?: QuoteRequest,
      verifyOptions?: VerifyQuoteOptions,
    ): Promise<Verification> {
      return verifyWith(await status(), quote, request, verifyOptions);
    },

    /** Shadow mode only. Verifies locally first and refuses unverified quotes. */
    async paperFill(quote: QuoteResponse, request?: QuoteRequest): Promise<Fill> {
      const current = await status();
      if (current.mode !== "shadow") {
        throw new ZethosError("wrong_mode", "Paper fills are only available in shadow mode");
      }
      await requireVerified(current, quote, request);
      if (quote.route !== "paper") {
        throw new ZethosError("unverified_quote", "Only paper quotes can be paper-filled");
      }
      return call("/paper/fill", s.fill, { quote: quote.quote, signature: quote.signature });
    },

    /** Live mode only. Unsigned `approve` (when allowance is short) and `fill` call requests. */
    async buildFill(
      quote: QuoteResponse,
      { account }: { account: Address },
      request?: QuoteRequest,
    ): Promise<FillCalls> {
      const current = await status();
      if (current.mode !== "live") {
        throw new ZethosError("wrong_mode", "On-chain fills are only available in live mode");
      }
      if (!options.publicClient) {
        throw new ZethosError("invalid_request", "buildFill needs the publicClient option");
      }
      await requireVerified(current, quote, request);
      if (quote.route !== "conduit") {
        throw new ZethosError("unverified_quote", "Only vault quotes can be filled on-chain");
      }
      return buildFillCalls(options.publicClient, {
        vault: current.verifyingContract,
        quote,
        account,
      });
    },

    fills({
      taker,
      limit,
      epoch,
    }: {
      taker?: Address;
      limit?: number;
      epoch?: number;
    } = {}): Promise<Fill[]> {
      return call(withQuery("/fills", { taker, limit, epoch }), s.listOf(s.fill, "fills"));
    },

    stats({ pair, from, to }: { pair: Pair; from?: number; to?: number }): Promise<Stats> {
      return call(withQuery("/stats", { pair, from, to }), s.stats);
    },

    arena(): Promise<Arena> {
      return call("/arena", s.arena);
    },

    arenaTakers({ limit }: { limit?: number } = {}): Promise<TakerRow[]> {
      return call(withQuery("/arena/takers", { limit }), s.listOf(s.takerRow, "takers"));
    },

    decisions({ limit, type }: { limit?: number; type?: string } = {}): Promise<Decision[]> {
      return call(withQuery("/decisions", { limit, type }), s.listOf(s.decision, "decisions"));
    },

    chat({
      message,
      address,
      history = [],
    }: {
      message: string;
      address?: Address;
      history?: ChatMessage[];
    }): Promise<ChatResponse> {
      return call("/chat", s.chatResponse, { role: "user", message, address, history });
    },

    stream(handlers: StreamHandlers): Unsubscribe {
      return subscribe({
        url: streamUrl(engineUrl),
        WebSocket: options.WebSocket ?? globalThis.WebSocket,
        handlers,
      });
    },
  };
}

/** Resolves `{taker, pair, side, amount}` into a raw request. `amount` is in the sold token. */
export function resolveQuoteIntent(input: QuoteIntent, current: Status): QuoteRequest {
  const intent = parseIntent(input);
  const pair = current.pairs.find((p) => p.pair === intent.pair);
  if (!pair) throw new ZethosError("invalid_request", `Unknown pair ${intent.pair}`);
  const [sold, bought] = intent.side === "sell" ? [pair.base, pair.quote] : [pair.quote, pair.base];
  return validateRequest({
    taker: intent.taker,
    tokenIn: sold.address,
    tokenOut: bought.address,
    amountIn: parseAmount(intent.amount, sold.decimals, sold.symbol),
  });
}

/** Formats a base-unit amount string with the token's decimals. */
export function formatAmount(amount: string, decimals: number): string {
  return formatUnits(BigInt(amount), decimals);
}

function parseAmount(amount: string, decimals: number, symbol: string): string {
  const match = /^\d+(?:\.(\d+))?$/.exec(amount);
  if (!match || (match[1]?.length ?? 0) > decimals) {
    throw new ZethosError("invalid_request", `Invalid ${symbol} amount: ${amount}`);
  }
  return parseUnits(amount, decimals).toString();
}

function isIntent(input: QuoteRequest | QuoteIntent): input is QuoteIntent {
  return typeof input === "object" && input !== null && "pair" in input;
}

// Types do not reach plain JavaScript or JSON callers: an unknown side must not become a buy.
function parseIntent(intent: QuoteIntent): QuoteIntent {
  const parsed = s.quoteIntent.safeParse(intent);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new ZethosError("invalid_request", `Invalid quote intent: ${fields}`, 0, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function validateRequest(request: QuoteRequest): QuoteRequest {
  const parsed = s.quoteRequest.safeParse(request);
  if (
    !parsed.success ||
    parsed.data.amountIn === "0" ||
    parsed.data.tokenIn.toLowerCase() === parsed.data.tokenOut.toLowerCase()
  ) {
    throw new ZethosError("invalid_request", "Quote request is invalid", 0, request);
  }
  return parsed.data;
}

function httpError(status: number, body: z.infer<typeof s.errorBody> | undefined): ZethosError {
  const code = body?.error ?? `http_${status}`;
  return new ZethosError(code, body?.message ?? `Engine responded ${status} (${code})`, status);
}

function withQuery(path: string, query: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

function toMarket(pair: PairStatus): Market {
  const { mid, halfSpread } = pair;
  const priced = mid !== null && halfSpread !== null;
  return {
    pair: pair.pair,
    base: pair.base,
    quote: pair.quote,
    mid,
    bid: priced ? mid * (1 - halfSpread.sell) : null,
    ask: priced ? mid * (1 + halfSpread.buy) : null,
    spread: halfSpread ? halfSpread.buy + halfSpread.sell : null,
    health: pair.health,
    halted: pair.halted,
    sources: pair.sources,
    updatedAt: pair.updatedAt,
  };
}
