import type { Metadata } from "next";
import { ResearchPage } from "../../../components/platform/research/research-page";

export const metadata: Metadata = {
  title: "Research",
  description: "Autonomous policy generation, held-out evaluation, and qualification telemetry.",
};

export default function ResearchRoute() {
  return <ResearchPage />;
}
