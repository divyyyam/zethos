"use client";

import {
  Bot,
  CornerDownLeft,
  type LucideIcon,
  PanelLeft,
  Search,
  Sparkles,
  Square,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { agent, queueIntent } from "../../../hooks/platform/use-agent";
import { useEngineStatus } from "../../../hooks/platform/use-platform";
import { parseIntent } from "../../../lib/agent/intent";
import { useWallet } from "../../wallet/wallet-provider";
import { previewOf } from "../agent/command-bar";
import { NAV_ITEMS } from "./nav";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: LucideIcon;
  run: () => void;
}

const SUGGESTED = [
  "Buy 500 USDT of HSK",
  "Buy 2,000 USDT of HSK over 2 minutes",
  "Sell 0.1 ETH if it rises 0.5%",
  "Scan HSK depth",
  "My position",
];

/**
 * One keystroke to anywhere. A sentence the agent can read becomes the top result; running it only
 * drafts the mission, so authorization still happens on the agent page.
 */
export function CommandPalette({
  open,
  onClose,
  onToggleSidebar,
}: {
  open: boolean;
  onClose: () => void;
  onToggleSidebar: () => void;
}) {
  const router = useRouter();
  const status = useEngineStatus();
  const { openWallet } = useWallet();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      setText("");
      setIndex(0);
      input.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  const sendToAgent = (sentence: string) => {
    queueIntent(sentence);
    router.push("/agent");
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: sendToAgent only closes over the router.
  const items = useMemo(() => {
    const query = text.trim().toLowerCase();
    const parsed = parseIntent(text);
    const pages: Item[] = NAV_ITEMS.filter(
      (page) => page.href !== "/operator" || status.data?.operator !== null,
    ).map((page) => ({
      id: page.href,
      group: "Go to",
      label: page.label,
      hint: page.blurb,
      shortcut: `g ${page.key}`,
      icon: page.icon,
      run: () => router.push(page.href),
    }));
    const actions: Item[] = [
      {
        id: "sidebar",
        group: "Actions",
        label: "Toggle sidebar",
        shortcut: "[",
        icon: PanelLeft,
        run: onToggleSidebar,
      },
      { id: "wallet", group: "Actions", label: "Wallet", icon: Wallet, run: openWallet },
      {
        id: "stop",
        group: "Actions",
        label: "Stop all missions",
        hint: "Fills that already settled stay settled",
        icon: Square,
        run: () => void agent.stopAll(),
      },
    ];
    const suggestions: Item[] = SUGGESTED.map((sentence) => ({
      id: `s:${sentence}`,
      group: "Ask the agent",
      label: sentence,
      icon: Sparkles,
      run: () => sendToAgent(sentence),
    }));
    const matching = [...suggestions, ...pages, ...actions].filter(
      (item) =>
        !query || `${item.label} ${item.hint ?? ""} ${item.group}`.toLowerCase().includes(query),
    );
    if (query && parsed.intent.kind !== "unknown") {
      const preview = previewOf(text, parsed, status.data?.pairs ?? []);
      return [
        {
          id: "intent",
          group: "Agent",
          label: text.trim(),
          ...(preview ? { hint: preview.text } : {}),
          icon: Bot,
          run: () => sendToAgent(text.trim()),
        } satisfies Item,
        ...matching,
      ];
    }
    return matching;
  }, [text, status.data, router, onToggleSidebar, openWallet]);

  const active = Math.min(index, Math.max(0, items.length - 1));
  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };
  let lastGroup = "";
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a backdrop click; Esc is the keyboard equivalent.
    <dialog
      ref={dialog}
      className="d-palette"
      aria-label="Command palette"
      onClose={onClose}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="d-palette-box">
          <label className="d-palette-input">
            <Search size={18} aria-hidden />
            <span className="sr-only">Search or tell the agent</span>
            <input
              ref={input}
              value={text}
              placeholder="Buy 500 USDT of HSK, or jump to a page"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setText(event.target.value);
                setIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setIndex((active + 1) % Math.max(1, items.length));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setIndex((active - 1 + items.length) % Math.max(1, items.length));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(items[active]);
                }
              }}
            />
            <kbd>Esc</kbd>
          </label>
          <div className="d-palette-list" role="listbox" aria-label="Results">
            {items.length === 0 && (
              <p className="d-palette-empty">
                {parseIntent(text).intent.kind === "unknown" && text.trim()
                  ? (parseIntent(text).intent as { reason: string }).reason
                  : "Nothing matches."}
              </p>
            )}
            {items.map((item, position) => {
              const heading = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  {heading && <p className="d-palette-group">{heading}</p>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={position === active}
                    className="d-palette-item"
                    onPointerMove={() => setIndex(position)}
                    onClick={() => choose(item)}
                  >
                    <Icon size={16} aria-hidden />
                    <span className="d-palette-label">
                      {item.label}
                      {item.hint && <small>{item.hint}</small>}
                    </span>
                    {position === active ? (
                      <CornerDownLeft size={14} aria-hidden />
                    ) : (
                      item.shortcut && <kbd>{item.shortcut}</kbd>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </dialog>
  );
}
