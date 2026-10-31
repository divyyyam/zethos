# Zethos

**An AI agent that builds, tests and operates a trading desk for a token project on HashKey Chain.**

Built for the **HashKey Chain Horizon Hackathon India · AI Agent Trading track**.

| | |
|---|---|
| Web app | _added at deploy_ |
| Engine (Cloudflare Workers) | _added at deploy_ |
| ZethosVault on HSK Chain mainnet (chain 177) | _added at deploy, verified on [hsk.blockscout.com](https://hsk.blockscout.com)_ |
| Demo video | _added at submission_ |

## The problem

HSK trades millions of dollars a day on centralised exchanges, but on-chain liquidity on HSK Chain
is thin, so on-chain swaps get worse prices than the exchanges show. Token projects fix this by
handing inventory to a market maker. They can't inspect the strategy, can't see how it loses
money, and have no say in when it changes.

## What Zethos does

A founder gives Zethos inventory, working capital and a **mandate**: which pairs to trade, an
inventory band, maximum spread per trade size, an uptime target and a maximum operating loss.
Zethos then runs the desk and improves it in a loop:

1. **Quote.** Every swap gets a firm EIP-712 signed price built from live order books on
   HashKey Global, Binance, OKX, Gate and others. `ZethosVault` checks the signature, expiry,
   nonce, size caps and pool price, then settles both legs or reverts.
2. **Diagnose.** Losses are attributed to a cause (stale reference, inventory imbalance,
   selective execution or adverse size), with dollar amounts and example fills (`GET /diagnosis`).
3. **Research.** A research agent (Gemini, offline) reads the diagnosis and proposes a competing
   strategy as a **spec in a validated policy language**, built only from a fixed component
   library. It never writes code.
4. **Attack.** The candidate is replayed against the incumbent on development data, every Arena
   attack scenario, and **held-out** data, including an attacker the research agent never saw.
   Qualification accepts or rejects with a reason for every rule. A strategy that refuses every
   trade is rejected.
5. **Deploy carefully.** A qualified strategy gets a small, fixed share of live requests as a
   canary, and is promoted or retired from real results. It can never step outside the mandate.

## Safety by construction

- **The LLM is never in the live pricing loop.** Candidates are data: validated, canonically
  hashed and compiled deterministically.
- **The mandate is enforced outside the strategy**, after it decides and before anything is
  signed. Breaches are rejected and journaled as `mandate_breach`.
- **Held-out data is physically separate.** The research path fails closed before reading it.
- **Reports are reproducible** and bound to the hash of the exact spec they evaluated. The registry
  refuses a spec without a matching report.
- **Decision journal:** every registration, qualification, breach, diagnosis and promotion is
  recorded with its inputs and reason.

## Architecture

```
            exchange order books (HashKey Global, Binance, OKX, Gate, ...)
                                 │
                                 ▼
 taker ── quote ──▶  ENGINE (Hono on Cloudflare Workers + Durable Object, Neon Postgres)
   ▲                 feed fusion → policy (incumbent / canary) → mandate execution layer → EIP-712 signer
   │                 registry · diagnosis · journal · Arena · stream
   │◀── signed quote ┘
   │
   └── fill(quote, sig) ──▶ ZethosVault (HSK Chain): verify, settle atomically or revert

 RESEARCH (offline, Bun CLI)                       ARENA (apps/sniper)
 /diagnosis + dev scenarios ─▶ Gemini ─▶ spec      naive · sniper · latecomer · rotating
 spec ─▶ evaluator (dev, scenarios, held-out)       + held-out attacker, public endpoints only
      ─▶ qualification ─▶ POST /policies            recorder turns every run into a scenario
```

| Path | Purpose |
|------|---------|
| `apps/engine` | Feeds, pricing policies, mandate execution layer, registry, diagnosis, journal, API, research CLI (`scripts/research-*.ts`, `src/research`) |
| `apps/web` | Landing, swap app, Desk (mandate and compliance), Research (pipeline, specs, reports, verdicts), Arena, journal |
| `apps/sniper` | Paper attacker bots and the S9 scenario recorder |
| `packages/contracts` | `ZethosVault` (Solidity, Foundry): unit, fuzz and solvency invariant tests |
| `packages/shared` | Chain definitions, token addresses, EIP-712 types, generated ABIs |
| `packages/sdk` | Internal TypeScript client with local signed-quote verification |

## The research cycle

```sh
cd apps/engine
ENGINE_URL=https://<engine> GEMINI_API_KEY=... ADMIN_TOKEN=... \
  bun scripts/research-cycle.ts --date=YYYYMMDD --incumbent=v0 --pair=HSK/USDT
```

It fetches `/diagnosis`, builds proposal inputs from **development scenarios only**, asks Gemini
for a candidate spec (retrying with validation errors, at most 3 times), freezes it, evaluates it
on dev, scenario and held-out data, applies qualification, and posts the exact spec and report to
`POST /policies`. Every prompt, response and report is saved under `research-runs/` with keys
redacted.

## Run locally

Requires Bun 1.4.2 (and Foundry in WSL/Linux for contracts).

```sh
bun install
cp apps/web/.env.example apps/web/.env.local
cp apps/engine/.dev.vars.example apps/engine/.dev.vars
bun run dev                     # web on :3000, engine on :8787
```

Arena attackers (paper only, public endpoints, no keys):

```sh
ZETHOS_ENGINE_URL=http://localhost:8787 bun apps/sniper/src/index.ts --mode sniper --pair HSK/USDT
ZETHOS_ENGINE_URL=http://localhost:8787 bun apps/sniper/src/index.ts --capture-only --pair HSK/USDT --record dev-tape --duration-sec 1800
```

Replay fallback (every response labelled `paper-replay`; refuses held-out recordings):

```sh
cd apps/engine && FEEDS_REPLAY=scenarios/<dev-scenario>.json REPLAY_LOOP=1 bun scripts/replay.ts
```

Checks: `bun run test`, `bun run typecheck`, `bun run lint`, `bun run contracts:test`.

## Deploying the vault

Deployment uses an encrypted Foundry keystore, never a raw private key. Owner, quote signer and
executor must be three different keys.

```sh
cast wallet import zethos-owner --interactive
# packages/contracts/.env: FOUNDRY_ACCOUNT=zethos-owner plus the role addresses
bun run --cwd packages/contracts deploy:mainnet   # verifies on hsk.blockscout.com
bun run codegen
```

## Honest limits

- Prices, signatures, policy decisions and checks are real. **Swap settlement in the demo is
  paper** and is labelled paper everywhere. Arena numbers are paper.
- The vault is unaudited and deployed with tiny caps.
- No hedging. Strategies are composed from a fixed component library, not arbitrary code. That's
  a deliberate v1 safety choice.
- The research agent runs offline. A slow model only delays research; it can't affect live
  quotes.

## Stack

Turborepo · Bun · TypeScript · Hono · Cloudflare Workers + Durable Objects · Drizzle · Neon ·
Next.js · Tailwind CSS · wagmi · viem · Recharts · Gemini · Solidity · Foundry · OpenZeppelin
