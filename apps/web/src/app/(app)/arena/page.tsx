import type { Metadata } from "next";
import { ArenaPageContent } from "../../../components/platform/arena-page";

export const metadata: Metadata = { title: "Paper Arena" };
export default function ArenaPage() {
  return <ArenaPageContent />;
}
