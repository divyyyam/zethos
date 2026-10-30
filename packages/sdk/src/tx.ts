import { type Address, erc20Abi, type PublicClient } from "viem";
import { vaultAbi } from "./abi.js";
import type { VaultQuote } from "./types.js";
import { toContractQuote } from "./verify.js";

/**
 * Live mode only. Builds unsigned call requests for `walletClient.writeContract`:
 * an exact-amount `approve` when the allowance is short, then the vault `fill`.
 * `fill` is simulated only when no approval is pending, since it would revert before it.
 */

export async function buildFillCalls(
  publicClient: PublicClient,
  { vault, quote, account }: { vault: Address; quote: VaultQuote; account: Address },
) {
  const signed = toContractQuote(quote.quote);
  const fill = {
    address: vault,
    abi: vaultAbi,
    functionName: "fill",
    args: [signed, quote.signature],
    account,
  } as const;
  const allowance = await publicClient.readContract({
    address: signed.tokenIn,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, vault],
  });
  if (allowance >= signed.amountIn) {
    await publicClient.simulateContract(fill);
    return { fill };
  }
  const approve = {
    address: signed.tokenIn,
    abi: erc20Abi,
    functionName: "approve",
    args: [vault, signed.amountIn],
    account,
  } as const;
  await publicClient.simulateContract(approve);
  return { approve, fill };
}

export type FillCalls = Awaited<ReturnType<typeof buildFillCalls>>;
