import { hskMainnet, hskTestnet } from "@zethos/shared";
import type { Chain } from "viem";
import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";

const chainId = process.env.NEXT_PUBLIC_CHAIN_ID || "177";
if (chainId !== "177" && chainId !== "133")
  throw new Error("NEXT_PUBLIC_CHAIN_ID must be 177 or 133");
export const targetChain = chainId === "133" ? hskTestnet : hskMainnet;
const chains: readonly [Chain] = [targetChain];
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID;
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (typeof window === "undefined" ? "http://localhost:3000" : window.location.origin);

export const wagmiConfig = createConfig({
  chains,
  connectors: [
    injected({ shimDisconnect: true }),
    ...(projectId
      ? [
          walletConnect({
            projectId,
            showQrModal: false,
            metadata: {
              name: "Zethos",
              description: "Exchange prices. On-chain swaps.",
              url: siteUrl,
              icons: [`${siteUrl.replace(/\/$/, "")}/wallets/zethos.svg`],
            },
          }),
        ]
      : []),
  ],
  multiInjectedProviderDiscovery: true,
  transports: {
    [targetChain.id]: http(process.env.NEXT_PUBLIC_RPC_URL || undefined, {
      timeout: 12000,
      retryCount: 1,
    }),
  },
  ssr: true,
});
