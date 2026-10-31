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
script/
  Deploy.s.sol                  Deploys the vault and configures its routes
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

`arbSwap` isn't built. The HSKSwap router has not been confirmed on-chain, and `SwapRouter` and
`SwapRouter02` have different swap structs. Add its interface and the function once it is.

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

## Before mainnet

- [ ] `forge build` and `forge test` pass against real OpenZeppelin 5.7, forge-std and solc 0.8.24.
- [ ] `forge fmt --check` passes.
- [ ] Token addresses and decimals confirmed on-chain. `constants.ts` marks them unconfirmed.
- [ ] Independent audit.
- [ ] Decide whether a rolling volume limit is needed for the signer-key risk above.
- [ ] Owner is a hardware wallet or multisig. Signer and executor are separate hot keys.
- [ ] Full flow rehearsed on testnet: deposit, fill, pause, unpause, withdraw, key rotation.
- [ ] Engine live mode built. It only signs paper quotes today, so it can't sign for this vault.
- [ ] Monitoring and a pause runbook in place. Start with small caps and small inventory.
