# @zethos/sdk

TypeScript client for the Zethos engine. It never takes the engine's word for a quote: signature,
bindings, bounds, expiry and price protection are checked locally before anything is filled.

Runs in browsers, Bun and Node 20+. `fetch` and `WebSocket` are injectable.

## Install

```sh
bun add @zethos/sdk viem
```

## Quickstart

```ts
import { createZethos } from "@zethos/sdk";

const zethos = createZethos({ engineUrl: "http://localhost:8787", chainId: 133 });

const [hsk] = await zethos.market("HSK/USDT");
console.log(hsk?.mid, hsk?.bid, hsk?.ask);

// Sell 10 HSK. `amount` is a decimal string of the token being sold.
const quote = await zethos.quote({
  taker: "0xYourAddress",
  pair: "HSK/USDT",
  side: "sell",
  amount: "10",
});
const check = await zethos.verifyQuote(quote);
if (!check.ok) throw new Error(`Rejected: ${check.reasons.join(", ")}`);

const fill = await zethos.paperFill(quote); // shadow mode; verifies again and refuses bad quotes
```

## Amounts

Token amounts, nonces and signed timestamps stay **base-10 strings** in every parsed object,
exactly as on the wire, so quotes can be sent back to the engine unchanged. Every string is
validated as a canonical `uint256`/`uint64`. Convert with `BigInt(x)`, `toContractQuote(quote)`
(all quote integers as `bigint`) or `formatAmount(x, decimals)` (decimals come from `status().pairs`).
Prices and spreads are numbers (fractions: `0.002` = 20 bps).

## API

`createZethos({ engineUrl, chainId, publicClient?, client?, fetch?, WebSocket?, credentials?, timeoutMs? })`

`client` is sent as `X-Zethos-Client` (default `"sdk"`). `publicClient` (viem) is needed only for
live mode. Requests time out after 10 s.

| Method                                        | Returns                | Notes                                                                                                                                                         |
| --------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status()`                                    | `Status`               | Mode, signer, verifying contract, pairs, inventory. Rejects an engine on another chain                                                                        |
| `market(pair?)`                               | `Market[]`             | Mid, bid, ask, spread, health, sources                                                                                                                        |
| `quote({taker, tokenIn, tokenOut, amountIn})` | `QuoteResponse`        | Validates shape only; does not verify                                                                                                                         |
| `quote({taker, pair, side, amount})`          | `QuoteResponse`        | Resolves tokens and decimals. `sell` spends base, `buy` spends quote                                                                                          |
| `verifyQuote(quote, request?, opts?)`         | `Verification`         | Never throws for a bad quote. `request` defaults to the one this client sent                                                                                  |
| `paperFill(quote, request?)`                  | `Fill`                 | Shadow only (`wrong_mode`). Refuses unverified quotes (`unverified_quote`)                                                                                    |
| `buildFill(quote, {account}, request?)`       | `{approve?, fill}`     | Live only. Unsigned viem call requests for `walletClient.writeContract`                                                                                       |
| `fills({taker?, limit?})`                     | `Fill[]`               |                                                                                                                                                               |
| `stats({pair, from?, to?})`                   | `Stats`                |                                                                                                                                                               |
| `arena()` / `arenaTakers({limit?})`           | `Arena` / `TakerRow[]` |                                                                                                                                                               |
| `decisions({limit?, type?})`                  | `Decision[]`           |                                                                                                                                                               |
| `chat({message, address?, history?})`         | `ChatResponse`         |                                                                                                                                                               |
| `stream(handlers)`                            | `() => void`           | Handlers per frame type (`price`, `fill`, `decision`, `risk`, `arena`, `takerTier`) plus `onOpen`, `onClose`, `onError`. Reconnects with backoff 0.5 s → 15 s |

Standalone exports: `verifyQuote(quote, request, {chainId, status, publicClient?})`,
`verifyQuoteSignature`, `toContractQuote`, `resolveQuoteIntent`, `formatAmount`, `subscribe`,
`vaultAbi`, `schemas` (zod), and all wire types.

## Verification

`verifyQuote` returns `{ ok, trust, reasons }`. It accepts unparsed input and does not throw for
it: a bad quote or request is reported in `reasons`.

| Check                                                                      | Reason                 |
| -------------------------------------------------------------------------- | ---------------------- |
| Options are usable: `now`, `minRemainingSec` ≥ 0, `0 ≤ maxSpreadVsMid < 1` | `invalid_options`      |
| Route is `paper` or `conduit`                                              | `not_signed_route`     |
| `taker`, `tokenIn`, `tokenOut`, `amountIn` equal the request               | `binding_mismatch`     |
| Integers within `uint256`/`uint64`, `amountOut > 0`, `expiry > issuedAt`   | `out_of_bounds`        |
| Signature is 65 bytes of hex                                               | `bad_signature_format` |
| `expiry − issuedAt ≤ 120`                                                  | `ttl_too_long`         |
| `expiry > now + minRemainingSec` (default 5; 1 for paper TTL ≤ 5)          | `expired`              |
| `issuedAt ≤ now + 30`, the allowed clock skew                              | `issued_in_future`     |
| `paperOut` / `conduitOut` equals signed `amountOut`                        | `display_mismatch`     |
| `expiresAt` (seconds or ms) equals `expiry`                                | `expiry_mismatch`      |
| EIP-712 signer equals the expected signer                                  | `bad_signer`           |
| Output ≥ pool output, and ≥ `spotOut · (1 − maxSpreadVsMid)` (default 3%)  | `worse_than_reference` |

Expected signer:

- **paper** (`trust: "engine"`): domain `{Zethos, 1, chainId, 0x000…000}`, signer `status().signer`.
  A paper signature can never be valid on a real vault.
- **conduit** (`trust: "chain"`): domain `{Zethos, 1, chainId, vault}` with `vault =
  status().verifyingContract`, which must have bytecode; signer is `vault.quoteSigner()` read
  through `publicClient`, never taken from the engine.

`chainId` is always the one the client was created with.

## Errors

Every failure is a `ZethosError { code, status, message, details? }`. Codes are the engine's
(`paused`, `pair_halted`, `rate_limited`, …), `http_<status>` when an error body has no code, and
SDK codes `invalid_request`, `invalid_response`, `network`, `timeout`, `unverified_quote`,
`wrong_mode`. `status` is the HTTP status, or 0 for SDK-side errors.
