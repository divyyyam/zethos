"use client";

import { useQueryClient } from "@tanstack/react-query";
import { zethosVaultAbi } from "@zethos/shared";
import { useRef, useState } from "react";
import { type Abi, erc20Abi, type Hash } from "viem";
import { usePublicClient } from "wagmi";
import { getAccount, getWalletClient } from "wagmi/actions";
import { useToast } from "../../components/platform/primitives";
import type { VaultQuote } from "../../lib/engine/types";
import { platformConfig } from "../../lib/platform-config";
import { wagmiConfig } from "../../lib/wagmi";

const vaultAbi: Abi = zethosVaultAbi;
export const settlementReady = Boolean(
  platformConfig.vaultAddress &&
    vaultAbi.some((entry) => entry.type === "function" && entry.name === "fill"),
);
export type SwapPhase =
  | "idle"
  | "preparing"
  | "approval"
  | "approval-pending"
  | "signature"
  | "pending"
  | "confirmed"
  | "error";
export const swapPhaseLabel: Record<SwapPhase, string> = {
  idle: "Confirm swap",
  preparing: "Checking your swap…",
  approval: "Approve in your wallet…",
  "approval-pending": "Confirming approval…",
  signature: "Confirm in your wallet…",
  pending: "Settling on-chain…",
  confirmed: "Swap complete",
  error: "Try again",
};

export function useSwapExecution() {
  const [phase, setPhase] = useState<SwapPhase>("idle");
  const [hash, setHash] = useState<Hash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const client = usePublicClient({ chainId: platformConfig.chain.id });
  const queryClient = useQueryClient();
  const notify = useToast();
  const busy = ["preparing", "approval", "approval-pending", "signature", "pending"].includes(
    phase,
  );
  const reset = () => {
    if (running.current) return;
    setPhase("idle");
    setError(null);
    setHash(null);
  };
  const execute = async (response: VaultQuote) => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setHash(null);
    setPhase("preparing");
    try {
      if (!settlementReady || !platformConfig.vaultAddress || !client)
        throw new Error("Live settlement is not available yet.");
      const assertAccount = () => {
        const account = getAccount(wagmiConfig);
        if (
          !account.address ||
          account.address.toLowerCase() !== response.quote.taker.toLowerCase()
        )
          throw new Error("Your wallet changed. Get a new quote before continuing.");
        if (account.chainId !== platformConfig.chain.id)
          throw new Error("Switch back to the configured HashKey network before continuing.");
        return account.address;
      };
      const assertFresh = () => {
        if (Number(response.quote.expiry) - Date.now() / 1000 < 5)
          throw new Error(
            "This quote is nearly expired. Close this review and refresh the price before continuing.",
          );
      };
      const address = assertAccount();
      assertFresh();
      const bytecode = await client.getBytecode({ address: platformConfig.vaultAddress });
      if (!bytecode || bytecode === "0x")
        throw new Error("The vault is not deployed on this network yet.");
      const wallet = await getWalletClient(wagmiConfig, { chainId: platformConfig.chain.id });
      const quote = {
        ...response.quote,
        amountIn: BigInt(response.quote.amountIn),
        amountOut: BigInt(response.quote.amountOut),
        nonce: BigInt(response.quote.nonce),
        issuedAt: BigInt(response.quote.issuedAt),
        expiry: BigInt(response.quote.expiry),
      };
      const allowance = await client.readContract({
        address: quote.tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, platformConfig.vaultAddress],
      });
      if (allowance < quote.amountIn) {
        assertAccount();
        assertFresh();
        setPhase("approval");
        const simulation = await client.simulateContract({
          account: address,
          address: quote.tokenIn,
          abi: erc20Abi,
          functionName: "approve",
          args: [platformConfig.vaultAddress, quote.amountIn],
        });
        assertAccount();
        const approval = await wallet.writeContract(simulation.request);
        setPhase("approval-pending");
        const receipt = await client.waitForTransactionReceipt({ hash: approval, timeout: 120000 });
        if (receipt.status !== "success")
          throw new Error("The token approval didn’t complete. No swap was submitted.");
      }
      assertAccount();
      assertFresh();
      const simulation = await client.simulateContract({
        account: address,
        address: platformConfig.vaultAddress,
        abi: vaultAbi,
        functionName: "fill",
        args: [quote, response.signature],
      });
      assertAccount();
      assertFresh();
      setPhase("signature");
      const transaction = await wallet.writeContract(simulation.request);
      setHash(transaction);
      setPhase("pending");
      notify({
        title: "Swap submitted",
        description: "Waiting for on-chain confirmation.",
        href: `${platformConfig.explorer}/tx/${transaction}`,
      });
      const receipt = await client.waitForTransactionReceipt({
        hash: transaction,
        timeout: 120000,
      });
      if (receipt.status !== "success")
        throw new Error("The swap reverted. Refresh the quote before trying again.");
      setPhase("confirmed");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["token-balance"] }),
        queryClient.invalidateQueries({ queryKey: ["engine", "fills"] }),
        queryClient.invalidateQueries({ queryKey: ["engine", "status"] }),
      ]);
      notify({
        title: "Your swap is complete",
        description: "Settled on HashKey Chain.",
        tone: "success",
        href: `${platformConfig.explorer}/tx/${transaction}`,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const readable = /rejected|denied|4001/i.test(message)
        ? "Transaction cancelled in your wallet. Nothing else will be submitted."
        : /QuoteExpired|WorseThanPool|NonceUsed/i.test(message)
          ? "The quote changed before settlement. Close this review and get a fresh price."
          : /insufficient funds/i.test(message)
            ? "Your wallet needs a little more HSK for network fees."
            : /timeout|timed out/i.test(message)
              ? "Confirmation is taking longer than expected. Check the transaction in the explorer before retrying."
              : message.length < 220
                ? message
                : "This transaction couldn’t be completed. Check your wallet and refresh the quote.";
      setError(readable);
      setPhase("error");
    } finally {
      running.current = false;
    }
  };
  return { phase, hash, error, busy, reset, execute };
}
