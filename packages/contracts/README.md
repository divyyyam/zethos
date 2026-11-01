# Zethos contracts

`ZethosVault` settles firm swap quotes signed off-chain, against its own inventory. The engine
proposes prices; this contract decides whether a trade is allowed. See the
[root guide](../../README.md) for how it fits into the product.

**Status: not audited. Deployed on HSK testnet only.** See [Before mainnet](#before-mainnet).

## Testnet deployment

Chain `133`, on `https://testnet-explorer.hskchain.net`. **tUSDT, tWETH and tWHSK** are test
assets with no market value. Mainnet live settlement is not enabled in the engine.

| Contract | Address / evidence |
|----------|--------------------|
| `ZethosVault` | _owner: add confirmed address and explorer link_ |
| `tUSDT` (6 decimals) | _owner: add confirmed address_ |
| `tWETH` (18 decimals) | _owner: add confirmed address_ |
| `tWHSK` | _owner: add confirmed address and decimals_ |
| Confirmed fill | _owner: add transaction explorer link_ |
| Source verification | _owner: add current explorer verification evidence_ |

Read deployed token metadata and route caps from chain and `/status`. Do not assume the native
wrapped-token predeploy is the tWHSK used by the demo. `DeployTestTokens.s.sol` creates tUSDT and
tWETH only; the owner must provide the separate tWHSK configuration used for the recorded demo.
Uptime is not measured; neither a deployment nor a mode label proves availability.

## Layout

```text
src/
  ZethosVault.sol               The vault
  interfaces/
    IZethosVault.sol            Types, events, errors and the documented external API
    IUniswapV3Pool.sol          The read-only pool surface used for price protection
  libraries/
    QuoteLib.sol                EIP-712 struct hash for a quote
    PoolPrice.sol               Spot output from a pool's sqrt price
  testnet/
    ZethosTestToken.sol         Owner-minted ERC-20 with no market value
script/
  Deploy.s.sol                  Deploys the vault and configures its routes
  DeployTestTokens.s.sol        Testnet only: deploys tUSDT and tWETH, mints to the owner
  Fund.s.sol                    Deposits inventory from the owner into the vault
test/
  base/VaultTest.sol            Shared fixture: a funded vault and quote helpers
  unit/                         One file per concern
  fuzz/                         Property tests over amounts, time, keys and prices
  invariant/                    Solvency under random fills, replays and outsiders
  script/                       Runs the deploy script itself
  mocks/                        Tokens, including hostile ones, and a settable pool
```

## How a fill works

1. The engine signs a `Quote` with the quote signer: EIP-712, domain `Zethos`, version `1`, this
   chain, this contract. `Quote` and the domain must match `packages/shared/src/eip712.ts`;
   `test/unit/Eip712Compatibility.t.sol` pins them to a fixture signed by viem.
2. The taker approves `amountIn` and calls `fill(quote, signature)`.
3. The vault checks, in this order:

   | Check | Error |
   |-------|-------|
   | Caller is the taker | `NotTaker` |
   | Signature recovers to `quoteSigner` | `InvalidSignature` |
   | `block.timestamp <= expiry` | `QuoteExpired` |
   | `issuedAt` at most 30 s ahead of block time | `QuoteNotYetValid` |
   | `0 < expiry - issuedAt <= maxTtl` | `TtlTooLong` |
   | Nonce unused for this taker | `NonceUsed` |
   | Not paused | `EnforcedPause` |
   | Route enabled | `RouteDisabled` |
   | Non-zero amounts | `InvalidAmount` |
   | `amountIn` within the route's cap | `SizeCapExceeded` |
   | Not worse than pool spot less tolerance, if the route has a pool | `WorseThanPool` |
   | Inventory covers `amountOut` | `InsufficientInventory` |

4. It spends the nonce, pulls `amountIn`, refuses any token that delivered a different amount
   (`UnsupportedToken`), pays `amountOut` and emits `Fill` for the chain watcher.

## Security model

| Role | Key | Can | Can't |
|------|-----|-----|-------|
| Owner | Cold | Withdraw, deposit, set routes, rotate keys, pause, unpause | |
| Quote signer | Hot | Sign quotes | Call any privileged function |
| Executor | Hot | Pause | Unpause, move funds, change configuration |

The three must be different addresses, and the contract enforces that on every change. Ownership
moves in two steps and can't be renounced, because an ownerless vault could never withdraw or
unpause. Withdrawals work while paused, so a pause can't trap funds.

**What the contract guarantees to a taker:** the exact signed amounts move atomically or not at
all, once per nonce, only for that taker, only before expiry.

**Assumptions and known limits:**

- **A stolen quote-signer key can drain inventory one capped fill at a time**, at any price it
  signs, until someone pauses or rotates it. Size caps limit each fill, not the total. There is no
  on-chain limit on volume over time, and no oracle: with no pool configured, the signature is the
  only price check. Keep inventory small and monitor `Fill` events.
- **Pool protection is a sanity floor, not an oracle.** It reads spot price, which can be moved
  within a transaction. Against an honest signer, moving it can only make fills revert. Against a
  stolen signer it can be moved out of the way, so it isn't a defence for that case. It's optional,
  and today no venue with real depth exists to compare against.
- **Only plain ERC-20 tokens.** Tokens that deliver less than the signed input are refused. Tokens
  that rebase, or can block transfers, aren't suitable for routes.
- **No native HSK.** The vault trades ERC-20 assets: tWHSK in the testnet demo, with its
  configured address and decimals. Native wrapping is not a substitute for that test token.
- **Admin power is total.** The owner can withdraw everything at any time. Inventory belongs to the
  operator; third-party liquidity is out of scope.

Deliberately not built, because the testnet goal doesn't need them:

- **`arbSwap`.** The HSKSwap router has not been confirmed on-chain, `SwapRouter` and
  `SwapRouter02` have different swap structs, and testnet has no pool liquidity to arbitrage. Add
  its interface and the function once the router is confirmed.
- **Pool protection on testnet.** Deploy with no pools (`pool = address(0)`), which matches reality.
- **A rolling volume limit, fork tests and an audit.** See [Before mainnet](#before-mainnet).

## Commands

```sh
bun run --cwd packages/contracts install:deps   # OpenZeppelin and forge-std, through Soldeer
bun run --cwd packages/contracts build
bun run --cwd packages/contracts test           # everything except test/fork
bun run --cwd packages/contracts test:ci        # more fuzz and invariant runs
bun run --cwd packages/contracts gas
bun run --cwd packages/contracts fmt
bun run codegen                                 # from the repo root, after any ABI change
```

## Deploying

Copy `.env.example` to `.env` and fill it in. Only public addresses go there. The key lives in an
encrypted keystore, and that account must be the owner, because route setup is owner-only:

```sh
cast wallet import zethos-owner --interactive
bun run --cwd packages/contracts deploy:testnet
bun run codegen
```

Then deposit inventory, set `NEXT_PUBLIC_VAULT_ADDRESS` for the web app and verify the source.

## Testnet rehearsal

Live mode uses real on-chain fills on HSK testnet (chain `133`) with tokens labelled tUSDT,
tWETH and tWHSK. The contract is unaudited. Deployment, minting, funding and use of a real wallet
are owner operations; automation for this demo must not broadcast, deploy or run migrations.

1. **Desk:** inspect the mandate and signed price, test refusals, then approve and fill from a real
   wallet. The result links to the explorer and refreshes both token balances.
2. **Agent:** draft and authorize a bounded trade, watch local verification and wallet approval/fill
   steps, then inspect the transaction and **My position**. Cost limits can refuse before any send.
3. **Arena:** attack paper inventory with local identities, no wallet and no token transfers.
   Separate real-vault rows come from watched `Fill` events; paper totals exclude them.

The browser stand-in check is `bun run --cwd apps/web demo:check` from the repo root. It declines
every `eth_sendTransaction`, blocks network broadcast methods and exits non-zero on a failed step.
It cannot verify successful settlement or changed balances; the owner records those with a real
wallet. The code's EVM target is `cancun`, using solc 0.8.24.

## Before mainnet

- [x] `forge build` and `forge test` pass against real OpenZeppelin 5.7, forge-std and solc 0.8.24.
- [x] `forge fmt --check` passes.
- [ ] Token addresses and decimals confirmed on-chain. `constants.ts` marks them unconfirmed.
- [ ] Independent audit.
- [ ] Decide whether a rolling volume limit is needed for the signer-key risk above.
- [ ] Owner is a hardware wallet or multisig. Signer and executor are separate hot keys.
- [ ] Full flow rehearsed on testnet: deposit, fill, pause, unpause, withdraw, key rotation.
- [x] Engine live mode and real fill watching are implemented for testnet.
- [ ] Mainnet live settlement remains disabled by `CHAIN_ID=133`; any mainnet enablement is
  separate owner work after the checks above, outside this demo.
- [ ] Monitoring and a pause runbook in place. Start with small caps and small inventory.
