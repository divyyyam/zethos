import type { Metadata } from "next";
import { OverviewPage } from "../../../components/platform/overview/overview-page";

export const metadata: Metadata = { title: "Overview" };
export default function DashboardRoute() {
  return <OverviewPage />;
}
