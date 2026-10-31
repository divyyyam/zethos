import type { Metadata } from "next";
import { DeskPage } from "../../../components/platform/desk/desk-page";

export const metadata: Metadata = {
  title: "Desk",
  description: "Founder mandate targets, active policy allocations, and live desk compliance.",
};

export default function DeskRoute() {
  return <DeskPage />;
}
