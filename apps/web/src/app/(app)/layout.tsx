import "./platform.css";
import type { Metadata } from "next";
import { AppShell } from "../../components/platform/app-shell";
import { Providers } from "../providers";

export const metadata: Metadata = {
  title: { default: "Zethos Exchange", template: "%s · Zethos" },
  description:
    "Exchange-priced swaps, clear market insights, and an intelligent vault on HashKey Chain.",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-platform>
      <Providers>
        <AppShell>{children}</AppShell>
      </Providers>
    </div>
  );
}
