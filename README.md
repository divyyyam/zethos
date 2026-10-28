# Zethos

An AI trading agent for HSK Chain, designed to price swaps from exchange order books, settle signed quotes on-chain, and arbitrage HSKSwap pools.

Built for the **HSK Chain Horizon Hackathon · AI Agent Trading track**. Deadline: **November 1, 2026, 21:30 IST**.

## Structure

| Directory | Purpose |
| --- | --- |
| `apps/web` | Swap, operator, and stats pages |
| `apps/engine` | Pricing, quotes, feeds, arbitrage, risk, and agent modules |
| `packages/contracts` | Vault contract and local pool/router interfaces |
| `packages/shared` | Chain definitions, token constants, EIP-712 types, and ABIs |
| `packages/tsconfig` | Shared TypeScript configuration |

## Stack

Turborepo · Bun · TypeScript · Next.js · Tailwind CSS · wagmi · viem · RainbowKit · TanStack Query · Recharts · Hono · SQLite · Gemini · Solidity · Foundry

Currently scaffolding only. Trading logic and deployment are pending.
