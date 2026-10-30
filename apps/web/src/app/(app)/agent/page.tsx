import type { Metadata } from "next";
import { AgentPage } from "../../../components/platform/agent/agent-page";

export const metadata: Metadata = { title: "Agent" };
export default function AgentRoute() {
  return <AgentPage />;
}
