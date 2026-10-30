import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bot,
  LayoutDashboard,
  type LucideIcon,
  ShieldCheck,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  /** Shown under the page title in the topbar. */
  blurb: string;
  icon: LucideIcon;
  /** Second key of the `g` then key shortcut. */
  key: string;
}

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Trade",
    items: [
      {
        href: "/dashboard",
        label: "Overview",
        blurb: "The vault, the market and the agent at a glance",
        icon: LayoutDashboard,
        key: "o",
      },
      {
        href: "/agent",
        label: "Agent",
        blurb: "Say what you want, authorize it once",
        icon: Bot,
        key: "a",
      },
      {
        href: "/app",
        label: "Swap",
        blurb: "A firm quote you review yourself",
        icon: ArrowLeftRight,
        key: "s",
      },
    ],
  },
  {
    title: "Market",
    items: [
      {
        href: "/arena",
        label: "Arena",
        blurb: "Paper market making against every kind of flow",
        icon: Activity,
        key: "r",
      },
      {
        href: "/stats",
        label: "Insights",
        blurb: "Exchange prices against on-chain reality",
        icon: BarChart3,
        key: "i",
      },
    ],
  },
  {
    title: "Operate",
    items: [
      {
        href: "/operator",
        label: "Workspace",
        blurb: "Operator controls for the vault owner",
        icon: ShieldCheck,
        key: "w",
      },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
