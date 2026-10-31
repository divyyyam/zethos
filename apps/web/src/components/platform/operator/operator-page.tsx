"use client";
import {
  ArrowRight,
  ArrowUpRight,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useSignMessage } from "wagmi";
import { getAccount } from "wagmi/actions";
import { useEngineStatus, useVaultOwner } from "../../../hooks/platform/use-platform";
import { engineRequest, object } from "../../../lib/engine/client";
import { platformConfig, shortAddress } from "../../../lib/platform-config";
import { wagmiConfig } from "../../../lib/wagmi";
import { ConnectWalletButton, useWallet } from "../../wallet/wallet-provider";
import { OperatorDashboard } from "./operator-dashboard";

export function OperatorPageContent() {
  const account = useAccount();
  const status = useEngineStatus();
  const owner = useVaultOwner();
  const [preview, setPreview] = useState(false);
  const [actor, setActor] = useState<{ address: string; chain: number; expires: number } | null>(
    null,
  );
  const [phase, setPhase] = useState<"idle" | "nonce" | "signature" | "verification">("idle");
  const [error, setError] = useState<string | null>(null);
  const { signMessageAsync } = useSignMessage();
  const { openNetwork, openWallet } = useWallet();
  const authorized = Boolean(
    actor &&
      actor.address.toLowerCase() === account.address?.toLowerCase() &&
      actor.chain === account.chainId &&
      actor.expires > Date.now() &&
      owner.isOwner,
  );
  useEffect(() => {
    if (
      actor &&
      (actor.address.toLowerCase() !== account.address?.toLowerCase() ||
        actor.chain !== account.chainId)
    ) {
      setActor(null);
      setError(null);
    }
  }, [account.address, account.chainId, actor]);
  useEffect(() => {
    const timer = setInterval(() => {
      setActor((current) => (current && current.expires <= Date.now() ? null : current));
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  const signIn = async () => {
    const address = account.address;
    if (!address || !platformConfig.engineUrl || !owner.isOwner || phase !== "idle") return;
    const assertWallet = () => {
      const current = getAccount(wagmiConfig);
      if (
        current.address?.toLowerCase() !== address.toLowerCase() ||
        current.chainId !== platformConfig.chain.id
      )
        throw new Error("Your wallet or network changed. Please start sign-in again.");
    };
    setError(null);
    setPhase("nonce");
    try {
      assertWallet();
      const ownership = await owner.refetch();
      if (ownership.data?.toLowerCase() !== address.toLowerCase())
        throw new Error("This wallet is not the current vault owner.");
      const result = object(await engineRequest("/auth/nonce"));
      if (typeof result.nonce !== "string" || !/^[a-zA-Z0-9]{8,}$/.test(result.nonce))
        throw new Error("The sign-in service returned an invalid challenge.");
      assertWallet();
      const issuedAt = new Date();
      const message = createSiweMessage({
        address,
        chainId: platformConfig.chain.id,
        domain: window.location.host,
        uri: window.location.origin,
        version: "1",
        nonce: result.nonce,
        statement:
          "Sign in to the Zethos operator workspace. This does not authorize a transaction.",
        issuedAt,
        expirationTime: new Date(issuedAt.getTime() + 15 * 60000),
      });
      setPhase("signature");
      const signature = await signMessageAsync({ message });
      assertWallet();
      setPhase("verification");
      const session = object(
        await engineRequest("/auth/verify", {
          method: "POST",
          body: JSON.stringify({ message, signature }),
        }),
      );
      assertWallet();
      if (typeof session.expiresAt !== "number")
        throw new Error("The sign-in service returned an invalid session.");
      setActor({ address, chain: platformConfig.chain.id, expires: session.expiresAt });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Sign-in couldn’t be completed.";
      setError(
        /rejected|denied|4001/i.test(message)
          ? "Sign-in cancelled in your wallet. You can try again when you’re ready."
          : message.length < 250
            ? message
            : "Sign-in couldn’t be completed. Please try again.",
      );
    } finally {
      setPhase("idle");
    }
  };
  if (preview || authorized)
    return (
      <OperatorDashboard
        preview={preview}
        onExit={() => {
          setPreview(false);
          setActor(null);
          if (platformConfig.engineUrl)
            void engineRequest("/auth/logout", { method: "POST" }).catch(() => {});
        }}
        onSessionExpired={() => {
          setActor(null);
          setError("Your operator session has expired. Sign in again to continue.");
        }}
      />
    );
  const wrongNetwork = account.isConnected && account.chainId !== platformConfig.chain.id;
  const notOwner = account.isConnected && owner.data && !owner.isOwner;
  return (
    <div className="p-operator-gate">
      <section className="p-card p-access-card" aria-labelledby="operator-access-title">
        <h2 id="operator-access-title">Operator access</h2>
        <p>
          {notOwner
            ? "This wallet isn’t the current vault owner. Connect the owner wallet to continue."
            : !platformConfig.vaultAddress && status.data?.mode !== "shadow"
              ? "Operator access opens with the vault deployment. You can explore a read-only preview in the meantime."
              : status.data?.mode === "shadow" && !status.data.operator
                ? "Paper operator access is not configured. Set OPERATOR_ADDRESS and SESSION_SECRET in the engine."
                : !account.isConnected
                  ? "Connect the vault owner’s wallet to open your workspace."
                  : owner.isPending
                    ? "Checking the vault’s current owner…"
                    : owner.isError
                      ? "We couldn’t verify ownership right now. Check the vault’s network and try again."
                      : !platformConfig.engineUrl
                        ? "Your owner wallet is verified. Operator sign-in opens when the live service is connected."
                        : "Your wallet is verified as the owner. Sign a message to start your operator session."}
        </p>
        {account.address && (
          <div className="p-access-wallet">
            <Fingerprint size={15} />
            <span>{shortAddress(account.address)}</span>
            <small>{owner.isOwner ? "Owner verified" : "Connected wallet"}</small>
          </div>
        )}
        {!account.isConnected ? (
          <ConnectWalletButton label="Connect owner wallet" className="p-full" />
        ) : wrongNetwork ? (
          <button type="button" className="p-button p-button-primary p-full" onClick={openNetwork}>
            Switch to {platformConfig.chain.name}
            <ArrowUpRight size={15} />
          </button>
        ) : owner.isOwner && platformConfig.engineUrl ? (
          <button
            type="button"
            className="p-button p-button-primary p-full"
            onClick={() => void signIn()}
            disabled={phase !== "idle"}
          >
            {phase !== "idle" ? (
              <LoaderCircle size={15} className="p-spin" />
            ) : (
              <Fingerprint size={16} />
            )}
            {phase === "nonce"
              ? "Preparing your sign-in…"
              : phase === "signature"
                ? "Check your wallet…"
                : phase === "verification"
                  ? "Verifying your session…"
                  : "Sign in as operator"}
          </button>
        ) : (
          <button type="button" className="p-button p-button-secondary p-full" onClick={openWallet}>
            Manage connected wallet
            <ArrowUpRight size={15} />
          </button>
        )}
        {owner.isError && (
          <button
            type="button"
            className="p-text-button p-owner-retry"
            onClick={() => void owner.refetch()}
          >
            Check owner again
            <RefreshCw size={12} />
          </button>
        )}
        {error && (
          <p className="p-form-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="p-access-preview" onClick={() => setPreview(true)}>
          View read-only preview
          <ArrowRight size={14} />
        </button>
        <div className="p-access-footnote">
          <LockKeyhole size={12} />
          Preview is read-only. Your wallet stays in control.
        </div>
      </section>
    </div>
  );
}
