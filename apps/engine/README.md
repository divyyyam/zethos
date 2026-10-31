# Zethos engine

Hono on **Cloudflare Workers** (free plan), with Postgres on **Neon** via Drizzle. Read the
root [AGENTS.md](../../AGENTS.md) first. The wire contract is binding for the engine and
`@zethos/sdk`; `test/sdk.test.ts` runs the real SDK against the real app to enforce it.

## Architecture

```
request ─▶ Worker (src/index.ts) ─▶ Durable Object "Market" (src/durable/market.ts, one instance)
                                     ├─ Hono routes (src/api/index.ts)
                                     ├─ Engine facade and collaborators (src/engine/)
                                     ├─ heartbeat alarm every 2 s: poll exchange books → fuse → vol
                                     └─ /stream WebSockets (hibernatable)
                                              │
                                              ▼
                                     Neon Postgres (quotes, fills, inventory, epochs)
```

- **Why one Durable Object:** live prices and inventory sit in memory in a single-threaded
  instance, so nonce and inventory checks have no races, and the Worker stays stateless.
- **Why polling, not exchange WebSockets:** on the free plan every WebSocket message counts
  toward 100k Durable Object requests a day. A 2 s REST heartbeat costs ~43k a day and keeps
  the instance asleep between beats.
- **The heartbeat stops itself** after `heartbeat.idleStopMs` (10 min) without requests or
  stream clients, and restarts on the next request (prices warm up within a few seconds).
- **No database configured → in-memory store**, for local development and tests.

## Code map

```text
src/
  index.ts             Worker entry; still exports the Market Durable Object
  durable/market.ts    Durable Object boot, heartbeat and stream sockets
  api/
    index.ts           Hono app, CORS, body limits, errors and route registration
    http.ts            Shared JSON, validation, pagination and authentication helpers
    routes/            Public reads, paper swaps, Arena, auth, operator and chat
    market.ts          Compatibility export for the Durable Object's old path
  engine/
    index.ts           Engine facade; unchanged public methods and return types
    types.ts           Shared quote, stream, dependency and internal record types
    errors.ts          EngineError
    state.ts           One mutable state and the original promise queue for writes
    market.ts          Book ingestion, market reads, token routing and readiness gates
    quoting.ts         Firm paper quote issuance and request rate limits
    settlement.ts      Paper vault signature, nonce, capacity and settlement checks
    arena.ts           Paper epoch lifecycle, funding and Arena accounting
    pnl.ts             Statistics and paper P&L attribution
    heartbeat.ts       Markouts, risk, tape fills and periodic checkpoint orchestration
    risk.ts            Drawdown, feed, markout and inventory gates
    toxicity.ts        Behavioural taker observations, scores and tiers
    tuner.ts           Spread adjustment from completed markouts
    tape.ts            Exchange trade replay and quote outcome observations
    journal.ts         Deterministic decisions and optional narration
    operator.ts        Serialized operator controls and strategy reloads
    persistence.ts     State restore, quote reconciliation and checkpoints
    valuation.ts       Explicit-input inventory share, spread and equity math
    helpers.ts         Flow attribution, nonce keys and public token metadata
  engine.ts            Compatibility exports for existing callers
  llm/
    index.ts           Read-only interpretation and narration
    prompt.ts          Unchanged system prompt in readable fragments
  config/index.ts      Environment and strategy validation; loads params.json
  feeds/               REST polling, adapters, fused books and volatility
  pricing/index.ts     Spread, TTL and bigint output math
  quotes/index.ts      Request schemas, paper signer and EIP-712 verification
  db/                  Store interface, Neon/Drizzle and in-memory persistence
  tokens/index.ts      On-chain decimals and token/amount helpers
```

Each module starts at `index.ts`; helpers stay beside it. Engine collaborators share one
`EngineState`, so inventory, issued quotes and nonces remain under the same serialized
write boundary. The facade preserves the existing public API and old import paths.
The HTTP and SDK response shapes stay aligned through `test/sdk.test.ts`.

The shadow loop includes 1/5/30/300-second markouts, paper equity and P&L, honest exchange
tape capture, behavioural taker scoring and hysteretic tiers, drawdown/feed/markout risk
gates, spread tuning, the decision journal, Gemini interpretation/narration, and SIWE operator
controls. `apps/sniper` attacks through the public SDK. The frontend's Swap, Arena, Insights
and paper operator controls consume this engine; live settlement stays behind the ABI gates.

Live settlement, chain watching, on-chain arbitrage and pool adapters are deliberately deferred.
There are no confirmed pool deployments; only `pools: []` is accepted. The engine rejects live
mode instead of simulating readiness. The [MCP server](../mcp/README.md) consumes the public SDK
over stdio or Streamable HTTP; confirmed paper fills appear in Arena as `agent` flow.

## Endpoints (built)

`GET /health`, `GET /status`, `POST /quote`, `POST /paper/fill`, `GET /fills?taker&limit`,
`GET /stats?pair&from&to`, `GET /arena`, `GET /arena/takers`, `GET /decisions?limit&type`,
`POST /chat`, SIWE `/auth/nonce`, `/auth/verify`, `/auth/logout`, and operator-only `/pnl`,
`/operator/pause`, `/operator/resume`, `/operator/taker-tier`, `/operator/labels`,
`/operator/arena-reset`. `/fills` optionally filters by epoch. Stream frames are `price`,
`fill` (including markout updates), `arena`, `risk`, `decision`, `takerTier` and `params`.
Errors: `{ error, message? }` with the codes in `docs/engine.md` §15.

Quotes are persisted before returning their signatures. Settlement writes are serialized across
awaits and commit the fill, used nonce, quote status and inventory in one database transaction.
Firm paper quotes have no per-taker last look: later tier changes, skew or momentarily stale
feeds cannot revoke them; explicit pause and pair-halt gates still apply.

Analytics and control state are checkpointed in `engine_state` per epoch, with bounded price
and chart history. Normalized quote/fill/inventory records reconcile fills after a crash
between settlement and the next analytics checkpoint. Epoch reset preserves prior records and
checkpoints. SIWE challenges and revocable sessions use Durable Object storage. Apply all
Drizzle migrations before starting a deployment with `DATABASE_URL`.

Paper spread capture is **signed** edge at the fill mid, so sniped fills show losses (the
absolute-value expression in the original spec would conceal those losses). Inventory is the
remaining equity change; modelled gas is deducted separately. By-flow P&L uses completed 5-minute
markouts; missing feed observations stay missing. Gas is zero until an RPC estimate is available.
A fill without a healthy reference mid records `midAtFill: null`; it is excluded from spread
attribution rather than valued using an invented price. Arena responses flag stale valuations.

The 2-second REST heartbeat fetches books, tape and gas concurrently and schedules from the
start of the beat. Short-horizon observations use the first healthy price after their due time,
within `feeds.staleMs`; they are not represented as exact tick-level observations.

## Run locally

```sh
bun install                                   # from the repo root
bun run --cwd packages/shared build
bun run --cwd packages/sdk build               # needed by SDK ↔ engine tests
cp apps/engine/.dev.vars.example apps/engine/.dev.vars
bun run --cwd apps/engine dev                 # wrangler dev on :8787
curl localhost:8787/status                    # 503 warming_up for a few seconds, then live prices
bun run --cwd apps/engine test
bun run --cwd apps/engine typecheck
bun run --cwd apps/engine lint
bun run --cwd apps/engine check:feeds          # public live endpoint smoke check
```

Set `NEXT_PUBLIC_ENGINE_URL=http://localhost:8787` in `apps/web/.env.local`. No engine URL means
the frontend's explicitly labelled preview; an unreachable configured engine shows an error.
Paper swaps use the engine's token metadata and the connected address, without wallet balances,
approvals or transactions. The Agent can also quote under its existing browser paper identity.

For operator access set a public `OPERATOR_ADDRESS` and a random `SESSION_SECRET` of at least
32 bytes. Leave both unset for a read-only operator page. Set `GEMINI_API_KEY` and `GEMINI_MODEL`
for broad English interpretation and narration. Common quote questions work locally without an
LLM, e.g. “How much HSK can I get for $500?”; other wording uses `/chat` to propose a validated
plan. Quote requests fetch real signed quotes without filling; trade requests create a draft
that still requires authorization. The LLM never supplies executable prices or transactions.
The default is `gemini-3.5-flash-lite`; `GEMINI_MODEL` can override it. This is a current stable
model with function calling ([model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)).
Function-call IDs and thought signatures are preserved across tool responses.

Decimals and symbols are read from RPC. Only explicit `SHADOW_ASSUME_DECIMALS=true` allows
paper development to use the documented decimals when RPC metadata is unavailable; it logs
the assumption. Candidate token addresses are not a claim of settlement readiness.

`params.json` is bundled for Workers. Wrangler watches it locally; deployments pick up a new
bundle. A persisted engine journals strategy changes on restart. The engine's validated
`reloadParams` method rejects invalid replacements without changing the active strategy.
Runtime file watching is not available inside a Worker.

For an offline **paper replay**, record ordered NDJSON `book`/`trade` entries accepted by
`src/feeds/replay.ts`, set `FEEDS_REPLAY=<file>`, and run `bun run --cwd apps/engine replay`.
The replay server shifts timestamps onto wall time, labels responses `X-Zethos-Data: paper-replay`,
and never switches to fabricated or live data when the recording ends. Token metadata still
requires RPC or the explicit shadow assumption. Deterministic tests advance the same replay
clock without sleeps, including a public-SDK sniper attack and the flow/label blindness invariant.

## Database (Neon)

Tables live in `src/db/schema.ts`. Runtime code passes the validated `DATABASE_URL` binding
to `createDb(databaseUrl)` from `src/db/db.ts`; the Neon store uses that same factory.
For a direct query from engine code:

```ts
import { createDb } from "./db";
import { fills } from "./db/schema";

const db = createDb(databaseUrl);
const rows = await db.select().from(fills).limit(20);
```

`drizzle.config.ts` points at the same schema and reads `DATABASE_URL` for CLI migrations.

```sh
DATABASE_URL=postgres://... bun run --cwd apps/engine db:migrate   # applies drizzle/*.sql
bun run --cwd apps/engine db:generate                              # after changing src/db/schema.ts
```

## Deploy (Cloudflare free plan)

```sh
cd apps/engine
bunx wrangler login
bunx wrangler secret put PAPER_SIGNER_KEY     # a fresh key, never a wallet key
bunx wrangler secret put DATABASE_URL         # Neon pooled connection string
bunx wrangler deploy
```

Set `CORS_ORIGIN` in `wrangler.jsonc` to the deployed web origin (comma-separated for
several). On testnet set `CHAIN_ID=133` and the three token address vars.


## Live mode (HSK testnet)

`ENGINE_MODE=live` signs real quotes for the deployed vault. It needs `VAULT_ADDRESS`,
`OPERATOR_ADDRESS`, `QUOTE_SIGNER_KEY` and `EXECUTOR_KEY`, and it's limited to `CHAIN_ID=133` for now.

At boot the engine checks the vault's bytecode, `owner()`, `quoteSigner()`, `executor()`, `maxTtl()`,
and that `quoteDigest()` matches the shared EIP-712 types. Any mismatch keeps it in shadow mode, journals
`live_blocked` and lists the reasons in `/status.liveBlocked`.

Live quotes are clamped to each route's `enabled` and `maxAmountIn`, stay open for at least 60 seconds
and at most `maxTtl()`, and are priced from `balanceOf(vault)` minus open quotes. Paper quotes keep the
zero-address domain, and the Arena and tape replay keep running on paper. `/fills` doesn't show on-chain
fills yet, because the fill watcher isn't built.

Run it locally with `bun run dev:live-testnet`. Public values come from `packages/contracts/.env`, and
the hot keys are read from their keystores into the process environment, never into a file.
