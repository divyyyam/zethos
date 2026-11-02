# Zethos

**An AI agent that builds, tests and operates a trading desk for a token project on HashKey Chain.**

Built for the **HashKey Chain Horizon Hackathon India · AI Agent Trading track**.

| | |
|---|---|
| Web app | _added at deploy_ |
| Engine (Cloudflare Workers) | _added at deploy_ |
| ZethosVault on HSK testnet (chain 133) | _owner: add vault address and explorer link_ |
| Test tokens: tUSDT, tWETH, tWHSK | _owner: add confirmed addresses_ |
| ZethosVault on HashKey Chain mainnet (chain 177) | [`0x1e6c7fBCd245A1a4FA8aBaDf57dF1ECf2E1A2aAF`](https://hsk.blockscout.com/address/0x1e6c7fBCd245A1a4FA8aBaDf57dF1ECf2E1A2aAF), verified, unaudited, holds no inventory |
| Mainnet live settlement (chain 177) | Not enabled; the engine live-mode guard requires chain 133 |
| Demo video | _added at submission_ |

## The problem

HSK trades on centralised exchanges, while thin on-chain liquidity can give swaps worse prices
than the exchanges show. Token projects fix this by
handing inventory to a market maker. They can't inspect the strategy, can't see how it loses
money, and have no say in when it changes.

## What Zethos does

A founder gives Zethos inventory, working capital and a **mandate**: which pairs to trade, an
inventory band, maximum spread per trade size, an uptime target and a maximum operating loss.
The uptime field is a target; uptime is not measured. Zethos runs the desk and improves it in a loop:

1. **Quote.** A tradable request gets a firm EIP-712 signed price built from the venues configured
   for that pair, including HashKey Global, Binance, OKX, Gate and others across the supported pairs. `ZethosVault` checks the signature, expiry,
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

## Demo modes and user flows

The recorded demo uses **HSK testnet, chain 133**. `/status.mode` identifies `shadow` or `live`;
the quote route identifies paper or vault settlement. In live mode, wallet-approved vault fills
move test tokens on-chain and link to the explorer. Test tokens have no market value and are
labelled **tUSDT, tWETH and tWHSK**. Mainnet live mode is not enabled.

1. **Founder — `/desk`.** Connect a wallet and open **Test the desk**. Request a signed quote,
   inspect venues, spread terms and mandate/vault checks, try the route-cap and minimum presets,
   then choose **Settle from wallet** to approve and fill a valid live quote. A confirmed fill
   shows its transaction link and token balances.
2. **Trader — `/agent`.** Type `Buy 500 USDT of HSK`, review the cost limit, and authorize before
   approving in the wallet. Follow the six stages, inspect the result and **My position**, then
   try `Buy 500 USDT of HSK, max 1 bps` (one basis point is 0.01%). Quotes above the limit are held
   and refused if they do not return within the hold window; other safety gates can refuse first.
3. **Attacker — `/arena`.** Launch Naive, Sniper or Rotating attacks for up to 60 seconds, or Stop
   early. These always settle on paper, including against a live engine; attempts, taker scores
   and paper fills are visible, and by-flow profit/loss follows completed five-minute markouts.
   **Real vault fills** appear separately with explorer links and never enter paper totals.

A configured engine failure remains an error. A halted pair cannot quote; no demo check bypasses
that gate. Successful on-chain settlement and changed balances require the owner's real wallet.

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

 RESEARCH (offline, Bun CLI)                       ARENA (browser / apps/sniper)
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

Requires Bun 1.4.2 (and Foundry in WSL/Linux for contracts). The setup below initializes a new
shadow workspace; use the existing live demo servers as they are.

```sh
bun install
cp apps/web/.env.example apps/web/.env.local
cp apps/engine/.dev.vars.example apps/engine/.dev.vars
bun run dev                     # web on :3000, engine on :8787
```

`bun install` installs JavaScript dependencies only. Before contract work or root Turbo
commands (`dev`, `build`, and checks), install Foundry and run `bun run contracts:install` to
fetch the Solidity dependencies through Soldeer.

For Vercel, set the project's Root Directory to `apps/web` and enable access to files outside
that directory. The committed `apps/web/vercel.json` installs from the workspace root and builds
shared, SDK and web in order, using the committed ABI in `packages/shared/src/generated.ts`.
Regenerate and commit that file with `bun run codegen` whenever the contracts change.

Use **Launch attack** in the browser against either engine mode. The CLI bots below are for a
shadow engine; they refuse live mode (paper only, public endpoints, no keys):

```sh
ZETHOS_ENGINE_URL=http://localhost:8787 bun apps/sniper/src/index.ts --mode sniper --pair HSK/USDT
ZETHOS_ENGINE_URL=http://localhost:8787 bun apps/sniper/src/index.ts --capture-only --pair HSK/USDT --record dev-tape --duration-sec 1800
```

Replay fallback (every response labelled `paper-replay`; refuses held-out recordings):

```sh
cd apps/engine && FEEDS_REPLAY=scenarios/<dev-scenario>.json REPLAY_LOOP=1 bun scripts/replay.ts
```

Required checks, from the repository root:

```sh
export PATH="$HOME/.foundry/bin:$PATH"
bun run typecheck && bun run test
cd apps/web && bun run build
```

With the existing local servers running, `bun run --cwd apps/web demo:check` walks all three
flows using a stand-in wallet that declines every send and a network broadcast guard. It prints
pass/fail per step and exits non-zero on failure, including feed halts. It requires installed
Chromium; `DEMO_BROWSER_PATH` can select its executable. It never proves a successful real fill.

## Vault operations

Deployment, funding, secrets and production hosting are owner operations; see
[the contracts guide](packages/contracts/README.md) and [engine modes](apps/engine/README.md#live-mode-hsk-testnet).
Owner, quote signer and executor are separate roles. The existing demo engine on port 8787
must be used as it is: do not restart it or change its mode to run browser checks.

## Honest limits

- Live testnet vault settlement is real; shadow settlement, Arena attacks and Arena profit/loss
  are paper. Replay data is labelled as replay. Uptime is not measured.
- The vault is unaudited. Read active per-route caps from `/status.pairs[].vaultRoutes`; never
  assume a documented deployment or a configured address means a route is enabled.
- No hedging. Strategies are composed from a fixed component library, not arbitrary code. That's
  a deliberate v1 safety choice.
- The research agent runs offline. A slow model only delays research; it can't affect live
  quotes.

## Stack

Turborepo · Bun · TypeScript · Hono · Cloudflare Workers + Durable Objects · Drizzle · Neon ·
Next.js · Tailwind CSS · wagmi · viem · Recharts · Gemini · Solidity · Foundry · OpenZeppelin
