import type { Metadata } from "next";
import { OperatorPageContent } from "../../../components/platform/operator-page";
export const metadata: Metadata = { title: "Operator workspace" };
export default function OperatorPage() {
  return <OperatorPageContent />;
}
