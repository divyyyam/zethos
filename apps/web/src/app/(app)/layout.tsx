import "@rainbow-me/rainbowkit/styles.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "../providers";

export const metadata: Metadata = {
  title: "Zethos",
  description: "HSK Chain AI Agent Trading hackathon scaffold",
};

// TODO: Header, owner-only Operator nav, network badge, connect button, wrong-network banner,
// vault status pill, toasts and footer per docs/ui.md section 3. Owner checks require the vault.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <header className="mx-auto flex max-w-5xl flex-wrap items-center gap-6 p-6">
        <Link href="/" className="font-semibold">
          Zethos
        </Link>
        <nav aria-label="Main navigation" className="flex gap-4">
          <Link href="/app">Swap</Link>
          <Link href="/stats">Stats</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </Providers>
  );
}
