# Zethos

Zethos is an AI market maker and trading agent for HSK Chain, with signed quotes and an on-chain best-execution check.
Built for the HSK Chain Horizon Hackathon, AI Agent Trading track; deadline **November 1, 2026, 21:30 IST**.

This repository is **scaffolding only**: empty trading modules, three placeholder pages and a health endpoint. The vault has no trading functions. The deployment script deliberately reverts until implemented.

## Layout

```text
apps/
  web/                         Next.js App Router; /, /operator, /stats
  engine/
    params.json                Spec section 4.2 defaults (spread.base is keyed per pair)
    src/
      config.ts                Full env schema; only PORT is loaded by the health stub
      config/                  Configuration module TODO
      chain/ feeds/ pools/ pricing/ quotes/ watcher/ markouts/
      arb/ risk/ agent/ llm/ api/ db/ recorder/   Empty module index.ts files
      server.ts                Hono GET /health only
      index.ts                 Bun server entry point
packages/
  contracts/                   Foundry; ZethosVault, local pool/router interfaces, test, deploy stub
  shared/                      HSK chains, token addresses, Quote types, generated ABIs
  tsconfig/                    Strict base and Next.js tsconfigs
.github/workflows/ci.yml        Build, unit tests, typecheck and lint; no forks or deployment
docs/                          Original supplied specs, kept locally and ignored by Git
```

The supplied specs use the earlier name **Conduit / ConduitVault**. Their text is retained unchanged locally. The explicit scaffold request takes precedence for the project name **Zethos**, contract **ZethosVault**, and EIP-712 domain **name `Zethos`, version `1`**. Module and planned component names follow the specs. TODO references to `docs/` require those local files; they are intentionally excluded from Git.

## Prerequisites and setup

- Bun **1.4.2** (the installed version; pinned in `packageManager`).
- Node.js **20.9+** for the Next.js CLI; CI uses Node 24.
- Foundry **1.8.6** (`forge`, `cast`, `anvil`) on `PATH`.
- Network access to npm, GitHub (OpenZeppelin), and Solidity compiler downloads for the first install/build.

If Foundry is absent, install via Foundry's official installer and `foundryup`:

```sh
curl -L https://foundry.paradigm.xyz | bash
export PATH="$HOME/.foundry/bin:$PATH"
foundryup --install v1.8.6
```

```sh
bun install
cp apps/engine/.env.example apps/engine/.env
cp apps/web/.env.example apps/web/.env.local
cp packages/contracts/.env.example packages/contracts/.env
bun run dev
```

`bun install` runs `forge soldeer install` to fetch OpenZeppelin at the exact tag declared in `packages/contracts/foundry.toml`. The Solidity dependency is managed by Foundry, not an npm contracts framework. Soldeer creates its dependency lockfile after a successful download. Commit both dependency lockfiles when the initial online install succeeds.

The empty env examples work for this scaffold: web defaults to mainnet and uses injected wallets, engine exposes only `GET http://localhost:8787/health`, and web serves `http://localhost:3000`. `PORT` overrides the engine port. `NEXT_PUBLIC_CHAIN_ID=133` selects testnet; `177` selects mainnet. Set `NEXT_PUBLIC_WALLETCONNECT_ID` to enable RainbowKit's default wallet connectors. WalletConnect needs no fabricated ID for local builds.

The engine exports a complete Zod schema for every variable in `docs/engine.md` section 4.1. Full trading configuration validation and startup are TODOs; the health-only server validates only `PORT` so development requires no keys or deployment. `bun:sqlite` is built into Bun and needs no package. Gemini's default is `gemini-3.8-flash`; override with `GEMINI_MODEL`.

## Commands

Run from the repository root unless a directory is shown.

| Command | Purpose |
|---|---|
| `bun install` | Install pinned workspace dependencies and the Foundry dependency |
| `bun run dev` | Build shared dependencies/codegen, then web :3000 and engine :8787 in watch mode |
| `bun run build` | Contracts → ABI generation → shared dist → apps |
| `bun run test` | Engine health smoke test and local Foundry test; fork tests excluded |
| `bun run lint` | Biome across repository TS/configs and `forge fmt --check` |
| `bun run typecheck` | Strict TypeScript checks and Solidity compilation |
| `bun run format` | Biome format/import/lint fixes and `forge fmt` |
| `bun run codegen` | Build contracts and generate typed ABIs into shared |
| `bun run contracts:install` | Install missing Soldeer dependencies from foundry.toml |
| `bun run contracts:test` | Local contract tests only |
| `bun run contracts:fork` | Opt-in mainnet fork tests, matching `test/fork/*` (currently empty) |
| `FOUNDRY_ACCOUNT=zethos-deployer bun run deploy:testnet` | Broadcast and Blockscout verification on chain 133, once deploy is implemented |
| `FOUNDRY_ACCOUNT=zethos-deployer bun run deploy:mainnet` | Broadcast and Blockscout verification on chain 177, once deploy is implemented |
| `bun run --cwd apps/web dev` | Web alone; build shared first with `bun run build` |
| `bun run --cwd apps/web start` | Start previously built web on :3000 |
| `bun run --cwd apps/engine dev` | Engine alone, Bun watch mode |
| `bun run --cwd apps/engine start` | Start previously built engine |
| `bun run --cwd packages/contracts fmt` | Solidity formatting |
| `cd packages/contracts && forge build` | Direct Foundry build |
| `cd packages/contracts && forge test` | Direct Foundry test (no fork URL is configured by default) |

Equivalent required checks:

```sh
bun install
bunx turbo run build
bunx turbo run test
bunx turbo run typecheck lint
bunx turbo run dev
# In another terminal, check the services, then stop dev with Ctrl-C:
curl --fail http://localhost:3000
curl --fail http://localhost:8787/health
# Direct Solidity checks:
cd packages/contracts
forge build
forge test
```

Turbo uses **strict env mode**. Public web variables are declared on web build/dev/typecheck tasks. All 15 engine env variables are explicitly passed through to engine dev, including keys supplied by the shell; Bun also loads `apps/engine/.env` from the task's working directory. Never log the parsed full configuration. Trading secrets are not needed by build/test tasks. Foundry task environment includes `FOUNDRY_PROFILE`, with optional `FOUNDRY_DIR` and `SVM_HOME` passthrough. Deploy commands bypass Turbo and its cache.

`@zethos/shared#codegen` depends on `contracts#build`; shared's build depends on codegen. The wagmi Foundry plugin reads `packages/contracts/out`. The checked-in empty ABI bootstrap matches the empty contract/interface shells and is replaced by codegen. Both applications consume the shared package's single public export. Generated ABIs are excluded from manual Biome checks.

## Deployer keystore

**Never put an owner or deployer private key in any `.env` file.** Import it interactively into Foundry's password-encrypted keystore:

```sh
cast wallet import zethos-deployer --interactive
cast wallet list
FOUNDRY_ACCOUNT=zethos-deployer bun run deploy:testnet
```

The last command passes `--account zethos-deployer` to `forge script`; Foundry prompts for the keystore password. `FOUNDRY_ACCOUNT` is an account **name**, not a secret, and may be set in `packages/contracts/.env`. No `--private-key` argument is used. Quote signer and executor are separate engine hot keys; neither may be the owner or deployer key. The deployment stub contains no broadcast calls or filesystem writes, and has no `fs_permissions`. Build/test never invoke deploy scripts.

## Addresses and implementation TODOs

- `packages/shared/src/constants.ts`: confirm the three mainnet token addresses in engine spec section 4.3; fill router, quoter, both pools and vault. Unconfigured addresses use `undefined`, never a usable-looking zero address. Testnet token addresses are not supplied. Token decimals must come from `decimals()` on-chain, with no ERC-20 decimal constants.
- `packages/contracts/src/interfaces/`: add minimal v3 pool and router signatures locally; confirm SwapRouter versus SwapRouter02 before defining router params. No Solidity import of Uniswap v3-core. Use OpenZeppelin `Math.mulDiv` when implementing the vault.
- `packages/contracts/script/Deploy.s.sol` and `.env.example`: fill public deployment roles and addresses after implementing the vault. Configure pools and token caps only after reading token decimals.
- `apps/engine/.env`, `apps/web/.env.local`: deployed vault addresses, network settings and service configuration. Examples enumerate all specified variables with blank values and comments.
- Every engine module index and web page lists its corresponding spec section/components. SIWE, WS, charts, pricing, signing, risk controls, agents and database operations remain TODOs.

Solidity is pinned to **0.8.24**, EVM **paris**, optimizer **200** runs. Both HSK RPC aliases and Blockscout API configurations are in `foundry.toml`; deploy wrappers supply `--verify --verifier blockscout` and the corresponding API URL.

## Pinned dependency versions and compatibility

These are exact manifest pins, with no `^` or `~`. Installation and final registry freshness must still be confirmed in an environment with package network access.

| Dependency | Version |
|---|---|
| Bun / Foundry (preinstalled tools) | 1.4.2 / 1.8.6 |
| Turbo / Biome / TypeScript | 2.11.10 / 2.6.3 / 6.0.3 |
| Next.js / React / React DOM | 16.4.3 / 19.3.1 / 19.3.1 |
| Tailwind CSS / Tailwind PostCSS | 4.3.3 / 4.3.3 |
| wagmi / viem / RainbowKit | 2.19.5 / 2.57.13 / 2.2.11 |
| TanStack Query / Recharts | 5.105.0 / 3.10.1 |
| Hono / Zod / Pino | 4.13.14 / 4.6.7 / 10.4.0 |
| @google/genai | 2.31.0 |
| @uniswap/v3-sdk / @uniswap/sdk-core | 3.31.7 / 7.19.4 |
| @wagmi/cli | 2.10.0 |
| OpenZeppelin Contracts (Soldeer) | 5.7.0 |
| @types/bun / @types/node | 1.4.2 / 26.4.0 |
| @types/react / @types/react-dom | 19.3.0 / 19.2.5 |

[RainbowKit 2.2.11](https://raw.githubusercontent.com/rainbow-me/rainbowkit/main/packages/rainbowkit/package.json) requires React/React DOM `>=18`, viem `2.x`, wagmi `^2.9.0`, and TanStack Query `>=5`. [wagmi 2.19.5](https://raw.githubusercontent.com/wevm/wagmi/wagmi@2.19.5/packages/react/package.json) accepts React `>=18`, viem `2.x`, and TanStack Query `>=5`. [Next.js 16.4.3](https://registry.npmjs.org/next/16.4.3) accepts React/React DOM `^19.0.0`. The chosen versions satisfy these declared peers. Wagmi stays on v2 as required by the fixed stack and RainbowKit's peer range; no React/Next downgrade is necessary.

TypeScript 6.0.3 retains the compiler API used by [Next.js's type checker](https://github.com/vercel/next.js/blob/canary/packages/next/src/lib/typescript/runTypeCheck.ts). TypeScript 7's replacement package uses a different API, so the scaffold pins the latest compatible TypeScript 6 release rather than claiming TypeScript 7 compatibility. Recharts is the stable 3.10.1 release, excluding its 3.11 canary.

## Planned MVP limitations

The supplied on-chain spec section 15 records: drawdown enforcement lives off-chain; there is one market maker; users need native HSK for gas and WHSK for swaps; HSK Chain carries centralisation/admin risks, so demo capital should remain small and be withdrawn after the event; the contracts are unaudited. These are future design constraints, not implemented guarantees in this scaffold. Mainnet deployment is required for hackathon eligibility. Nothing has been deployed by this scaffold task.

## Initial Git setup

The intended initial branch is `main`, remote is `git@github.com:divyyyam/zethos.git`, and the initial commit is:

```sh
git init -b main
git remote add origin git@github.com:divyyyam/zethos.git
git add .
git commit -m "chore: scaffold zethos monorepo"
```

`docs/`, env files, build outputs, dependencies and SQLite files are ignored. No push or deployment is part of scaffolding.

## Verification status in the scaffolding environment

- Passed: Bun syntax bundling of engine/web/shared sources with external packages unresolved, Solidity `forge fmt --check`, JSON/TOML parsing, exact manifest pin checks, spec module/env coverage, and a dry task graph check using cached Turbo 2.8.17 (not the pinned release).
- Blocked: `bun install` and all requested `bunx turbo` runs fail with `DNSResolveFailed` against npm. OpenZeppelin fetch fails on GitHub DNS. No npm dependencies or Solidity dependency were installed, and no dependency lockfiles could be generated.
- Blocked: direct `forge build` / `forge test` fail with a read-only filesystem error. Dev servers cannot start without their dependencies; neither port responded, and no server was left running.
- Blocked: `git init -b main` fails because the workspace `.git` mount is read-only. The `main` branch, `origin`, and scaffold commit remain pending. Their exact commands are above.

These limitations must be resolved and the required commands rerun before treating the scaffold as verified. No build, test, typecheck, or lint success is claimed from the syntax/configuration checks.
