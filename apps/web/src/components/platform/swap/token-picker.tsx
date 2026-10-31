"use client";
import { Check, Search, ShieldCheck } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { type PlatformToken, platformTokens } from "../../../lib/platform-config";
import { Modal, TokenIcon } from "../primitives";

export function TokenPicker({
  open,
  selected,
  onSelect,
  onClose,
}: {
  open: boolean;
  selected: PlatformToken;
  onSelect: (token: PlatformToken) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const id = useId();
  useEffect(() => {
    if (open) setSearch("");
  }, [open]);
  const tokens = platformTokens.filter((token) =>
    `${token.symbol} ${token.label} ${token.name} ${token.address || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <Modal open={open} onClose={onClose} title="Choose a token" className="p-token-modal">
      <div className="p-token-picker">
        <h2>Select token</h2>
        <label className="p-search" htmlFor={id}>
          <Search size={17} aria-hidden />
          <input
            id={id}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or address"
            autoComplete="off"
          />
        </label>
        <div className="p-token-list">
          {tokens.map((token) => (
            <button
              type="button"
              key={token.symbol}
              onClick={() => {
                onSelect(token);
                onClose();
              }}
            >
              <TokenIcon symbol={token.symbol} />
              <span>
                <strong>{token.label}</strong>
                <small>{token.name}</small>
              </span>
              {selected.symbol === token.symbol ? (
                <Check size={17} className="p-success-text" aria-label="Selected" />
              ) : (
                <span className="p-token-network">HashKey</span>
              )}
            </button>
          ))}
          {tokens.length === 0 && (
            <p className="p-no-results">
              No matching asset. Zethos currently supports USDT, WHSK, and WETH.
            </p>
          )}
        </div>
        <p className="p-token-picker-note">
          <ShieldCheck size={14} aria-hidden />
          Only assets supported by the vault appear here.
        </p>
      </div>
    </Modal>
  );
}
