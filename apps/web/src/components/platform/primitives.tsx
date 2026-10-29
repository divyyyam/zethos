"use client";

import { Check, ChevronRight, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { TokenSymbol } from "../../lib/platform-config";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 32"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M11 5.5H28.5L22.5 13.5H5Z" />
      <path d="M9.5 18.5H27L21 26.5H3.5Z" />
    </svg>
  );
}
export function TokenIcon({
  symbol,
  className = "",
}: {
  symbol: TokenSymbol | "HSK";
  className?: string;
}) {
  return (
    <span aria-hidden className={`p-token p-token-${symbol.toLowerCase()} ${className}`}>
      {symbol === "USDT" ? (
        <svg aria-hidden viewBox="0 0 32 32" fill="currentColor">
          <path d="M8 7h16v4h-6v3c5 .2 8 1.1 8 2.3 0 1.3-3.8 2.4-8 2.5V26h-4v-7.2c-4.2-.1-8-1.2-8-2.5 0-1.2 3-2.1 8-2.3v-3H8V7Zm6 8.3c-3.2.1-5.6.5-5.6 1 0 .6 3.4 1.2 7.6 1.2s7.6-.6 7.6-1.2c0-.5-2.4-.9-5.6-1v1.3h-4v-1.3Z" />
        </svg>
      ) : symbol === "WETH" ? (
        <svg aria-hidden viewBox="0 0 32 32" fill="currentColor">
          <path d="m16 3 8 13-8 4.7L8 16 16 3Z" opacity=".85" />
          <path d="m16 29 8-11-8 4.7L8 18l8 11Z" />
        </svg>
      ) : (
        <svg aria-hidden viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.8">
          <path d="M9 6v20M23 6v20M6 12h20M6 20h20" />
        </svg>
      )}
    </span>
  );
}
export function StatusDot({ tone = "neutral" }: { tone?: "neutral" | "success" | "warning" }) {
  return <span aria-hidden className={`p-status-dot p-status-${tone}`} />;
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="p-eyebrow">{children}</p>;
}
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="p-empty">
      <div className="p-empty-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function ExternalLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={`p-text-link ${className}`}>
      {children}
      <ChevronRight size={14} aria-hidden />
    </a>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      {...(description ? { "aria-describedby": descriptionId } : {})}
      className={`p-modal ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <span id={titleId} className="sr-only">
        {title}
      </span>
      {description && (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      )}
      {open && children}
      <button
        type="button"
        className="p-modal-close p-icon-button"
        aria-label="Close dialog"
        onClick={onClose}
      >
        <X size={19} aria-hidden />
      </button>
    </dialog>
  );
}

type Toast = {
  id: number;
  title: string;
  description?: string;
  tone: "success" | "error" | "info";
  href?: string;
};
type ToastInput = Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] };
const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const id = useRef(0);
  const dismiss = useCallback(
    (toastId: number) => setToasts((current) => current.filter((toast) => toast.id !== toastId)),
    [],
  );
  const notify = useCallback(
    (input: ToastInput) => {
      const toastId = ++id.current;
      setToasts((current) => [
        ...current.slice(-2),
        { ...input, tone: input.tone || "info", id: toastId },
      ]);
      timers.current.push(setTimeout(() => dismiss(toastId), 6500));
    },
    [dismiss],
  );
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="p-toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`p-toast p-toast-${toast.tone}`}>
            <span className="p-toast-mark" aria-hidden>
              {toast.tone === "success" ? (
                <Check size={16} />
              ) : toast.tone === "error" ? (
                <X size={16} />
              ) : (
                <BrandMark className="size-4" />
              )}
            </span>
            <div>
              <strong>{toast.title}</strong>
              {toast.description && <p>{toast.description}</p>}
              {toast.href && <ExternalLink href={toast.href}>View transaction</ExternalLink>}
            </div>
            <button
              className="p-icon-button"
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(toast.id)}
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast requires ToastProvider");
  return context;
}
