# Zethos contracts

`ZethosVault` settles firm swap quotes signed off-chain, against its own inventory. The engine
proposes prices; this contract decides whether a trade is allowed. See the
[root guide](../../README.md) for how it fits into the product.

**Status: deployed and verified on HashKey Chain mainnet and testnet. Not independently audited.**
See [Deployment status](#deployment-status). I recommend testing against testnet first.

## Deployments

| Role | Mainnet (chain `177`) | Testnet (chain `133`) |
|------|-----------------------|-----------------------|
| `ZethosVault` | [`0x1e6c7fBCd245A1a4FA8aBaDf57dF1ECf2E1A2aAF`](https://hsk.blockscout.com/address/0x1e6c7fBCd245A1a4FA8aBaDf57dF1ECf2E1A2aAF) | [`0x8deB013d7A8f5f5C6C2d8fb12506fab506721d01`](https://testnet-explorer.hskchain.net/address/0x8deB013d7A8f5f5C6C2d8fb12506fab506721d01) |
| Source verification | Full match | Partial match |
| Owner | `0xBC569666b84A0B0aD99142c39C1A4d9cCAFB0996` | `0x369b982250D63D805849520d15f437B914BB2fe3` |
| Quote signer | `0x67892FFC34d33906ebE31f565cCb4f5d61fEFDe8` | `0x530b3D90cfB3e713b60140645528cB4CCcc6a972` |
| Executor | `0x962784AD07B15382d4bce03e6B9b2c0daA3f8B33` | `0x042208fF20630C91ddC7C10C77DE64224b0F2299` |
| Deploy transaction | [`0x4d52…a6d4`](https://hsk.blockscout.com/tx/0x4d528badf7ffcf92e79146ac15e185661555940826a57e40f6f23a9690cea6d4) | [`0xa88d…0250`](https://testnet-explorer.hskchain.net/tx/0xa88df321f36cd1d3df7c0314ee483f47b15107b580ece6f2e6cc3e44f7be0250) |
| Inventory | None | Test tokens |

| Token | Mainnet | Testnet |
|-------|---------|---------|
| USD stablecoin (6 decimals) | USDT `0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029` | tUSDT `0x1095085CAf22cEEa130f73a99234dd2C9216fb72` |
| Wrapped HSK (18 decimals) | WHSK `0xB210D2120d57b758EE163cFfb43e73728c471Cf1` | tWHSK `0x60786f25Ae5dEef658dd1Da2F62dd6e7c7674716` |
| Wrapped ETH (18 decimals) | WETH `0xefd4bC9afD210517803f293ABABd701CaeeCdfd0` | tWETH `0x6ab12f10d4f0ef5B3faae774abb724A958f5BD80` |

tUSDT, tWETH and tWHSK have no market value. Read token metadata and route caps from chain and
`/status`, not from this page. The testnet tWHSK is a separate token, not the chain's wrapped-native
predeploy, and its source is not verified on the explorer. `DeployTestTokens.s.sol` creates tUSDT and tWETH.

## On-chain test results

Run on the testnet vault on 2026-11-01. Each link opens the transaction on the explorer.

| Test | Result | Transaction |
|------|--------|-------------|
| Valid quote fills | Vault +20 tUSDT and -0.008 tWETH, taker the reverse | [`0x4821…5e15`](https://testnet-explorer.hskchain.net/tx/0x4821d2721148c60564721d6475f8c6b963a3eda5139626e902c5be98cb7c5e15) |
| Replay of the same quote | Reverted `NonceUsed` | [`0x68d9…9825`](https://testnet-explorer.hskchain.net/tx/0x68d90adc4cab9a957d1c55a529b4bd49900f26b689dbdd851624fdb375629825) |
| Expired quote | Reverted `QuoteExpired` | [`0x9967…dad2`](https://testnet-explorer.hskchain.net/tx/0x9967c71734266f4e9f0cd2c54374bf741134fd93a639881009f39e9718ecdad2) |
| Above the route cap | Reverted `SizeCapExceeded` | [`0x5612…ebf3`](https://testnet-explorer.hskchain.net/tx/0x5612bed0045565d13e93d6ef43a2492809d1a5285387e34f8e06cac27632ebf3) |
| Signed by a non-signer | Reverted `InvalidSignature` | [`0xb385…a394`](https://testnet-explorer.hskchain.net/tx/0xb3856d3aa31c63980de065e9c13f76c485d7d7539b29ed60df34545057dca394) |
| Executor pauses | `paused` is true | [`0x5446…710c`](https://testnet-explorer.hskchain.net/tx/0x544634e799bc237b3e30a08c00b1e53b01eda305246e0a795adc20d22e26710c) |
| Fill while paused | Reverted `EnforcedPause` | [`0x5131…dae4`](https://testnet-explorer.hskchain.net/tx/0x51313ee5cbfb1b92d2186790659004fbf04a6350cad73a525bfe4b07e8dedae4) |
| Executor tries to unpause | Reverted `OwnableUnauthorizedAccount` | [`0xac66…2a3f`](https://testnet-explorer.hskchain.net/tx/0xac66869f0b5d8bafe9a2b28e6fc90faf880ce3ed5c0028f34f37cb9e33982a3f) |
| Owner unpauses | `paused` is false | [`0x61a6…1222`](https://testnet-explorer.hskchain.net/tx/0x61a66490098040a36a75ddba30476fcc3c10cea4f1803d6f88f9d8e90cb21222) |
| Owner withdraws | Vault -1 tUSDT, owner +1 tUSDT | [`0x850a…3d25`](https://testnet-explorer.hskchain.net/tx/0x850a9e8a05f247aa60ace71276f1f80927a6c22356003ae7b3a447051bc93d25) |
| Non-owner tries to withdraw | Reverted `OwnableUnauthorizedAccount` | [`0xcd21…63fb`](https://testnet-explorer.hskchain.net/tx/0xcd215d8a68280fd4a5703e1a47e074086a34e0e577219ddee98d7a172b7a63fb) |

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
- **No native HSK.** The vault trades ERC-20 assets only: WHSK on mainnet and tWHSK on testnet.
- **Admin power is total.** The owner can withdraw everything at any time. Inventory belongs to the
  operator; third-party liquidity is out of scope.

Deliberately not included:

- **`arbSwap`.** The vault settles quotes only and does no pool arbitrage.
- **Pool protection on the deployed routes.** Routes set `pool = address(0)`, since no venue with
  real depth exists to compare against.
- **A rolling volume limit.** Per-fill caps and small inventory limit exposure instead.

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

Then deposit inventory, set `NEXT_PUBLIC_VAULT_ADDRESS` for the web app and verify the source. On
mainnet, `bun run deploy:mainnet:check` simulates the deployment and sends nothing.

## Testing on testnet

Live mode uses real on-chain fills on chain `133` with tokens labelled tUSDT, tWETH and tWHSK.

1. **Desk:** inspect the mandate and signed price, test refusals, then approve and fill from a real
   wallet. The result links to the explorer and refreshes both token balances.
2. **Agent:** draft and authorize a bounded trade, watch local verification and wallet approval/fill
   steps, then inspect the transaction and **My position**. Cost limits can refuse before any send.
3. **Arena:** attack paper inventory with local identities, no wallet and no token transfers.
   Separate real-vault rows come from watched `Fill` events; paper totals exclude them.

The browser stand-in check is `bun run --cwd apps/web browser:check` from the repo root. It declines
every `eth_sendTransaction`, blocks network broadcast methods and exits non-zero on a failed step.
It cannot verify successful settlement or changed balances; the owner records those with a real
wallet. The code's EVM target is `cancun`, using solc 0.8.24.

## Deployment status

| Item | State |
|------|-------|
| Build and tests | `forge build`, `forge test` and `forge fmt --check` pass on OpenZeppelin 5.7, forge-std and solc 0.8.24 |
| Mainnet vault | Deployed and fully verified, with no inventory |
| Mainnet tokens | Address, symbol and decimals confirmed on chain `177` |
| Mainnet caps | About $50 per fill on each of the 4 routes |
| Testnet vault | Deployed, verified and funded. Fill, pause, unpause and withdrawal confirmed on-chain |
| Engine settlement | On-chain on chain `133`. The engine's `CHAIN_ID=133` guard keeps mainnet on paper |
| Roles | Separate owner, signer and executor keys on each network, in encrypted keystores |
| Independent audit | Not performed |
