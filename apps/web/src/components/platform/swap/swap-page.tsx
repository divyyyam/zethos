"use client";

import { RecentSwaps } from "./recent-swaps";
import { SwapForm } from "./swap-form";
import { SwapPreferences } from "./swap-preferences";
import { SwapReview } from "./swap-review";
import { TokenPicker } from "./token-picker";
import { useSwapController } from "./use-swap-controller";

export function SwapPageContent() {
  const {
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
  } = useSwapController();

  return (
    <>
      <div className="p-swap-layout">
        <div className="p-swap-workspace">
          <SwapForm
            from={from}
            to={to}
            amount={amount}
            setAmount={setAmount}
            setPicker={setPicker}
            setSettings={setSettings}
            account={account}
            openWallet={openWallet}
            openNetwork={openNetwork}
            isShadow={isShadow}
            balance={balance}
            amountId={amountId}
            sample={sample}
            wrongNetwork={wrongNetwork}
            request={request}
            quote={quote}
            live={live}
            out={out}
            poolOut={poolOut}
            saving={saving}
            savingPct={savingPct}
            ttl={ttl}
            validAmount={validAmount}
            hasLowGas={hasLowGas}
            blocked={blocked}
            flip={flip}
            openReview={openReview}
            action={action}
            formNotice={formNotice}
          />
        </div>
      </div>
      <section className="p-recent-section" aria-labelledby="recent-swaps-title">
        <div className="p-card-header">
          <div>
            <h2 id="recent-swaps-title">Recent swaps</h2>
          </div>
        </div>
        <RecentSwaps />
      </section>
      <TokenPicker
        open={Boolean(picker)}
        selected={picker === "from" ? from : to}
        onSelect={chooseToken}
        onClose={() => setPicker(null)}
      />
      <SwapPreferences
        settings={settings}
        setSettings={setSettings}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
      />
      <SwapReview
        from={from}
        to={to}
        setAmount={setAmount}
        review={review}
        setReview={setReview}
        reviewedQuote={reviewedQuote}
        reviewedRequest={reviewedRequest}
        now={now}
        account={account}
        isShadow={isShadow}
        outputDecimals={outputDecimals}
        execution={execution}
        sample={sample}
        wrongNetwork={wrongNetwork}
        amountValue={amountValue}
        out={out}
      />
    </>
  );
}
