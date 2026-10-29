# Zethos internal platform

The internal app lives in the existing Next.js app and leaves the landing page independent.
It inherits the landing's Instrument Sans / Inter fonts, palette, rounded surfaces, and glass
details. Internal styles are scoped by `[data-platform]` in `src/app/(app)/platform.css`.

## Routes and current behavior

| Route       | Purpose                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `/app`      | Swap form, token selection, exchange/pool comparison, quote review, personal fills, assistant    |
| `/stats`    | Public market comparison, pair/range controls, execution metrics, verification links             |
| `/operator` | On-chain owner check, SIWE sign-in, inventory, risk, P&L, decision journal, gated pause controls |

With no engine URL, illustrative prices and market data are clearly labeled. Wallet discovery,
connection, reconnection, disconnection, network switching, address copying, and balance reads
are real. Preview prices never request approval or submit a transaction. An engine failure
never silently becomes a sample quote. The assistant supplies a local product guide when
unconfigured; swap instructions only populate the form and always require review.

Browser wallets use EIP-6963 discovery with injected-provider fallback. The wallet dialog,
account dialog, network dialog, pending states, and WalletConnect QR are custom UI. Mobile
pairing requires a WalletConnect project ID; no ID means the UI explains how to use an
installed browser wallet instead. No wallet account or connection is fabricated.

## Configuration

Copy `.env.example` to `.env.local` and set public values. Restart Next.js after changes.
All `NEXT_PUBLIC_*` values are shipped to the browser; none may contain private keys.

| Variable                       | Use                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CHAIN_ID`         | `177` mainnet (default) or `133` testnet                                     |
| `NEXT_PUBLIC_ENGINE_URL`       | REST origin; also supplies `/stream` WebSocket origin                        |
| `NEXT_PUBLIC_VAULT_ADDRESS`    | Actual deployed vault on the selected chain                                  |
| `NEXT_PUBLIC_WALLETCONNECT_ID` | Enables custom QR pairing; allowlist the deployed app origin in the project  |
| `NEXT_PUBLIC_RPC_URL`          | Optional public RPC override for the selected chain                          |
| `NEXT_PUBLIC_SITE_URL`         | Public app origin for WalletConnect metadata; browser origin is the fallback |
| `NEXT_PUBLIC_USDT_ADDRESS`     | Confirmed USDT token deployment                                              |
| `NEXT_PUBLIC_WHSK_ADDRESS`     | Confirmed wrapped HSK deployment                                             |
| `NEXT_PUBLIC_WETH_ADDRESS`     | Confirmed wrapped ETH deployment                                             |

Testnet requires explicit token addresses. Mainnet has candidate fallback addresses from
`packages/shared/src/constants.ts`, which are marked for confirmation in the project docs.
Token symbol and decimals are read from chain before live quote amounts are built. Do not
replace those reads with assumed decimals. The configured engine must serve the same vault;
the client rejects a different vault in `/status`.

## Engine boundary

`src/lib/engine/types.ts` defines the response shapes. `client.ts` validates responses at
runtime; `src/content/platform.mock.ts` is only for labeled previews. The current engine only
implements `/health`; the following endpoints still need backend implementation.

| Endpoint                   | Frontend contract                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /quote`              | `{ taker, tokenIn, tokenOut, amountIn }`; returns `VaultQuote` or `PoolQuote`            |
| `GET /status`              | `EngineStatus`, including deployed vault, balances, pair/reference health, pause state   |
| `GET /stats?pair&from&to`  | `StatsResponse`; request `from`/`to` and returned series `t` use Unix milliseconds       |
| `GET /fills?taker&limit=5` | `Fill[]` or `{ fills: Fill[] }`; timestamps use Unix milliseconds                        |
| `POST /chat`               | `{ role: "user", message, address?, history }`; returns `{ reply, cards }`               |
| `GET /auth/nonce`          | `{ nonce }`, single-use alphanumeric challenge of at least eight characters              |
| `POST /auth/verify`        | `{ message, signature }`; verifies SIWE and sets the operator session cookie             |
| `GET /pnl?period`          | `PnlResponse`, period `today`, `7d`, or `all`                                            |
| `GET /decisions?limit=10`  | `Decision[]` or `{ decisions: Decision[] }`; timestamps use Unix milliseconds            |
| `WS /stream`               | Public JSON frames `{ type, ... }`: `price`, `fill`, `arb`, `decision`, `risk`, `params` |

REST requests use `credentials: "include"`. Configure an exact frontend CORS origin and
credential support. Authentication must be enforced on the server: verify the SIWE domain,
URI, chain, current owner, expiry, and single-use nonce. Use an HttpOnly session cookie with
appropriate Secure/SameSite settings for the deployment. The local workspace lock removes
frontend access; it does not claim to revoke the server cookie. Private endpoints must check
authorization on every request and return `401` when the session expires.

Raw token quantities, nonces, and signed timestamps are base-10 integer strings over JSON,
never JS numbers. The quote parser checks uint256/uint64 bounds, taker/pair/amount binding,
65-byte signature format, positive output, validity of at most 120 seconds, signed/display
output agreement, and price protection against both supplied pool references. Quote
`issuedAt`/`expiry` are Unix seconds. `expiresAt` accepts seconds or milliseconds and must
match signed `expiry`. The route discriminator remains `"conduit"` for compatibility with
the engine specification; it does not change Zethos branding.

Errors may return `{ error: "paused" | "pair_halted" | "vault_capacity" |
"insufficient_reference_depth" | "rate_limited" | "invalid_request" }` with a suitable HTTP
status. Failed requests stay failed in the UI. Public stream events invalidate REST queries;
they do not trigger trading. The socket reconnects with backoff.

## Enabling real settlement

The generated ABI is currently empty, so approvals, fills, and operator contract writes are
disabled. Implement and deploy the vault first, then run the repo's `bun run codegen` flow.
Do not hand-edit the generated ABI or remove the capability gates to simulate readiness.

`use-swap-execution.ts` expects the documented vault interface: `fill(Quote,bytes)`,
`quoteSigner()`, `maxTtl()`, and `isNonceUsed(address,uint256)`. Before requesting an approval,
it checks deployed bytecode, reads the vault's signer and TTL, verifies the EIP-712 signature
locally, and checks nonce usage. The domain comes from `@zethos/shared`: **Zethos**, version
**1**, selected chain ID, actual verifying vault. Legacy docs use the name Conduit in places;
the deployed contract and engine must use the shared Zethos domain.

The approval is for the exact input amount. The flow rechecks the account, connector, chain,
and quote freshness around wallet prompts, simulates writes, checks receipts, and links
transactions to the selected chain's explorer. A quote needs at least five seconds remaining
when the next wallet action begins. Refreshing a price after approval may be necessary.
The contract must enforce all execution and pool-price guarantees at settlement time.

Operator access separately checks `owner()` and a verified backend session. Pause/unpause
requires the matching generated ABI functions and a fresh owner check; preview controls
remain disabled. Token balances and vault inventory use read-only chain calls.

## Validation

From the repo root:

```sh
bun run --cwd apps/web test
bun run --cwd apps/web typecheck
bun run --cwd apps/web lint
bun run build
```

The frontend tests cover malformed/stale/mismatched quotes, integer precision, pool-price
protection, wrong deployments, failure states, and real signed EIP-712 fixtures with wrong
chain/vault/signer/taker/amount/nonce variants. They do not use funds or a live wallet.

Browser review covered 375, 768, and 1440 pixel widths, keyboard/dialog behavior, token search
and reversal, preferences, assistant form population, stats controls, read-only operator
preview, and automated accessibility scans. A deterministic EIP-1193/EIP-6963 fixture covered
connection rejection, network add/switch, balance reads, reconnect, disconnect persistence,
and preview transaction prevention. Live mobile pairing and deployed-contract transactions
still require the configured services above.
