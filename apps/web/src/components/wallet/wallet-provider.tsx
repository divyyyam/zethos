"use client";

import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  ExternalLink as ExternalIcon,
  Fingerprint,
  LoaderCircle,
  LogOut,
  Monitor,
  QrCode,
  ShieldCheck,
  Smartphone,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import encodeQR from "qr";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatUnits } from "viem";
import {
  type Connector,
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { platformConfig, shortAddress } from "../../lib/platform-config";
import { BrandMark, Modal, StatusDot, TokenIcon, useToast } from "../platform/primitives";

interface WalletContextValue {
  openWallet: () => void;
  openNetwork: () => void;
  closeWallet: () => void;
}
const WalletContext = createContext<WalletContextValue | null>(null);
export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet requires WalletProvider");
  return value;
}

export function walletError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  if (/rejected|denied|4001/i.test(value))
    return "Connection declined. You can try again whenever you’re ready.";
  if (/already pending|-32002/i.test(value))
    return "Your wallet is already waiting for a response. Open it to continue.";
  if (/not found|not installed|ProviderNotFound/i.test(value))
    return "This wallet isn’t available in your browser. Install it or choose another wallet.";
  if (/switch|chain|4902/i.test(value))
    return "Your wallet couldn’t change networks. Open it and try again.";
  return "We couldn’t connect this wallet. Check your wallet and try again.";
}
const walletBrands = [
  {
    name: "MetaMask",
    icon: "/wallets/metamask.svg",
    match: /metamask/i,
    href: "https://metamask.io/download",
  },
  { name: "Rabby", icon: "/wallets/rabby.svg", match: /rabby/i, href: "https://rabby.io/" },
  {
    name: "Coinbase Wallet",
    icon: "/wallets/coinbase.svg",
    match: /coinbase|base account/i,
    href: "https://www.coinbase.com/wallet/downloads",
  },
  { name: "Rainbow", icon: "/wallets/rainbow.svg", match: /rainbow/i, href: "https://rainbow.me/" },
];

type PairingProvider = {
  on: (event: "display_uri", listener: (uri: string) => void) => unknown;
  removeListener?: (event: "display_uri", listener: (uri: string) => void) => unknown;
  disconnect?: () => Promise<void>;
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [tab, setTab] = useState<"wallets" | "mobile">("wallets");
  const [available, setAvailable] = useState<Connector[]>([]);
  const [pending, setPending] = useState<Connector | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const attempt = useRef(0);
  const tabsId = useId();
  const pairing = useRef<PairingProvider | null>(null);
  const cleanupPairing = useRef<(() => void) | null>(null);
  const account = useAccount();
  const { connectors, connectAsync, reset } = useConnect();
  const { disconnectAsync, isPending: disconnecting } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const notify = useToast();
  const native = useBalance({
    ...(account.address ? { address: account.address } : {}),
    chainId: platformConfig.chain.id,
    query: { enabled: Boolean(account.address), refetchInterval: 20000 },
  });
  const walletConnect = connectors.find((connector) => connector.id === "walletConnect");
  const qr = useMemo(
    () => (uri ? encodeQR(uri, "data-url", { ecc: "medium", border: 4, scale: 5 }) : null),
    [uri],
  );
  useEffect(() => {
    let cancelled = false;
    const candidates = connectors.filter((connector) => connector.id !== "walletConnect");
    void Promise.all(
      candidates.map(async (connector) => ({
        connector,
        provider: await connector.getProvider().catch(() => undefined),
      })),
    ).then((result) => {
      if (cancelled) return;
      const detected = result.filter((item) => item.provider).map((item) => item.connector);
      setAvailable(
        detected.some((connector) => connector.id !== "injected")
          ? detected.filter((connector) => connector.id !== "injected")
          : detected,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [connectors]);
  useEffect(
    () => () => {
      cleanupPairing.current?.();
    },
    [],
  );
  const closeWallet = useCallback(() => {
    attempt.current++;
    cleanupPairing.current?.();
    cleanupPairing.current = null;
    if (pairing.current && pending) void pairing.current.disconnect?.().catch(() => undefined);
    pairing.current = null;
    setOpen(false);
    setPending(null);
    setUri(null);
    setError(null);
    reset();
  }, [pending, reset]);
  const openWallet = useCallback(() => {
    setError(null);
    setTab("wallets");
    setOpen(true);
  }, []);
  const connectWallet = async (connector: Connector) => {
    if (pending) return;
    const current = ++attempt.current;
    setError(null);
    setUri(null);
    setPending(connector);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (connector.id === "walletConnect") {
        const provider = await connector.getProvider();
        if (
          provider &&
          typeof provider === "object" &&
          "on" in provider &&
          typeof provider.on === "function"
        ) {
          const p = provider as PairingProvider;
          pairing.current = p;
          const onUri = (value: string) => {
            if (current === attempt.current) setUri(value);
          };
          p.on("display_uri", onUri);
          cleanupPairing.current = () => p.removeListener?.("display_uri", onUri);
        }
      }
      timeout = setTimeout(() => {
        if (current === attempt.current)
          setError(
            "Still waiting for your wallet. Open it to approve the connection, or go back to try another wallet.",
          );
      }, 30000);
      await connectAsync({ connector });
      if (current !== attempt.current) {
        await disconnectAsync({ connector });
        return;
      }
      cleanupPairing.current?.();
      cleanupPairing.current = null;
      pairing.current = null;
      setPending(null);
      setOpen(false);
      setUri(null);
      notify({
        title: "You’re connected",
        description: `${connector.name} is ready. Your keys stay with you.`,
        tone: "success",
      });
    } catch (cause) {
      if (current === attempt.current) {
        cleanupPairing.current?.();
        cleanupPairing.current = null;
        pairing.current = null;
        setError(walletError(cause));
        setPending(null);
        setUri(null);
      }
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
  const changeNetwork = async () => {
    setError(null);
    try {
      try {
        await switchChainAsync({ chainId: platformConfig.chain.id });
      } catch (cause) {
        // EIP-3085 does not require wallets to switch immediately after adding a chain.
        // Wagmi v2 reports this specific case as a rejection; retry the now-known chain.
        if (
          cause instanceof Error &&
          cause.message.includes("User rejected switch after adding network")
        ) {
          await switchChainAsync({ chainId: platformConfig.chain.id });
        } else throw cause;
      }
      notify({
        title: "You’re on the right network",
        description: platformConfig.chain.name,
        tone: "success",
      });
      setNetworkOpen(false);
    } catch (cause) {
      setError(
        /rejected|denied|4001/i.test(cause instanceof Error ? cause.message : String(cause))
          ? "The network hasn’t changed. Try again, or select HashKey Chain in your wallet."
          : "Your wallet couldn’t change networks. Open it and try again.",
      );
    }
  };
  const copyAddress = async () => {
    if (!account.address) return;
    try {
      await navigator.clipboard.writeText(account.address);
      setCopied(true);
      notify({ title: "Wallet address copied", tone: "success" });
    } catch {
      notify({
        title: "Couldn’t copy the address",
        description: "You can copy the full address shown in your wallet.",
        tone: "error",
      });
    }
  };
  const wrongNetwork = account.isConnected && account.chainId !== platformConfig.chain.id;
  return (
    <WalletContext.Provider
      value={{
        openWallet,
        openNetwork: () => {
          setError(null);
          setNetworkOpen(true);
        },
        closeWallet,
      }}
    >
      {children}
      <Modal
        open={open}
        onClose={closeWallet}
        title={account.isConnected ? "Your connected wallet" : "Connect your wallet"}
        className={account.isConnected ? "p-account-modal" : "p-wallet-modal"}
      >
        {account.isConnected ? (
          <div className="p-account-content">
            <div className="p-account-avatar">
              <Fingerprint size={40} strokeWidth={1.3} aria-hidden />
            </div>
            <p className="p-eyebrow">YOUR CORNER OF ZETHOS</p>
            <h2>{shortAddress(account.address || "")}</h2>
            <p className="p-wallet-connector">
              <StatusDot tone={wrongNetwork ? "warning" : "success"} />
              Connected with {account.connector?.name || "your wallet"}
            </p>
            <div className="p-account-balance">
              <span>Available for gas</span>
              <strong>
                {native.isError
                  ? "Unavailable"
                  : native.data
                    ? `${Number(formatUnits(native.data.value, native.data.decimals)).toLocaleString("en-US", { maximumFractionDigits: 5 })} HSK`
                    : "—"}
              </strong>
              <small>{platformConfig.chain.name}</small>
            </div>
            {wrongNetwork && (
              <div className="p-inline-notice">
                <p>Your wallet is on a different network.</p>
                <button
                  className="p-text-button"
                  type="button"
                  onClick={changeNetwork}
                  disabled={switching}
                >
                  {switching ? "Switching…" : `Switch to ${platformConfig.chain.name}`}
                  <ArrowUpRight size={14} aria-hidden />
                </button>
              </div>
            )}
            <div className="p-account-actions">
              <button type="button" onClick={copyAddress}>
                <span>{copied ? <CheckCheck size={18} /> : <Copy size={18} />}</span>
                {copied ? "Copied" : "Copy address"}
              </button>
              <a
                href={`${platformConfig.explorer}/address/${account.address}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                <span>
                  <ExternalIcon size={18} />
                </span>
                View explorer
              </a>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await disconnectAsync();
                    closeWallet();
                    notify({ title: "Wallet disconnected" });
                  } catch {
                    notify({ title: "Couldn’t disconnect. Try again.", tone: "error" });
                  }
                }}
                disabled={disconnecting}
              >
                <span>
                  <LogOut size={18} />
                </span>
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
            {error && (
              <p className="p-form-error" role="alert">
                {error}
              </p>
            )}
            <p className="p-wallet-footnote">
              <ShieldCheck size={14} aria-hidden />
              You’re in control of every transaction.
            </p>
          </div>
        ) : (
          <>
            <aside className="p-wallet-story" aria-hidden="true">
              <div className="p-wallet-story-brand">
                <BrandMark className="size-6" />
                <span>zethos</span>
              </div>
              <div className="p-wallet-art">
                <div className="p-orbit p-orbit-one" />
                <div className="p-orbit p-orbit-two" />
                <div className="p-wallet-art-card">
                  <Fingerprint size={27} strokeWidth={1.3} />
                  <div className="p-wallet-art-line" />
                  <div className="p-wallet-art-line short" />
                  <div className="p-wallet-art-chip">
                    <Check size={12} />
                    All yours.
                  </div>
                </div>
                <div className="p-wallet-art-token one">
                  <TokenIcon symbol="WHSK" />
                </div>
                <div className="p-wallet-art-token two">
                  <TokenIcon symbol="USDT" />
                </div>
                <div className="p-wallet-art-spark" />
              </div>
              <h3>
                Your wallet.
                <br />
                Your way.
              </h3>
              <p>
                A little connection.
                <br />A better way to swap.
              </p>
              <div className="p-wallet-story-bottom">
                <ShieldCheck size={15} />
                Your keys never leave your wallet.
              </div>
            </aside>
            <div className="p-wallet-content">
              {pending && tab === "wallets" ? (
                <div className="p-wallet-pending">
                  <button
                    type="button"
                    className="p-text-button"
                    onClick={() => {
                      attempt.current++;
                      setPending(null);
                      setError(null);
                      reset();
                    }}
                  >
                    <ArrowLeft size={15} />
                    Back to wallets
                  </button>
                  <div className="p-connection-animation">
                    <Wallet size={36} strokeWidth={1.3} />
                    <span>
                      <LoaderCircle size={19} className="p-spin" />
                    </span>
                  </div>
                  <h2>
                    A little hello
                    <br />
                    from your wallet.
                  </h2>
                  <p>Open {pending.name} and approve the connection. Nothing will be spent.</p>
                  <span className="p-waiting-label">
                    <span />
                    Waiting for your wallet
                  </span>
                  {error && (
                    <p className="p-form-error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <p className="p-eyebrow">LET’S GET YOU SETTLED</p>
                  <h2>
                    Make yourself
                    <br />
                    at home.
                  </h2>
                  <p className="p-wallet-sub">Connect your wallet to continue on HashKey Chain.</p>
                  <div
                    className="p-wallet-tabs"
                    role="tablist"
                    aria-label="Connection method"
                    onKeyDown={(event) => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      const next =
                        event.key === "Home"
                          ? "wallets"
                          : event.key === "End"
                            ? "mobile"
                            : tab === "wallets"
                              ? "mobile"
                              : "wallets";
                      setTab(next);
                      document.getElementById(`${tabsId}-${next}`)?.focus();
                    }}
                  >
                    <button
                      type="button"
                      role="tab"
                      id={`${tabsId}-wallets`}
                      aria-controls={`${tabsId}-panel`}
                      tabIndex={tab === "wallets" ? 0 : -1}
                      aria-selected={tab === "wallets"}
                      onClick={() => {
                        setTab("wallets");
                        setError(null);
                      }}
                    >
                      <Monitor size={14} aria-hidden />
                      Browser wallet
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id={`${tabsId}-mobile`}
                      aria-controls={`${tabsId}-panel`}
                      tabIndex={tab === "mobile" ? 0 : -1}
                      aria-selected={tab === "mobile"}
                      onClick={() => {
                        setTab("mobile");
                        setError(null);
                      }}
                    >
                      <QrCode size={14} aria-hidden />
                      Mobile wallet
                    </button>
                  </div>
                  {tab === "wallets" ? (
                    <div
                      className="p-wallet-list"
                      role="tabpanel"
                      id={`${tabsId}-panel`}
                      aria-labelledby={`${tabsId}-wallets`}
                    >
                      {available
                        .filter(
                          (connector) =>
                            !walletBrands.some((brand) => brand.match.test(connector.name)),
                        )
                        .map((connector) => (
                          <button
                            type="button"
                            key={connector.uid}
                            className="p-wallet-row"
                            onClick={() => void connectWallet(connector)}
                          >
                            <span className="p-wallet-logo">
                              {connector.icon ? (
                                <Image
                                  unoptimized
                                  src={connector.icon}
                                  alt=""
                                  width={28}
                                  height={28}
                                />
                              ) : (
                                <Wallet size={23} aria-hidden />
                              )}
                            </span>
                            <span>{connector.name}</span>
                            <small className="p-installed">Detected</small>
                            <ChevronRight size={15} aria-hidden />
                          </button>
                        ))}
                      {walletBrands.map((brand) => {
                        const connector = available.find((item) => brand.match.test(item.name));
                        const contents = (
                          <>
                            <span className="p-wallet-logo">
                              <Image unoptimized src={brand.icon} alt="" width={28} height={28} />
                            </span>
                            <span>{brand.name}</span>
                            {connector ? (
                              <small className="p-installed">Detected</small>
                            ) : (
                              <small>Get wallet</small>
                            )}
                            {connector ? (
                              <ChevronRight size={15} aria-hidden />
                            ) : (
                              <ArrowUpRight size={15} aria-hidden />
                            )}
                          </>
                        );
                        return connector ? (
                          <button
                            type="button"
                            className="p-wallet-row"
                            key={brand.name}
                            onClick={() => void connectWallet(connector)}
                          >
                            {contents}
                          </button>
                        ) : (
                          <a
                            className="p-wallet-row"
                            key={brand.name}
                            href={brand.href}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {contents}
                          </a>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className="p-mobile-pairing"
                      role="tabpanel"
                      id={`${tabsId}-panel`}
                      aria-labelledby={`${tabsId}-mobile`}
                    >
                      {qr ? (
                        <>
                          <div className="p-pairing-qr">
                            <Image
                              unoptimized
                              src={qr}
                              alt="Scan this QR code in your wallet to pair with Zethos"
                              width={220}
                              height={220}
                            />
                          </div>
                          <p>Scan with a WalletConnect-compatible wallet.</p>
                          <button
                            type="button"
                            className="p-text-button"
                            onClick={async () => {
                              if (!uri) return;
                              try {
                                await navigator.clipboard.writeText(uri);
                                notify({ title: "Pairing link copied", tone: "success" });
                              } catch {
                                notify({ title: "Couldn’t copy the pairing link", tone: "error" });
                              }
                            }}
                          >
                            Copy pairing link
                            <Copy size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="p-mobile-icon">
                            <Smartphone size={39} strokeWidth={1.2} />
                            <span>
                              <QrCode size={23} />
                            </span>
                          </div>
                          <h3>Your phone. Your wallet.</h3>
                          <p>
                            {walletConnect
                              ? "Pair a mobile wallet with a private, one-time QR code."
                              : "Open Zethos inside your mobile wallet’s browser to connect. QR pairing will be available soon."}
                          </p>
                          {walletConnect && (
                            <button
                              type="button"
                              className="p-button p-button-primary"
                              disabled={Boolean(pending)}
                              onClick={() => void connectWallet(walletConnect)}
                            >
                              {pending ? (
                                <>
                                  <LoaderCircle size={16} className="p-spin" />
                                  Creating a pairing code…
                                </>
                              ) : (
                                <>
                                  Pair mobile wallet
                                  <ArrowUpRight size={15} />
                                </>
                              )}
                            </button>
                          )}
                        </>
                      )}
                      {error && (
                        <p className="p-form-error" role="alert">
                          {error}
                        </p>
                      )}
                    </div>
                  )}
                  {error && tab === "wallets" && (
                    <p className="p-form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <p className="p-wallet-footnote">
                    <ShieldCheck size={14} aria-hidden />
                    Connecting never gives permission to spend.
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={networkOpen}
        onClose={() => setNetworkOpen(false)}
        title="Your network"
        className="p-network-modal"
      >
        <div className="p-network-content">
          <div className="p-network-symbol">
            <TokenIcon symbol="HSK" />
          </div>
          <p className="p-eyebrow">RIGHT HERE, ON-CHAIN</p>
          <h2>{platformConfig.chain.name}</h2>
          <p>Zethos quotes and settles swaps on this network.</p>
          <div className="p-network-details">
            <div>
              <span>Network</span>
              <strong>{platformConfig.chain.testnet ? "Testnet" : "Mainnet"}</strong>
            </div>
            <div>
              <span>Chain ID</span>
              <strong>{platformConfig.chain.id}</strong>
            </div>
            <div>
              <span>Gas token</span>
              <strong>HSK</strong>
            </div>
            <div>
              <span>Wallet status</span>
              <strong className={wrongNetwork ? "p-warning-text" : ""}>
                {account.isConnected
                  ? wrongNetwork
                    ? "Switch required"
                    : "Connected"
                  : "Not connected"}
              </strong>
            </div>
          </div>
          {wrongNetwork ? (
            <button
              type="button"
              className="p-button p-button-primary p-full"
              onClick={changeNetwork}
              disabled={switching}
            >
              {switching ? (
                <LoaderCircle size={16} className="p-spin" />
              ) : (
                <ArrowDownLeft size={16} />
              )}
              Switch network
            </button>
          ) : (
            <a
              href={platformConfig.explorer}
              className="p-button p-button-secondary p-full"
              target="_blank"
              rel="noreferrer noopener"
            >
              Explore HashKey Chain
              <ArrowUpRight size={15} />
            </a>
          )}
          {error && (
            <p className="p-form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </WalletContext.Provider>
  );
}

export function ConnectWalletButton({
  label = "Connect wallet",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  const { openWallet, openNetwork } = useWallet();
  const { address, isConnected, isReconnecting, chainId } = useAccount();
  const wrong = isConnected && chainId !== platformConfig.chain.id;
  return (
    <button
      type="button"
      className={`p-button ${isConnected && !wrong ? "p-button-account" : "p-button-primary"} ${className}`}
      onClick={wrong ? openNetwork : openWallet}
      disabled={isReconnecting}
    >
      {isReconnecting ? (
        <>
          <LoaderCircle size={15} className="p-spin" />
          Reconnecting
        </>
      ) : wrong ? (
        <>
          Switch network
          <ArrowUpRight size={14} />
        </>
      ) : isConnected && address ? (
        <>
          <span className="p-mini-avatar">
            <Fingerprint size={17} aria-hidden />
          </span>
          {shortAddress(address)}
          <ChevronRight size={14} aria-hidden />
        </>
      ) : (
        <>
          <Wallet size={15} aria-hidden />
          {label}
        </>
      )}
    </button>
  );
}
