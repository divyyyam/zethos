import { isAddress, isHex } from "viem";
import { platformConfig } from "../platform-config";
import type {
  ChatResponse,
  Decision,
  EngineStatus,
  Fill,
  PnlResponse,
  QuoteRequest,
  QuoteResponse,
  SignedQuote,
  StatsResponse,
} from "./types";

const messages: Record<string, string> = {
  paused: "The vault is paused. You can still explore available pairs.",
  pair_halted: "Prices for this pair are temporarily unavailable.",
  vault_capacity: "This amount is above the vault’s current capacity. Try a smaller amount.",
  insufficient_reference_depth: "This amount is too large to price reliably. Try a smaller swap.",
  rate_limited: "A few too many requests. Give it a moment and try again.",
  invalid_request: "We couldn’t price this request. Check the pair and amount.",
};
export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = "EngineError";
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new EngineError(
      "invalid_response",
      "The service returned an unexpected response. Please try again.",
    );
  return value as Record<string, unknown>;
}
export function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new EngineError("invalid_response", "The service returned an invalid number.");
  return value;
}
function raw(value: unknown): string {
  const result = typeof value === "object" && value ? object(value).raw : value;
  if (typeof result !== "string" || !/^\d+$/.test(result))
    throw new EngineError("invalid_response", "The service returned an invalid token amount.");
  return result;
}
export async function engineRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  if (!platformConfig.engineUrl)
    throw new EngineError("not_configured", "The live service isn’t connected yet.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(`${platformConfig.engineUrl}${path}`, {
      ...init,
      credentials: "include",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
    const data: unknown = await response.json().catch(() => null);
    const record = data && typeof data === "object" ? object(data) : {};
    if (!response.ok || typeof record.error === "string") {
      const code = typeof record.error === "string" ? record.error : `http_${response.status}`;
      throw new EngineError(
        code,
        messages[code] ||
          (response.status === 401
            ? "Sign in again to access the operator workspace."
            : "The service is unavailable right now. Please try again."),
        response.status,
      );
    }
    return data;
  } catch (error) {
    if (error instanceof EngineError) throw error;
    if (init.signal?.aborted) throw error;
    throw new EngineError(
      "unavailable",
      "We couldn’t reach the live service. Your wallet and funds are unaffected.",
    );
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}

export const engine = {
  async quote(request: QuoteRequest, signal?: AbortSignal): Promise<QuoteResponse> {
    const data = object(
      await engineRequest("/quote", {
        method: "POST",
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
      }),
    );
    if (data.route === "hskswap")
      return {
        route: "hskswap",
        hskswapOut: raw(data.hskswapOut),
        reason:
          typeof data.reason === "string"
            ? data.reason
            : "The pool has the better price for this swap.",
      };
    if (data.route !== "conduit")
      throw new EngineError("invalid_response", "No valid route was returned.");
    const quote = object(data.quote);
    for (const key of ["taker", "tokenIn", "tokenOut"] as const) {
      if (typeof quote[key] !== "string" || !isAddress(quote[key]))
        throw new EngineError("invalid_quote", "The quote contains an invalid address.");
      if (quote[key].toLowerCase() !== request[key].toLowerCase())
        throw new EngineError(
          "invalid_quote",
          "The quote doesn’t match your wallet or selected tokens.",
        );
    }
    const parsed = {
      taker: quote.taker,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: raw(quote.amountIn),
      amountOut: raw(quote.amountOut),
      nonce: raw(quote.nonce),
      issuedAt: raw(quote.issuedAt),
      expiry: raw(quote.expiry),
    } as SignedQuote;
    if (
      parsed.amountIn !== request.amountIn ||
      BigInt(parsed.amountOut) <= 0n ||
      BigInt(parsed.expiry) <= BigInt(parsed.issuedAt)
    )
      throw new EngineError(
        "invalid_quote",
        "The quote doesn’t match your requested amount or validity window.",
      );
    if (
      typeof data.signature !== "string" ||
      !isHex(data.signature) ||
      data.signature.length !== 132
    )
      throw new EngineError("invalid_quote", "The quote is missing a valid signature.");
    const expiresAt = finite(data.expiresAt);
    const expirySeconds = expiresAt > 1e12 ? Math.floor(expiresAt / 1000) : expiresAt;
    if (expirySeconds !== Number(parsed.expiry) || expirySeconds <= Date.now() / 1000)
      throw new EngineError(
        "expired_quote",
        "That price has expired. Getting a fresh quote will fix it.",
      );
    const conduitOut = raw(data.conduitOut);
    if (conduitOut !== parsed.amountOut)
      throw new EngineError("invalid_quote", "The quoted output and display amount do not match.");
    return {
      route: "conduit",
      quote: parsed,
      signature: data.signature,
      conduitOut,
      hskswapOut: raw(data.hskswapOut),
      spotOut: raw(data.spotOut),
      savingPct: finite(data.savingPct),
      expiresAt: expirySeconds,
    };
  },
  async status(signal?: AbortSignal): Promise<EngineStatus> {
    const data = object(await engineRequest("/status", signal ? { signal } : {}));
    if (
      typeof data.paused !== "boolean" ||
      typeof data.riskState !== "string" ||
      !Array.isArray(data.pairs)
    )
      throw new EngineError("invalid_response", "Vault status is temporarily unavailable.");
    const vault = object(data.vault);
    if (typeof vault.address !== "string" || !isAddress(vault.address))
      throw new EngineError("invalid_response", "Vault status contains an invalid address.");
    if (
      platformConfig.vaultAddress &&
      vault.address.toLowerCase() !== platformConfig.vaultAddress.toLowerCase()
    )
      throw new EngineError(
        "invalid_response",
        "The connected service belongs to a different vault.",
      );
    return {
      paused: data.paused,
      riskState: data.riskState,
      pairs: data.pairs.map((value) => {
        const p = object(value);
        if (typeof p.pair !== "string" || typeof p.feed !== "string")
          throw new EngineError("invalid_response", "Pair status is unavailable.");
        return {
          pair: p.pair,
          feed: p.feed,
          mid: finite(p.mid),
          poolPrice: finite(p.poolPrice),
          gapPct: finite(p.gapPct),
          spreadBid: finite(p.spreadBid),
          spreadAsk: finite(p.spreadAsk),
        };
      }),
      vault: {
        address: vault.address,
        balances: Object.fromEntries(
          Object.entries(object(vault.balances)).map(([key, value]) => [key, raw(value)]),
        ),
      },
    };
  },
  async stats(
    pair: string,
    from: number,
    to: number,
    signal?: AbortSignal,
  ): Promise<StatsResponse> {
    const data = object(
      await engineRequest(
        `/stats?${new URLSearchParams({ pair, from: String(from), to: String(to) })}`,
        signal ? { signal } : {},
      ),
    );
    const summary = object(data.summary);
    if (!Array.isArray(data.series))
      throw new EngineError("invalid_response", "Market history is temporarily unavailable.");
    return {
      series: data.series.map((value) => {
        const p = object(value);
        return { t: finite(p.t), mid: finite(p.mid), poolPrice: finite(p.poolPrice) };
      }),
      fills: Array.isArray(data.fills) ? data.fills : [],
      arbs: Array.isArray(data.arbs) ? data.arbs : [],
      summary: {
        medianGapBefore: finite(summary.medianGapBefore),
        medianGapAfter: finite(summary.medianGapAfter),
        volumeFilled: finite(summary.volumeFilled),
        userSavings: finite(summary.userSavings),
        ...(typeof summary.swapsFilled === "number"
          ? { swapsFilled: finite(summary.swapsFilled) }
          : {}),
      },
    };
  },
  async fills(taker: string, signal?: AbortSignal): Promise<Fill[]> {
    const response = await engineRequest(
      `/fills?${new URLSearchParams({ taker, limit: "5" })}`,
      signal ? { signal } : {},
    );
    const data = Array.isArray(response) ? response : object(response).fills;
    if (!Array.isArray(data))
      throw new EngineError("invalid_response", "Swap activity is temporarily unavailable.");
    return data.map((value) => {
      const f = object(value);
      if (
        typeof f.txHash !== "string" ||
        !/^0x[\da-fA-F]{64}$/.test(f.txHash) ||
        typeof f.pair !== "string"
      )
        throw new EngineError("invalid_response", "Swap activity contains an invalid record.");
      return {
        id: String(f.id),
        ts: finite(f.ts),
        pair: f.pair,
        side: String(f.side ?? ""),
        amountIn: raw(f.amountIn),
        amountOut: raw(f.amountOut),
        savingPct: finite(f.savingPct),
        txHash: f.txHash as Fill["txHash"],
        price: finite(f.price),
      };
    });
  },
  async decisions(signal?: AbortSignal): Promise<Decision[]> {
    const response = await engineRequest("/decisions?limit=10", signal ? { signal } : {});
    const rows = Array.isArray(response) ? response : object(response).decisions;
    if (!Array.isArray(rows))
      throw new EngineError("invalid_response", "Decision history is unavailable.");
    return rows.map((value) => {
      const d = object(value);
      if (typeof d.type !== "string" || typeof d.reason !== "string")
        throw new EngineError("invalid_response", "A decision record is invalid.");
      return { id: String(d.id), ts: finite(d.ts), type: d.type, reason: d.reason };
    });
  },
  async pnl(period: string, signal?: AbortSignal): Promise<PnlResponse> {
    const d = object(
      await engineRequest(`/pnl?period=${encodeURIComponent(period)}`, signal ? { signal } : {}),
    );
    return {
      total: finite(d.total),
      spreadCapture: finite(d.spreadCapture),
      inventory: finite(d.inventory),
      arbitrage: finite(d.arbitrage),
      gas: finite(d.gas),
    };
  },
  async chat(
    message: string,
    address: string | undefined,
    history: { role: string; content: string }[],
  ): Promise<ChatResponse> {
    const d = object(
      await engineRequest("/chat", {
        method: "POST",
        body: JSON.stringify({ role: "user", message, address, history }),
      }),
    );
    if (typeof d.reply !== "string")
      throw new EngineError("invalid_response", "The assistant couldn’t respond right now.");
    return {
      reply: d.reply,
      cards: Array.isArray(d.cards)
        ? d.cards.map((v) => {
            const c = object(v);
            return { type: String(c.type), data: object(c.data) };
          })
        : [],
    };
  },
};
