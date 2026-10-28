import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { hskMainnet, hskTestnet } from "@zethos/shared";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

const chainId = process.env.NEXT_PUBLIC_CHAIN_ID || "177";
if (chainId !== "177" && chainId !== "133") {
  throw new Error("NEXT_PUBLIC_CHAIN_ID must be 177 or 133");
}

export const targetChain = chainId === "133" ? hskTestnet : hskMainnet;
const chains = [targetChain] as const;
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID;

// Local scaffolding works with injected wallets without a fabricated WalletConnect project ID.
// Set the public WalletConnect ID to enable RainbowKit's default wallet connectors.
export const wagmiConfig = projectId
  ? getDefaultConfig({ appName: "Zethos", projectId, chains, ssr: true })
  : createConfig({
      chains,
      connectors: [injected()],
      transports: { [targetChain.id]: http() },
      ssr: true,
    });
