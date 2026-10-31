# Zethos contracts

`ZethosVault` settles firm swap quotes signed off-chain, against its own inventory. The engine
proposes prices; this contract decides whether a trade is allowed. Read the root
[AGENTS.md](../../AGENTS.md) for how it fits into the product.

**Status: not audited and not deployed.** See [Before mainnet](#before-mainnet).

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
- **No native HSK.** The vault trades WHSK.
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

The target is one real, verifiable fill on HSK testnet (chain `133`). Testnet has no confirmed USDT
or WETH, so `tUSDT` and `tWETH` stand in for them. They have no market value and must be labelled as
test tokens wherever they appear, though the price still comes from real exchange books.

All amounts are raw units. Run these from `packages/contracts`, in order:

```sh
# Deploy tUSDT and tWETH. Copy the printed USDT_ADDRESS and WETH_ADDRESS into .env.
bun run deploy:test-tokens

# Deploy the vault and its four routes, then copy its address into .env as VAULT_ADDRESS.
bun run deploy:testnet

# WHSK inventory comes from wrapping faucet HSK. The value is in wei.
cast send "$WHSK_ADDRESS" "deposit()" --value <wei> --rpc-url hsk_testnet --account "$FOUNDRY_ACCOUNT"

# Set FUND_USDT, FUND_WHSK and FUND_WETH, then deposit.
bun run fund:testnet

# Give the wallet that will swap some test tokens. Only the owner can mint.
cast send "$USDT_ADDRESS" "mint(address,uint256)" <taker> <raw amount> \
  --rpc-url hsk_testnet --account "$FOUNDRY_ACCOUNT"
```

The package scripts load `.env` themselves, because Bun doesn't pass it to them. Without Bun in the
shell, load it with `set -a; source .env; set +a` and run the `forge script` command from the
matching entry in `package.json`. Don't run `bun install` from WSL in a folder Windows also uses,
because `node_modules` holds platform-specific binaries.

The EVM target is `cancun`, because OpenZeppelin 5.7 uses `MCOPY`. HSK mainnet and testnet both
execute `PUSH0`, `MCOPY`, `TLOAD` and `TSTORE`. Testnet's explorer is
`https://testnet-explorer.hskchain.net`.

## Before mainnet

- [x] `forge build` and `forge test` pass against real OpenZeppelin 5.7, forge-std and solc 0.8.24.
- [x] `forge fmt --check` passes.
- [ ] Token addresses and decimals confirmed on-chain. `constants.ts` marks them unconfirmed.
- [ ] Independent audit.
- [ ] Decide whether a rolling volume limit is needed for the signer-key risk above.
- [ ] Owner is a hardware wallet or multisig. Signer and executor are separate hot keys.
- [ ] Full flow rehearsed on testnet: deposit, fill, pause, unpause, withdraw, key rotation.
- [ ] Engine live mode built. It only signs paper quotes today, so it can't sign for this vault.
- [ ] Monitoring and a pause runbook in place. Start with small caps and small inventory.
