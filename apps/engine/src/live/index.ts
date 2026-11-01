import { quoteDomain, quoteTypes, zethosVaultAbi } from "@zethos/shared";
import {
  type Address,
  erc20Abi,
  type Hex,
  hashTypedData,
  isAddressEqual,
  type LocalAccount,
  type PublicClient,
  parseAbiItem,
  zeroAddress,
} from "viem";
import { PAIRS, type Pair } from "../config";
import { contractQuote, type SignedQuote } from "../quotes";
import { type Inventory, PAIR_TOKENS, TOKEN_SYMBOLS, type Tokens } from "../tokens";

export interface LiveRoute {
  enabled: boolean;
  maxAmountIn: bigint;
}

export interface VaultSnapshot {
  readAt: number;
  owner: Address;
  quoteSigner: Address;
  executor: Address;
  paused: boolean;
  maxTtl: number;
  routes: Record<string, LiveRoute>;
  balances: Inventory;
}

/** Present only after `checkVault` passed. Without it the engine stays in shadow mode. */
export interface LiveVault {
  vault: Address;
  signer: LocalAccount;
  read: (now: number) => Promise<VaultSnapshot>;
  /** New `Fill` events since the previous call. */
  readFills?: () => Promise<VaultFillEvent[]>;
  initial: VaultSnapshot;
}

export interface VaultFillEvent {
  taker: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  nonce: bigint;
  txHash: Hex;
  logIndex: number;
  ts: number;
}

export interface VaultExpectation {
  vault: Address;
  chainId: number;
  owner: Address;
  quoteSigner: Address;
  executor: Address;
}

export function routeKey(tokenIn: string, tokenOut: string): string {
  return `${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}`;
}

export function vaultDomain(chainId: number, vault: Address) {
  return { ...quoteDomain, chainId, verifyingContract: vault };
}

export function signVaultQuote(
  signer: LocalAccount,
  chainId: number,
  vault: Address,
  quote: SignedQuote,
): Promise<Hex> {
  if (!signer.signTypedData) throw new Error("signer cannot sign typed data");
  return signer.signTypedData({
    domain: vaultDomain(chainId, vault),
    types: quoteTypes,
    primaryType: "Quote",
    message: contractQuote(quote),
  });
}

/** Reads everything live quoting depends on. Each call is one consistent view of the vault's state. */
export function vaultReader(
  client: PublicClient,
  vault: Address,
  tokens: Tokens,
  pairs: readonly Pair[] = PAIRS,
): (now: number) => Promise<VaultSnapshot> {
  const view = { address: vault, abi: zethosVaultAbi } as const;
  const directions = pairs.flatMap((pair) => {
    const base = tokens[PAIR_TOKENS[pair].base].address;
    const quote = tokens[PAIR_TOKENS[pair].quote].address;
    return [
      [quote, base],
      [base, quote],
    ] as const;
  });
  return async (now) => {
    const [owner, quoteSigner, executor, paused, maxTtl, routes, balances] = await Promise.all([
      client.readContract({ ...view, functionName: "owner" }),
      client.readContract({ ...view, functionName: "quoteSigner" }),
      client.readContract({ ...view, functionName: "executor" }),
      client.readContract({ ...view, functionName: "paused" }),
      client.readContract({ ...view, functionName: "maxTtl" }),
      Promise.all(
        directions.map(([tokenIn, tokenOut]) =>
          client.readContract({ ...view, functionName: "routeOf", args: [tokenIn, tokenOut] }),
        ),
      ),
      Promise.all(
        TOKEN_SYMBOLS.map((symbol) =>
          client.readContract({
            address: tokens[symbol].address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [vault],
          }),
        ),
      ),
    ]);
    return {
      readAt: now,
      owner,
      quoteSigner,
      executor,
      paused,
      maxTtl: Number(maxTtl),
      routes: Object.fromEntries(
        directions.map(([tokenIn, tokenOut], index) => {
          const route = routes[index];
          return [
            routeKey(tokenIn, tokenOut),
            { enabled: route?.enabled ?? false, maxAmountIn: route?.maxAmountIn ?? 0n },
          ];
        }),
      ),
      balances: Object.fromEntries(
        TOKEN_SYMBOLS.map((symbol, index) => [symbol, balances[index] ?? 0n]),
      ) as Inventory,
    };
  };
}

/**
 * Compares the vault with the configured keys. Any reason keeps the engine in shadow mode, so a
 * wrong deployment never gets a live signature. Read failures throw: unknown isn't a mismatch.
 */
export async function checkVault(
  client: Pick<PublicClient, "getCode" | "readContract">,
  read: (now: number) => Promise<VaultSnapshot>,
  expected: VaultExpectation,
  now: number,
): Promise<{ reasons: string[]; snapshot: VaultSnapshot | null }> {
  const code = await client.getCode({ address: expected.vault });
  if (!code || code === "0x")
    return { reasons: ["No vault bytecode at VAULT_ADDRESS"], snapshot: null };

  const snapshot = await read(now);
  const reasons: string[] = [];
  const mismatch = (name: string, actual: Address, wanted: Address) => {
    if (!isAddressEqual(actual, wanted))
      reasons.push(`vault.${name}() is ${actual}, not ${wanted}`);
  };
  mismatch("owner", snapshot.owner, expected.owner);
  mismatch("quoteSigner", snapshot.quoteSigner, expected.quoteSigner);
  mismatch("executor", snapshot.executor, expected.executor);
  if (snapshot.maxTtl <= 0) reasons.push("vault.maxTtl() is zero");

  // Proves the contract and this engine hash quotes identically before anything is signed for it.
  const probe = {
    taker: zeroAddress,
    tokenIn: zeroAddress,
    tokenOut: zeroAddress,
    amountIn: "1",
    amountOut: "1",
    nonce: "0",
    issuedAt: "0",
    expiry: "1",
  } satisfies SignedQuote;
  const onChain = await client.readContract({
    address: expected.vault,
    abi: zethosVaultAbi,
    functionName: "quoteDigest",
    args: [contractQuote(probe)],
  });
  const local = hashTypedData({
    domain: vaultDomain(expected.chainId, expected.vault),
    types: quoteTypes,
    primaryType: "Quote",
    message: contractQuote(probe),
  });
  if (onChain !== local)
    reasons.push("vault.quoteDigest() disagrees with the shared EIP-712 types");
  return { reasons, snapshot };
}

const FILL_EVENT = parseAbiItem(
  "event Fill(address indexed taker, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 nonce, uint256 poolOut)",
);
// About a day of 2 s blocks. The chain is the record, so a restart simply reads it again.
const FILL_LOOKBACK_BLOCKS = 43_200n;
const FILL_CHUNK_BLOCKS = 5_000n;
const FILL_CHUNKS_PER_READ = 3;

/** Walks forward through `Fill` logs. A failed read throws and retries from the same block. */
export function vaultFillReader(
  client: PublicClient,
  vault: Address,
): () => Promise<VaultFillEvent[]> {
  let next: bigint | null = null;
  return async () => {
    const head = await client.getBlockNumber();
    let from: bigint = next ?? (head > FILL_LOOKBACK_BLOCKS ? head - FILL_LOOKBACK_BLOCKS : 0n);
    const events: VaultFillEvent[] = [];
    for (let chunk = 0; chunk < FILL_CHUNKS_PER_READ && from <= head; chunk += 1) {
      const last = from + FILL_CHUNK_BLOCKS - 1n;
      const to = last < head ? last : head;
      const logs = await client.getLogs({
        address: vault,
        event: FILL_EVENT,
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        const { taker, tokenIn, tokenOut, amountIn, amountOut, nonce } = log.args;
        if (!taker || !tokenIn || !tokenOut || amountIn === undefined) continue;
        if (amountOut === undefined || nonce === undefined) continue;
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        events.push({
          taker,
          tokenIn,
          tokenOut,
          amountIn,
          amountOut,
          nonce,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          ts: Number(block.timestamp) * 1000,
        });
      }
      from = to + 1n;
      next = from;
    }
    return events;
  };
}
