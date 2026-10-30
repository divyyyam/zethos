"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { QuoteRequest, SignedQuoteResponse } from "@zethos/sdk";
import { zethosVaultAbi } from "@zethos/shared";
import { useRef, useState } from "react";
import { type Abi, erc20Abi, formatUnits, type Hash, parseAbi } from "viem";
import { usePublicClient } from "wagmi";
import { getAccount, getWalletClient } from "wagmi/actions";
import { useToast } from "../../components/platform/primitives";
import { failureMessage, zethos } from "../../lib/engine/sdk";
import { toContractQuote, verifyQuoteSignature } from "../../lib/engine/verify-quote";
import { platformConfig } from "../../lib/platform-config";
import { wagmiConfig } from "../../lib/wagmi";

const vaultAbi: Abi = zethosVaultAbi;
const quoteChecksAbi = parseAbi([
  "function quoteSigner() view returns (address)",
  "function maxTtl() view returns (uint64)",
  "function isNonceUsed(address taker, uint256 nonce) view returns (bool)",
]);
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
  const execute = async (response: SignedQuoteResponse, request: QuoteRequest) => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setHash(null);
    setPhase("preparing");
    try {
      if (!zethos) throw new Error("The engine is not configured.");
      if (response.route === "paper") {
        const assertTaker = () => {
          const current = getAccount(wagmiConfig);
          if (
            !current.address ||
            current.address.toLowerCase() !== response.quote.taker.toLowerCase()
          )
            throw new Error("Your wallet changed. Get a new paper quote.");
        };
        assertTaker();
        const check = await zethos.verifyQuote(response, request, { minRemainingSec: 1 });
        if (!check.ok) throw new Error(`Quote verification failed: ${check.reasons.join(", ")}`);
        assertTaker();
        setPhase("pending");
        const fill = await zethos.paperFill(response, request);
        setPhase("confirmed");
        const status = await zethos.status().catch(() => null);
        const pair = status?.pairs.find((p) => p.pair === fill.pair);
        const received = pair ? (fill.side === "buy" ? pair.base : pair.quote) : null;
        notify({
          title: "Paper fill",
          description: received
            ? `Received ${formatUnits(BigInt(fill.amountOut), received.decimals)} ${received.symbol}. No funds moved.`
            : "Paper settlement complete. No funds moved.",
          tone: "success",
          href: `/arena#${fill.id}`,
        });
        await Promise.all(
          ["fills", "status", "arena", "arenaTakers"].map((key) =>
            queryClient.invalidateQueries({ queryKey: ["engine", key] }),
          ),
        );
        return;
      }
      if (!settlementReady || !platformConfig.vaultAddress || !client)
        throw new Error("Live settlement is not available yet.");
      const connectorUid = getAccount(wagmiConfig).connector?.uid;
      const assertAccount = () => {
        const account = getAccount(wagmiConfig);
        if (
          !account.address ||
          account.address.toLowerCase() !== response.quote.taker.toLowerCase() ||
          !connectorUid ||
          account.connector?.uid !== connectorUid
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
      const [signer, maxTtl] = await Promise.all([
        client.readContract({
          address: platformConfig.vaultAddress,
          abi: quoteChecksAbi,
          functionName: "quoteSigner",
        }),
        client.readContract({
          address: platformConfig.vaultAddress,
          abi: quoteChecksAbi,
          functionName: "maxTtl",
        }),
      ]);
      const quote = toContractQuote(response.quote);
      if (
        quote.expiry - quote.issuedAt > BigInt(maxTtl) ||
        !(await verifyQuoteSignature({
          quote: response.quote,
          signature: response.signature,
          signer,
          vault: platformConfig.vaultAddress,
          chainId: platformConfig.chain.id,
        }))
      )
        throw new Error(
          "The vault couldn’t verify this quote. Refresh the price before continuing.",
        );
      const nonceUsed = await client.readContract({
        address: platformConfig.vaultAddress,
        abi: quoteChecksAbi,
        functionName: "isNonceUsed",
        args: [quote.taker, quote.nonce],
      });
      if (nonceUsed)
        throw new Error("This quote has already been used. Refresh the price before continuing.");
      assertAccount();
      assertFresh();
      const wallet = await getWalletClient(wagmiConfig, { chainId: platformConfig.chain.id });
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
      const message = cause instanceof Error ? cause.message : failureMessage(cause);
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
