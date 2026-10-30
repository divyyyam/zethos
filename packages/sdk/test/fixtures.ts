import { quoteDomain, quoteTypes } from "@zethos/shared";
import { type Address, type Hex, zeroAddress } from "viem";
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import type {
  PaperQuote,
  PriceBreakdown,
  QuoteRequest,
  SignedQuote,
  Source,
  VaultQuote,
} from "../src/index.js";
import { toContractQuote } from "../src/index.js";

export const signer = privateKeyToAccount(generatePrivateKey());
export const otherSigner = privateKeyToAccount(generatePrivateKey());

export const TAKER: Address = "0x1111111111111111111111111111111111111111";
export const USDT = {
  symbol: "USDT",
  address: "0x2222222222222222222222222222222222222222",
  decimals: 6,
};
export const WHSK = {
  symbol: "WHSK",
  address: "0x3333333333333333333333333333333333333333",
  decimals: 18,
};
export const WETH = {
  symbol: "WETH",
  address: "0x5555555555555555555555555555555555555555",
  decimals: 18,
};
export const VAULT: Address = "0x4444444444444444444444444444444444444444";
export const ENGINE_URL = "https://engine.example.test";

/** Taker sells 1 USDT for WHSK. */
export const request: QuoteRequest = {
  taker: TAKER,
  tokenIn: USDT.address as Address,
  tokenOut: WHSK.address as Address,
  amountIn: "1000000",
};

export const nowSec = () => Math.floor(Date.now() / 1000);

const source: Source = { venue: "binance", mid: 0.5, weight: 1, status: "ok" };

export function pairStatus(pair: "HSK/USDT" | "ETH/USDT") {
  return {
    pair,
    base: pair === "HSK/USDT" ? WHSK : WETH,
    quote: USDT,
    mid: pair === "HSK/USDT" ? 0.5 : 3000,
    health: "ok",
    halted: false,
    sources: [source],
    halfSpread: { buy: 0.002, sell: 0.003 },
    updatedAt: 1_800_000_000_000,
  };
}

export function statusBody(overrides: Record<string, unknown> = {}) {
  return {
    mode: "shadow",
    chainId: 133,
    signer: signer.address,
    verifyingContract: zeroAddress,
    paused: false,
    riskState: "normal",
    pairs: [pairStatus("HSK/USDT"), pairStatus("ETH/USDT")],
    inventory: { USDT: "5000000000", WHSK: "10000000000000000000000" },
    equityUsd: 10000,
    ...overrides,
  };
}

export const breakdown: PriceBreakdown = {
  mid: 0.5,
  ref: 0.5,
  sources: [source],
  base: 0.001,
  vol: 0.0005,
  inventory: 0,
  toxicity: 0,
  degraded: 0,
  tuner: 0,
  half: 0.0015,
  sigmaT: 0.001,
  ttlSec: 30,
  tier: "normal",
};

export function signedQuote(overrides: Partial<SignedQuote> = {}): SignedQuote {
  const now = nowSec();
  return {
    ...request,
    amountOut: "1990000000000000000",
    nonce: "37",
    issuedAt: String(now),
    expiry: String(now + 30),
    ...overrides,
  };
}

export function signQuote(
  quote: SignedQuote,
  { account = signer, chainId = 133, vault = zeroAddress }: SignOptions = {},
): Promise<Hex> {
  return account.signTypedData({
    domain: { ...quoteDomain, chainId, verifyingContract: vault },
    types: quoteTypes,
    primaryType: "Quote",
    message: toContractQuote(quote),
  });
}

interface SignOptions {
  account?: PrivateKeyAccount;
  chainId?: number;
  vault?: Address;
}

/** Wire PaperQuote JSON signed with the paper domain. */
export async function paperQuoteBody(
  quote = signedQuote(),
  sign: SignOptions = {},
): Promise<PaperQuote> {
  return {
    route: "paper",
    id: "q_01",
    quote,
    signature: await signQuote(quote, sign),
    paperOut: quote.amountOut,
    poolOut: "1980000000000000000",
    poolVenue: "hskswap",
    spotOut: "2000000000000000000",
    savingVsPoolPct: 0.5,
    vsMidBps: -50,
    expiresAt: Number(quote.expiry),
    breakdown,
  };
}

/** Wire VaultQuote JSON signed for the vault domain. */
export async function vaultQuoteBody(
  quote = signedQuote(),
  sign: SignOptions = {},
): Promise<VaultQuote> {
  return {
    route: "conduit",
    id: "q_02",
    quote,
    signature: await signQuote(quote, { vault: VAULT, ...sign }),
    conduitOut: quote.amountOut,
    hskswapOut: "1980000000000000000",
    spotOut: "2000000000000000000",
    savingPct: 0.5,
    expiresAt: Number(quote.expiry),
    breakdown,
  };
}

export function fillBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "f_01",
    quoteId: "q_01",
    ts: 1_800_000_000_000,
    taker: TAKER,
    pair: "HSK/USDT",
    side: "buy",
    tokenIn: USDT.address,
    tokenOut: WHSK.address,
    amountIn: "1000000",
    amountOut: "1990000000000000000",
    price: 0.5025,
    midAtFill: 0.5,
    flow: "agent",
    paper: true,
    txHash: null,
    ...overrides,
  };
}

type Handler = (body: unknown) => Response | unknown;

export interface MockEngine {
  fetch: typeof fetch;
  calls: { method: string; path: string; headers: Headers; body: unknown; init: RequestInit }[];
}

/** Routes keyed by `"GET /status"`. Handlers return a Response or a JSON body (200). */
export function mockEngine(routes: Record<string, Handler>): MockEngine {
  const calls: MockEngine["calls"] = [];
  const fetchMock = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({
      method,
      path: url.pathname + url.search,
      headers: new Headers(init.headers),
      body,
      init,
    });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return Response.json({ error: "not_found" }, { status: 404 });
    const result = await handler(body);
    return result instanceof Response ? result : Response.json(result);
  };
  return { fetch: fetchMock as typeof fetch, calls };
}
