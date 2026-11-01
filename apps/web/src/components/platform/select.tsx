"use client";

import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

export type SelectOption<T extends string> = { value: T; label: string };

/**
 * The platform dropdown. Native option lists are drawn by the browser and can't be styled.
 * Follows the select-only combobox pattern: focus stays on the button, and arrows move the highlight.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  compact = false,
  placeholder = "Loading…",
}: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  compact?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = () => {
    if (!options.length) return;
    setActive(Math.max(selected, 0));
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    setOpen(false);
  };

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    const last = options.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(active + 1, last),
      ArrowUp: Math.max(active - 1, 0),
      Home: 0,
      End: last,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      setActive(move);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={`p-select${compact ? " p-select-compact" : ""}`} ref={root}>
      <button
        type="button"
        role="combobox"
        className="p-select-button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled || !options.length}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span>{options[selected]?.label ?? placeholder}</span>
        <ChevronDown size={compact ? 14 : 16} aria-hidden />
      </button>
      {open && (
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={ariaLabel}
          className="p-select-list"
        >
          {options.map((option, index) => (
            // Keyboard handling lives on the combobox button, which keeps focus.
            // biome-ignore lint/a11y/useKeyWithClickEvents: see above
            <div
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === selected}
              data-active={index === active}
              className="p-select-option"
              onPointerDown={(event) => event.preventDefault()}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {index === selected && <Check size={14} aria-hidden />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
