"use client";
import { useQuery } from "@tanstack/react-query";
import type { QuoteRequest, SignedQuoteResponse } from "@zethos/sdk";
import { useEffect, useId, useMemo, useState } from "react";
import { formatUnits, parseEther, parseUnits } from "viem";
import { useAccount, useBalance } from "wagmi";
import { useEngineStatus, useTokenBalance } from "../../../hooks/platform/use-platform";
import { useSwapExecution } from "../../../hooks/platform/use-swap-execution";
import { zethos } from "../../../lib/engine/sdk";
import { type PlatformToken, platformConfig, tokenBySymbol } from "../../../lib/platform-config";
import { useWallet } from "../../wallet/wallet-provider";

export function useSwapController() {
  const [from, setFrom] = useState(tokenBySymbol("USDT"));
  // The testnet vault holds real tWETH and almost no WHSK, with a 50 tUSDT cap per fill.
  const testnet = platformConfig.chain.id === 133;
  const [to, setTo] = useState(tokenBySymbol(testnet ? "WETH" : "WHSK"));
  const [amount, setAmount] = useState(testnet ? "25" : "1000");
  const [debouncedAmount, setDebouncedAmount] = useState(amount);
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [settings, setSettings] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [review, setReview] = useState(false);
  const [reviewedQuote, setReviewedQuote] = useState<SignedQuoteResponse | null>(null);
  const [reviewedRequest, setReviewedRequest] = useState<QuoteRequest | null>(null);
  const [now, setNow] = useState(0);
  const account = useAccount();
  const { openWallet, openNetwork } = useWallet();
  const status = useEngineStatus();
  const isShadow = status.data?.mode === "shadow";
  const inputToken = status.data?.pairs
    .flatMap((p) => [p.base, p.quote])
    .find((t) => t.symbol === from.symbol);
  const outputToken = status.data?.pairs
    .flatMap((p) => [p.base, p.quote])
    .find((t) => t.symbol === to.symbol);
  const balance = useTokenBalance(from, !isShadow);
  const outputBalance = useTokenBalance(to, !isShadow);
  const inputDecimals = isShadow ? inputToken?.decimals : balance.data?.decimals;
  const outputDecimals = isShadow ? outputToken?.decimals : outputBalance.data?.decimals;
  const execution = useSwapExecution();
  const native = useBalance({
    ...(account.address ? { address: account.address } : {}),
    chainId: platformConfig.chain.id,
    query: { enabled: Boolean(account.address && !isShadow), refetchInterval: 20000 },
  });
  const amountId = useId();
  const sample = !platformConfig.engineUrl;
  const wrongNetwork =
    !isShadow && account.isConnected && account.chainId !== platformConfig.chain.id;
  const amountValue = Number(debouncedAmount || "0");
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedAmount(amount), 400);
    return () => clearTimeout(timeout);
  }, [amount]);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      setAutoRefresh(localStorage.getItem("zethos.auto-refresh") !== "false");
    } catch {
      /* Preferences are optional. */
    }
  }, []);
  const inputValidation = useMemo(() => {
    if (
      inputDecimals === undefined ||
      !debouncedAmount ||
      !Number.isFinite(amountValue) ||
      amountValue <= 0
    )
      return { raw: 0n, error: null };
    if ((debouncedAmount.split(".")[1]?.length || 0) > inputDecimals)
      return {
        raw: 0n,
        error: `${from.label} supports up to ${inputDecimals} decimal places.`,
      };
    try {
      const raw = parseUnits(debouncedAmount, inputDecimals);
      return {
        raw,
        error:
          !sample && !isShadow && balance.data && raw > balance.data.value
            ? `Your ${from.label} balance is lower than this amount.`
            : null,
      };
    } catch {
      return { raw: 0n, error: "Enter a valid token amount." };
    }
  }, [balance.data, inputDecimals, debouncedAmount, amountValue, from.label, sample, isShadow]);
  const inputAddress = isShadow ? inputToken?.address : from.address;
  const outputAddress = isShadow ? outputToken?.address : to.address;
  const request: QuoteRequest | null =
    account.address &&
    inputAddress &&
    outputAddress &&
    inputValidation.raw > 0n &&
    !inputValidation.error &&
    !wrongNetwork &&
    outputDecimals !== undefined
      ? {
          taker: account.address,
          tokenIn: inputAddress,
          tokenOut: outputAddress,
          amountIn: inputValidation.raw.toString(),
        }
      : null;
  const quote = useQuery({
    queryKey: ["engine", "quote", platformConfig.chain.id, request],
    queryFn: async () => {
      if (!request || !zethos) throw new Error("Choose an amount and connect your wallet.");
      const response = await zethos.quote(request);
      if (response.route !== "hskswap") {
        const verified = await zethos.verifyQuote(response, request, {
          minRemainingSec: response.route === "paper" ? 1 : 5,
        });
        if (!verified.ok)
          throw new Error(`Quote verification failed: ${verified.reasons.join(", ")}`);
      }
      return response;
    },
    enabled: Boolean(request && !sample && status.data && !status.isError && !review),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data;
      return autoRefresh && !review && !execution.busy && data && data.route !== "hskswap"
        ? Math.max(1000, data.expiresAt * 1000 - Date.now() - 1000)
        : false;
    },
  });
  const sampleOut =
    Number.isFinite(amountValue) && amountValue > 0
      ? ((amountValue * from.samplePrice) / to.samplePrice) * 0.9992
      : 0;
  const live = !quote.isError && quote.data && quote.data.route !== "hskswap" ? quote.data : null;
  const out = sample
    ? sampleOut
    : !quote.isError && quote.data && outputDecimals !== undefined
      ? Number(
          formatUnits(
            BigInt(
              quote.data.route === "hskswap" ? quote.data.hskswapOut : quote.data.quote.amountOut,
            ),
            outputDecimals,
          ),
        )
      : null;
  const poolRaw = live ? (live.route === "paper" ? live.poolOut : live.hskswapOut) : null;
  const poolOut = sample
    ? ((amountValue * from.samplePrice) / to.samplePrice) * 0.978
    : poolRaw !== null && outputDecimals !== undefined
      ? Number(formatUnits(BigInt(poolRaw), outputDecimals))
      : null;
  const saving = out !== null && poolOut !== null ? Math.max(0, out - poolOut) : 0;
  const savingPct =
    (live?.route === "paper" ? live.savingVsPoolPct : live?.savingPct) ??
    (sample && poolOut && out ? (out / poolOut - 1) * 100 : 0);
  const ttl = live ? Math.max(0, Math.ceil(live.expiresAt - now / 1000)) : 0;
  const validAmount = Boolean(amountValue > 0 && Number.isFinite(amountValue));
  const hasLowGas =
    !isShadow && account.isConnected && native.data && native.data.value < parseEther("0.05");
  const inputChanged = amount !== debouncedAmount;
  const blocked =
    !validAmount ||
    Boolean(inputValidation.error) ||
    quote.isFetching ||
    inputChanged ||
    Boolean(status.data?.paused);
  const chooseToken = (token: PlatformToken) => {
    execution.reset();
    if (picker === "from") {
      if (token.symbol === to.symbol) setTo(from);
      setFrom(token);
    } else {
      if (token.symbol === from.symbol) setFrom(to);
      setTo(token);
    }
  };
  const flip = () => {
    setFrom(to);
    setTo(from);
    if (out && out > 0) setAmount(String(Number(out.toFixed(8))));
    execution.reset();
  };
  const openReview = () => {
    execution.reset();
    setReviewedQuote(live);
    setReviewedRequest(request);
    setReview(true);
  };
  let action = "Review swap";
  if (!account.isConnected) action = "Connect wallet to swap";
  else if (wrongNetwork) action = "Switch to HashKey Chain";
  else if (!validAmount) action = "Enter an amount";
  else if (status.data?.paused) action = "Vault is paused";
  else if (inputValidation.error)
    action = inputValidation.raw > 0n ? `Not enough ${from.label}` : "Check the amount";
  else if (sample) action = "View swap preview";
  else if (!from.address || !to.address) action = "This pair isn’t available yet";
  else if (!isShadow && (balance.isPending || outputBalance.isPending))
    action = "Reading your balances…";
  else if (!isShadow && (balance.isError || outputBalance.isError))
    action = "Token balance unavailable";
  else if (quote.isFetching || inputChanged) action = "Finding your price…";
  else if (quote.isError) action = "Try a fresh quote";
  else if (quote.data?.route === "hskswap") action = "On-chain venue has a better price";
  else if (live && ttl <= 0) action = "Refresh expired quote";
  const formNotice =
    inputValidation.error ||
    (!isShadow && balance.isError && account.isConnected
      ? "We couldn’t read this token balance. Check the network and try again."
      : null);
  return {
    from,
    to,
    amount,
    setAmount,
    picker,
    setPicker,
    settings,
    setSettings,
    autoRefresh,
    setAutoRefresh,
    review,
    setReview,
    reviewedQuote,
    reviewedRequest,
    now,
    account,
    openWallet,
    openNetwork,
    isShadow,
    balance,
    outputDecimals,
    execution,
    amountId,
    sample,
    wrongNetwork,
    amountValue,
    request,
    quote,
    live,
    out,
    poolOut,
    saving,
    savingPct,
    ttl,
    validAmount,
    hasLowGas,
    blocked,
    chooseToken,
    flip,
    openReview,
    action,
    formNotice,
  };
}
export type SwapPageContentState = ReturnType<typeof useSwapController>;
