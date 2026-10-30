"use client";

import type { PairStatus } from "@zethos/sdk";
import { ArrowUp, Check, CornerDownLeft, Plus } from "lucide-react";
import { forwardRef, useEffect, useMemo, useState } from "react";
import { completions, ghostOf, MODIFIERS, STARTERS } from "../../../lib/agent/completions";
import { parseIntent, type Span } from "../../../lib/agent/intent";
import { compilePlan, DEFAULT_MAX_COST_BPS, formatToken } from "../../../lib/agent/runtime";

function Highlight({ text, spans }: { text: string; spans: Span[] }) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: { key: number; text: string; role: string | null }[] = [];
  let cursor = 0;
  for (const span of sorted) {
    if (span.start < cursor) continue;
    if (span.start > cursor)
      parts.push({ key: cursor, text: text.slice(cursor, span.start), role: null });
    parts.push({ key: span.start, text: text.slice(span.start, span.end), role: span.role });
    cursor = span.end;
  }
  if (cursor < text.length) parts.push({ key: cursor, text: text.slice(cursor), role: null });
  return (
    <>
      {parts.map((part) => (
        <span key={part.key} data-role={part.role ?? undefined}>
          {part.text}
        </span>
      ))}
    </>
  );
}

export function previewOf(
  value: string,
  parsed: ReturnType<typeof parseIntent>,
  pairs: PairStatus[],
) {
  if (!value.trim()) return null;
  const { intent } = parsed;
  if (intent.kind === "unknown")
    return {
      text: "Send your request in English. I’ll prepare a quote or ask for the missing details.",
      bad: false,
    };
  if (intent.kind !== "swap") return { text: "Read only. Runs right away.", bad: false };
  const pair = pairs.find((row) => row.pair === intent.pair);
  if (!pair) return { text: "Waiting for the first market read.", bad: false };
  const plan = compilePlan(intent, pair);
  if (typeof plan === "string") return { text: plan, bad: true };
  const paying = formatToken(Number(plan.amountIn) / 10 ** plan.soldDecimals);
  return {
    bad: false,
    text: [
      `${plan.approximate ? "≈ " : ""}${paying} ${plan.soldSymbol} for ≈ ${formatToken(plan.estOut ?? 0)} ${plan.boughtSymbol}`,
      `limit ${plan.maxCostBps} bps`,
      ...(plan.sliceAmounts.length > 1 ? [`${plan.sliceAmounts.length} slices`] : []),
      ...(intent.trigger ? ["waits for its trigger"] : []),
      ...(intent.dryRun ? ["dry run"] : []),
    ].join(" · "),
  };
}

/**
 * The prompt. Wraps instead of clipping, finishes your sentence (Tab, or arrows and Enter), offers
 * clauses as one-click chips, and shows what the sentence compiles to before anything is sent.
 */
export const CommandBar = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (sentence?: string) => void;
    onEmptyEnter?: () => void;
    onEscape?: () => void;
    refusal?: string | null;
    disabled?: boolean;
    pairs: PairStatus[];
    hasDraft?: boolean;
    placeholder?: string;
    /** Compact form for places where the prompt is a launcher, not the whole page. */
    compact?: boolean;
  }
>(function CommandBar(
  {
    value,
    onChange,
    onSubmit,
    onEmptyEnter,
    onEscape,
    refusal = null,
    disabled = false,
    pairs,
    hasDraft = false,
    placeholder = "Tell Zethos what to do",
    compact = false,
  },
  ref,
) {
  const parsed = useMemo(() => parseIntent(value), [value]);
  const preview = useMemo(() => previewOf(value, parsed, pairs), [value, parsed, pairs]);
  const options = useMemo(() => completions(value), [value]);
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: every edit resets the suggestion list.
  useEffect(() => {
    setPicked(-1);
    setDismissed(false);
  }, [value]);
  const isSwap = parsed.intent.kind === "swap";
  // A finished swap has its clauses as chips, and the list would cover the estimate under the box.
  const canComplete = focused && !dismissed && options.length > 0;
  const showOptions = canComplete && !isSwap;
  const ghost = canComplete && picked < 0 ? ghostOf(value, options) : "";
  const valid = value.trim() !== "" && !preview?.bad;
  const message =
    disabled && value.trim()
      ? { text: "Understanding your request…", tone: "muted" }
      : refusal
        ? { text: refusal, tone: "bad" }
        : preview
          ? { text: preview.text, tone: preview.bad ? "bad" : valid ? "ok" : "muted" }
          : hasDraft
            ? { text: "Your draft is below. Enter authorizes it, Esc discards it.", tone: "muted" }
            : {
                text: `Quotes are read-only. Trades wait for authorization. Default cost limit ${DEFAULT_MAX_COST_BPS} bps.`,
                tone: "muted",
              };
  return (
    <div className={`a-composer-wrap ${compact ? "a-compact" : ""}`}>
      <form
        className="a-composer"
        data-focused={focused}
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onSubmit();
          else onEmptyEnter?.();
        }}
      >
        <div className="a-composer-field">
          <div className="a-composer-ink" aria-hidden>
            {value ? <Highlight text={value} spans={parsed.spans} /> : "​"}
            {ghost && <span className="a-ghost-text">{ghost}</span>}
            {ghost && <kbd className="a-tab-hint">Tab</kbd>}
          </div>
          <label htmlFor={compact ? "overview-intent" : "agent-command"} className="sr-only">
            Tell Zethos what to do
          </label>
          <textarea
            ref={ref}
            id={compact ? "overview-intent" : "agent-command"}
            value={value}
            rows={1}
            role="combobox"
            aria-expanded={showOptions}
            aria-controls="a-composer-options"
            aria-autocomplete="list"
            placeholder={hasDraft ? "Enter to authorize, or type something new" : placeholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={1000}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
            onKeyDown={(event) => {
              if (event.key === "Tab" && canComplete) {
                event.preventDefault();
                const next = options[Math.max(picked, 0)];
                if (next) onChange(next);
              } else if (event.key === "ArrowDown" && showOptions) {
                event.preventDefault();
                setPicked((picked + 1) % options.length);
              } else if (event.key === "ArrowUp" && showOptions) {
                event.preventDefault();
                setPicked(picked <= 0 ? options.length - 1 : picked - 1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                const chosen = showOptions && picked >= 0 ? options[picked] : undefined;
                if (chosen) onChange(chosen);
                else if (value.trim()) onSubmit();
                else onEmptyEnter?.();
              } else if (event.key === "Escape") {
                if (canComplete) setDismissed(true);
                else onEscape?.();
              }
            }}
          />
        </div>

        <div className="a-composer-foot">
          <div className="a-chips">
            {value.trim() === "" && !hasDraft
              ? STARTERS.map((starter) => (
                  <button
                    type="button"
                    key={starter}
                    data-cursor="hover"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onChange(starter)}
                  >
                    {starter}
                  </button>
                ))
              : isSwap
                ? MODIFIERS.map((modifier) => {
                    const on = modifier.test.test(value);
                    return (
                      <button
                        type="button"
                        key={modifier.label}
                        aria-pressed={on}
                        data-cursor="hover"
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() =>
                          onChange(on ? modifier.remove(value) : modifier.apply(value))
                        }
                      >
                        {on ? <Check size={12} aria-hidden /> : <Plus size={12} aria-hidden />}
                        {modifier.label}
                      </button>
                    );
                  })
                : null}
          </div>
          {hasDraft && !value ? (
            <button type="submit" className="a-send a-send-wide" data-cursor="hover">
              <CornerDownLeft aria-hidden size={15} />
              Authorize
            </button>
          ) : (
            <button
              type="submit"
              className="a-send"
              aria-label="Send to the agent"
              disabled={!value.trim() || !valid}
              data-cursor="hover"
            >
              <ArrowUp aria-hidden size={18} />
            </button>
          )}
        </div>

        {showOptions && (
          // Pressing an option must not blur the field before the click lands.
          <div
            id="a-composer-options"
            className="a-options"
            role="listbox"
            aria-label="Suggestions"
            onPointerDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => (
              <button
                type="button"
                key={option}
                role="option"
                aria-selected={picked === index}
                data-cursor="hover"
                onPointerMove={() => setPicked(index)}
                onClick={() => onChange(option)}
              >
                <span>{option}</span>
                {index === Math.max(picked, 0) && <kbd>Tab</kbd>}
              </button>
            ))}
          </div>
        )}
      </form>
      <p aria-live="polite" className="a-composer-note" data-tone={message.tone}>
        {message.text}
      </p>
    </div>
  );
});
