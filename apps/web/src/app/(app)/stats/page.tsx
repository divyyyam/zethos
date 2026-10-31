import type { Metadata } from "next";
import { StatsPageContent } from "../../../components/platform/stats/stats-page";
export const metadata: Metadata = { title: "Market insights" };
export default function StatsPage() {
  return <StatsPageContent />;
}
