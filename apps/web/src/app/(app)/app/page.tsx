import type { Metadata } from "next";
import { SwapPageContent } from "../../../components/platform/swap-page";
export const metadata: Metadata = { title: "Swap" };
export default function SwapPage() {
  return <SwapPageContent />;
}
