# Zethos

**Exchange prices for every swap on HashKey Chain.**

Zethos is an AI market-making agent on HSK Chain. It prices your swap against live exchange
order books, signs a firm quote, and fills it atomically from its own on-chain vault. When the
vault can't beat the HSKSwap pool, it routes you to the pool instead. Around that loop, the
agent arbitrages HSKSwap pools back toward the exchange price, tunes its own spreads from how
its fills perform, pauses itself when markets break, and logs every decision with a reason.

Built for the **HashKey Chain Horizon Hackathon India · AI Agent Trading track**.

## Features

- **Firm, signed quotes**: EIP-712 quotes priced off HashKey Global, Binance and OKX books, valid for 30 seconds.
- **Atomic settlement**: the vault checks signature, expiry, nonce, size caps and pool price, then settles both legs or reverts.
- **Best route, always**: pool fallback whenever HSKSwap gives the better price.
- **Inventory- and volatility-aware spreads**.
- **Autonomous arbitrage** pulls HSKSwap pools toward the exchange mid.
- **Self-tuning**: spreads widen or narrow from post-fill markouts.
- **Risk gates**: auto-pause on drawdown, feed outage or bad markouts; per-pair halts.
- **Decision journal**: every agent action is recorded with its inputs and reason.
- **AI assistant** explains prices and decisions, and pre-fills swaps for you to review.
- **Operator console** with wallet sign-in (SIWE), inventory, P&L, journal and pause controls.
- **Public stats** comparing pool price to exchange mid, before and after Zethos.
- **SDK and MCP server**, so apps and other AI agents can quote and trade through Zethos.

The full scope, with build status, is in [AGENTS.md](./AGENTS.md#2-final-feature-list).

## How it works

```
user ──quote request──▶ engine ──reads──▶ exchange order books + HSKSwap pools
  ▲                       │
  │◀── signed quote ──────┘
  │
  └──fill(quote, sig)──▶ ZethosVault (HSK Chain) ── verifies & settles atomically
                              ▲
engine agent ──arbSwap──────┘   (executor key, only when the pool drifts from mid)
```

## Repo

| Path | Purpose |
|------|---------|
| `apps/web` | Landing page, swap app, public stats, operator console |
| `apps/engine` | Feeds, pricing, quotes, arbitrage, risk, agent, assistant, API |
| `packages/contracts` | `ZethosVault` and HSKSwap interfaces (Foundry) |
| `packages/shared` | Chain definitions, token addresses, EIP-712 types, generated ABIs |
| `packages/tsconfig` | Shared TypeScript config |
| `packages/sdk` | TypeScript SDK with local signed-quote verification |
| `apps/mcp` | [MCP server](apps/mcp/README.md): stdio/HTTP, verified paper swaps and unsigned live calls |

## Getting started

Requires Bun 1.4.2 and Foundry.

```sh
bun install                 # installs JS deps and Foundry deps (Soldeer)
cp apps/web/.env.example apps/web/.env.local
cp apps/engine/.env.example apps/engine/.env
cp packages/contracts/.env.example packages/contracts/.env
bun run dev                 # web on :3000, engine on :8787
```

Other commands: `bun run build`, `test`, `typecheck`, `lint`, `format`, `codegen`,
`contracts:test`, `contracts:fork`.

### Deploying the vault

Deployment uses an encrypted Foundry keystore. Never a raw private key:

```sh
cast wallet import zethos-owner --interactive    # once; stores an encrypted key
# packages/contracts/.env: FOUNDRY_ACCOUNT=zethos-owner plus the role and pool addresses
bun run deploy:testnet                            # or deploy:mainnet
bun run codegen                                   # refresh ABIs for engine and web
```

The owner, quote-signer and executor must be three different keys.

## Stack

Turborepo · Bun · TypeScript · Next.js · Tailwind CSS · wagmi · viem · RainbowKit ·
TanStack Query · Recharts · Hono · SQLite · Gemini · Solidity · Foundry · OpenZeppelin

## Status

The web app UI is complete and runs on clearly labeled sample data. The vault contract and
engine trading modules are being implemented now. See [AGENTS.md](./AGENTS.md) for module status.
