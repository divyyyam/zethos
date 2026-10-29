"use client";

import { ArrowRight, CornerDownLeft, LoaderCircle, Send, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { engine } from "../../lib/engine/client";
import { platformConfig, platformTokens, type TokenSymbol } from "../../lib/platform-config";
import { BrandMark, Modal } from "./primitives";

type FormQuote = { amount: string; from: TokenSymbol; to: TokenSymbol };
type Message = { id: number; role: "user" | "assistant"; text: string; quote?: FormQuote };
function symbol(value: string): TokenSymbol | null {
  const s = value.toUpperCase() === "HSK" ? "WHSK" : value.toUpperCase();
  return platformTokens.some((token) => token.symbol === s) ? (s as TokenSymbol) : null;
}
function parseForm(text: string): FormQuote | null {
  const match = text.match(
    /^swap\s+(\d+(?:\.\d+)?)\s+(USDT|WHSK|HSK|WETH)\s+(?:to|for|into)\s+(USDT|WHSK|HSK|WETH)\s*[.!]?$/i,
  );
  if (
    !match?.[1] ||
    !match[2] ||
    !match[3] ||
    Number(match[1]) <= 0 ||
    !Number.isFinite(Number(match[1]))
  )
    return null;
  const from = symbol(match[2]);
  const to = symbol(match[3]);
  return from && to && from !== to ? { amount: match[1], from, to } : null;
}
export function Assistant({
  open,
  onClose,
  onUseQuote,
}: {
  open: boolean;
  onClose: () => void;
  onUseQuote: (quote: FormQuote) => void;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const counter = useRef(0);
  const request = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const { address } = useAccount();
  const inputId = useId();
  useEffect(() => {
    if (!open) {
      request.current++;
      setPending(false);
    }
  }, [open]);
  useEffect(() => {
    if (open && messages.length > 0) end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, open]);
  const send = async (text: string) => {
    const content = text.trim();
    if (!content || pending) return;
    const current = ++request.current;
    setDraft("");
    setMessages((history) => [
      ...history.slice(-9),
      { id: ++counter.current, role: "user", text: content },
    ]);
    setPending(true);
    try {
      let reply: string;
      let form: FormQuote | null = null;
      if (!platformConfig.engineUrl) {
        form = parseForm(content);
        reply = form
          ? "I’ve prepared that pair and amount for your swap form. This is a form preview, not a live quote."
          : /approve|permission|key|safe|wallet/i.test(content)
            ? "Connecting a wallet doesn’t authorize spending. A live swap asks for approval of the exact input amount, then a separate confirmation to settle the signed quote."
            : /gas|network|hsk/i.test(content)
              ? "Swaps settle on HashKey Chain, where network fees are paid in native HSK. The swap form uses wrapped HSK (WHSK), so keep a little native HSK in your wallet for gas."
              : "Zethos is designed to price swaps from exchange order books and fill them from its on-chain vault. The live engine is still getting ready. For now, try “swap 100 USDT to WHSK” to prepare the form.";
      } else {
        const result = await engine.chat(
          content,
          address,
          messages.slice(-10).map((message) => ({ role: message.role, content: message.text })),
        );
        reply = result.reply;
        const quote = result.cards.find((card) => card.type === "quote");
        if (
          quote &&
          typeof quote.data.amountInHuman === "string" &&
          typeof quote.data.from === "string" &&
          typeof quote.data.to === "string"
        )
          form = parseForm(
            `swap ${quote.data.amountInHuman} ${quote.data.from} to ${quote.data.to}`,
          );
      }
      if (current === request.current)
        setMessages((history) => [
          ...history,
          {
            id: ++counter.current,
            role: "assistant",
            text: reply,
            ...(form ? { quote: form } : {}),
          },
        ]);
    } catch {
      if (current === request.current)
        setMessages((history) => [
          ...history,
          {
            id: ++counter.current,
            role: "assistant",
            text: "The assistant is taking a moment. You can still use the swap form directly. Please try again shortly.",
          },
        ]);
    } finally {
      if (current === request.current) setPending(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Ask Zethos" className="p-assistant-modal">
      <div className="p-assistant-content">
        <div className="p-assistant-heading">
          <span>
            <Sparkles size={22} strokeWidth={1.5} />
          </span>
          <div>
            <p className="p-eyebrow">A LITTLE CLARITY</p>
            <h2>Ask away.</h2>
          </div>
        </div>
        <p className="p-assistant-intro">
          {platformConfig.engineUrl
            ? "Your swap assistant, right here."
            : "Your product guide. Live market answers arrive with the engine."}
        </p>
        <div
          className="p-assistant-messages"
          role="log"
          aria-label="Conversation with Zethos"
          aria-live="polite"
        >
          {messages.length === 0 && (
            <div className="p-assistant-welcome">
              <BrandMark className="size-8" />
              <h3>
                Good swaps start
                <br />
                with a little understanding.
              </h3>
              <p>Ask how it works, or start with a pair and an amount.</p>
              <div>
                {[
                  "Swap 100 USDT to WHSK",
                  "What does my wallet approve?",
                  "How do network fees work?",
                ].map((prompt) => (
                  <button type="button" key={prompt} onClick={() => void send(prompt)}>
                    {prompt}
                    <ArrowRight size={13} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message) => (
            <div key={message.id} className={`p-chat-message ${message.role}`}>
              <small>{message.role === "user" ? "You" : "Zethos"}</small>
              <p>{message.text}</p>
              {message.quote && (
                <div className="p-chat-quote">
                  <span>
                    {message.quote.amount} {message.quote.from}
                    <ArrowRight size={13} />
                    {message.quote.to}
                  </span>
                  <button
                    type="button"
                    className="p-text-button"
                    onClick={() => {
                      if (message.quote) onUseQuote(message.quote);
                    }}
                  >
                    Use in swap form
                    <CornerDownLeft size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {pending && (
            <div className="p-chat-thinking">
              <LoaderCircle size={14} className="p-spin" />
              Thinking about your swap…
            </div>
          )}
          <div ref={end} />
        </div>
        <form
          className="p-assistant-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            Ask Zethos a question
          </label>
          <input
            id={inputId}
            value={draft}
            maxLength={1000}
            placeholder="A question, a pair, a new idea…"
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
          />
          <button type="submit" aria-label="Send message" disabled={pending || !draft.trim()}>
            <Send size={16} />
          </button>
        </form>
        <p className="p-assistant-note">Your wallet only opens when you choose to continue.</p>
      </div>
    </Modal>
  );
}
