import type { Fill, Pair, VaultQuote } from "@zethos/sdk";
import { zethosVaultAbi } from "@zethos/shared";
import { type Abi, erc20Abi, parseAbi } from "viem";
import { getAccount, getPublicClient, getWalletClient } from "wagmi/actions";
import { platformConfig } from "../platform-config";
import { wagmiConfig } from "../wagmi";
import { retryWhileAllowanceLags } from "./stale-read";
import { toContractQuote } from "./verify-quote";

const vaultAbi: Abi = zethosVaultAbi;
const nonceAbi = parseAbi([
  "function isNonceUsed(address taker, uint256 nonce) view returns (bool)",
]);

/**
 * Settles a verified vault quote from the connected wallet: an exact approval if one is needed,
 * then `fill`. Used by the agent. The caller has already verified the quote and its limits.
 */
export async function settleOnChain(
  response: VaultQuote,
  trade: {
    pair: Pair;
    side: "buy" | "sell";
    price: number;
    flow?: "user" | "agent";
    onProgress?: (message: string) => void;
  },
): Promise<Fill> {
  const vault = platformConfig.vaultAddress;
  if (!vault) throw new Error("The vault address isn’t configured.");
  const chainId = platformConfig.chain.id;
  const quote = toContractQuote(response.quote);
  const assertWallet = () => {
    const account = getAccount(wagmiConfig);
    if (!account.address || account.address.toLowerCase() !== quote.taker.toLowerCase())
      throw new Error("Connect the wallet this quote was priced for.");
    if (account.chainId !== chainId)
      throw new Error(`Switch your wallet to ${platformConfig.chain.name}.`);
    return account.address;
  };
  const assertFresh = () => {
    if (Date.now() >= Number(quote.expiry) * 1000)
      throw new Error("The quote expired before settlement, so nothing filled.");
  };
  const address = assertWallet();
  assertFresh();
  const client = getPublicClient(wagmiConfig, { chainId });
  if (!client) throw new Error("The network client isn’t available.");
  const used = await client.readContract({
    address: vault,
    abi: nonceAbi,
    functionName: "isNonceUsed",
    args: [quote.taker, quote.nonce],
  });
  if (used) throw new Error("This quote has already been used.");
  const wallet = await getWalletClient(wagmiConfig, { chainId });
  const allowance = await client.readContract({
    address: quote.tokenIn,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address, vault],
  });
  if (allowance < quote.amountIn) {
    const approval = await client.simulateContract({
      account: address,
      address: quote.tokenIn,
      abi: erc20Abi,
      functionName: "approve",
      args: [vault, quote.amountIn],
    });
    assertWallet();
    trade.onProgress?.("Approve token spending in your wallet…");
    const hash = await wallet.writeContract(approval.request);
    trade.onProgress?.("Waiting for token approval confirmation…");
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 });
    if (receipt.status !== "success")
      throw new Error("The token approval didn’t complete. No swap was submitted.");
  }
  assertWallet();
  assertFresh();
  const simulation = await retryWhileAllowanceLags(
    () =>
      client.simulateContract({
        account: address,
        address: vault,
        abi: vaultAbi,
        functionName: "fill",
        args: [quote, response.signature],
      }),
    { beforeRetry: assertFresh },
  );
  assertWallet();
  assertFresh();
  trade.onProgress?.("Confirm the vault fill in your wallet…");
  const hash = await wallet.writeContract(simulation.request);
  trade.onProgress?.("Waiting for vault fill confirmation…");
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 });
  if (receipt.status !== "success")
    throw new Error("The swap reverted, so your tokens didn’t move.");
  return {
    id: `onchain-${hash}`,
    quoteId: response.id,
    policyId: "v0",
    ts: Date.now(),
    taker: address,
    pair: trade.pair,
    side: trade.side,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: response.quote.amountIn,
    amountOut: response.quote.amountOut,
    price: trade.price,
    midAtFill: response.breakdown.mid,
    flow: trade.flow ?? "agent",
    paper: false,
    txHash: hash,
  };
}
