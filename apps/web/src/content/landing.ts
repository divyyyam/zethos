import type { StatKey } from "./stats.mock";

/** How a raw stat number is rendered on its card, e.g. 48000 → "$48K", 1240 → "1,240+". */
export interface StatFormat {
  prefix?: string;
  suffix?: string;
  decimals: number;
  /** Divide by 1,000 and append "K". */
  thousands?: boolean;
}

export interface StatCardContent {
  key: StatKey;
  label: string;
  format: StatFormat;
}

export interface Step {
  title: string;
  body: string;
}

export interface Link {
  label: string;
  href: string;
}

export const landing = {
  meta: {
    // Replace with the production origin once the site has a domain.
    siteUrl: "http://localhost:3000",
    title: "Zethos — Exchange prices for every swap on HashKey Chain",
    description:
      "Zethos is an AI agent that quotes every swap on HashKey Chain against live exchange order books and fills it from its own on-chain vault. No thin pools, no surprise slippage.",
    ogImage: "/og.png",
  },

  nav: {
    label: "Primary navigation",
    wordmark: "zethos",
    homeLabel: "Zethos home",
    cta: { label: "Launch app", href: "/app" },
  },

  hero: {
    headline: { lead: "Swap on HashKey Chain", line2: "at", accent: "exchange prices." },
    sub: "An AI agent quotes every swap against live exchange order books and fills it straight from its vault. No thin pools, no surprise slippage.",
    primary: { label: "Launch app", href: "/app" },
    secondary: { label: "How it works", href: "#how-it-works" },
  },

  proof: {
    pill: "Live on HashKey Chain testnet",
    headline: "Every fill, priced against the market.",
    cards: [
      {
        key: "avgSpreadPct",
        label: "Avg. spread vs exchange mid",
        format: { decimals: 2, suffix: "%" },
      },
      { key: "medianFillSeconds", label: "Median fill time", format: { decimals: 1, suffix: "s" } },
      {
        key: "vaultDepthUsd",
        label: "Vault depth",
        format: { decimals: 0, prefix: "$", suffix: "K", thousands: true },
      },
      { key: "swapsFilled", label: "Swaps filled", format: { decimals: 0, suffix: "+" } },
    ] satisfies StatCardContent[],
    note: "Testnet figures. Live data coming from the Zethos engine.",
    integrationsLabel: "Built with and priced against",
    integrations: ["HashKey Chain", "HashKey Global", "Binance", "OKX", "Foundry"],
  },

  howItWorks: {
    id: "how-it-works",
    pill: "Agent in the loop",
    headline: "You swap. The agent does the rest.",
    stepLabel: "Go to step",
    progressLabel: "The path to a better swap",
    steps: [
      {
        title: "Request a quote.",
        body: "Pick a pair and size. The agent returns a firm, signed price in under a second.",
      },
      {
        title: "Priced against the exchange.",
        body: "It reads live order books across major exchanges and adds a tight spread sized to volatility and vault inventory.",
      },
      {
        title: "Settled on-chain.",
        body: "You submit the signed quote. The vault contract verifies it and swaps atomically, so it's all or nothing.",
      },
    ] satisfies Step[],
  },

  compare: {
    pill: "Why Zethos",
    headline: "The same swap, two outcomes.",
    trade: "Swap 25,000 USDT for HSK",
    note: "Illustrative example at a mid price of 0.50 USDT per HSK. Pool figures assume a thin testnet pool with a 0.30% fee.",
    pool: {
      name: "Typical AMM pool",
      rows: [
        { label: "Pool fee", value: "0.30%" },
        { label: "Price impact", value: "1.84%" },
        { label: "Minimum received (1% slippage)", value: "48,441 HSK" },
      ],
      resultLabel: "Expected",
      result: "48,930 HSK",
    },
    zethos: {
      name: "Zethos",
      rows: [
        { label: "Spread vs exchange mid", value: "0.08%" },
        { label: "Price impact", value: "None, firm quote" },
        { label: "Quote valid for", value: "30 seconds" },
      ],
      resultLabel: "Guaranteed",
      result: "49,960 HSK",
    },
    delta: "+1,030 HSK",
    deltaLabel: "more on the same trade",
  },

  quote: {
    pill: "Inside a quote",
    headline: "Every quote is a signed promise.",
    ticket: {
      title: "Firm quote",
      payLabel: "You pay",
      pay: "25,000.00",
      payToken: "USDT",
      receiveLabel: "You receive",
      receive: "49,960.00",
      receiveToken: "HSK",
      rows: [
        { label: "Price", value: "0.5004 USDT" },
        { label: "Exchange mid", value: "0.5000 USDT" },
        { label: "Spread", value: "0.08%" },
        { label: "Signed by", value: "0x7a3f…c91e" },
      ],
      expiresLabel: "Expires in",
      expiresSeconds: 30,
    },
    callouts: [
      {
        title: "Firm, not estimated",
        body: "The amount you see is the amount you get. Nothing moves between quote and fill.",
      },
      {
        title: "Priced off real books",
        body: "Mid comes from live exchange order books, not from a pool's own reserves.",
      },
      {
        title: "Short-lived on purpose",
        body: "Quotes expire in seconds, so a stale price can never be filled.",
      },
      {
        title: "Verified on-chain",
        body: "The vault checks the agent's signature, nonce and expiry before it moves a token.",
      },
    ],
  },

  features: {
    pill: "What you get",
    headline: "Built like a market maker. Feels like a swap.",
    items: [
      {
        title: "Exchange-grade depth",
        body: "Size up without walking a curve. Quotes reflect the depth of major exchange books.",
      },
      {
        title: "Sub-second quotes",
        body: "Pick a pair, get a signed price before you finish reading it.",
        stat: "<1s",
      },
      {
        title: "All-or-nothing fills",
        body: "One atomic transaction. It settles in full or reverts, never halfway.",
      },
      {
        title: "Inventory-aware spreads",
        body: "Spreads tighten when the vault wants your side of the trade.",
      },
      {
        title: "Nothing to sandwich",
        body: "The price is fixed before you sign, so there is no slippage for a bot to farm.",
      },
      {
        title: "Open source",
        body: "Contracts, engine and this page live in one public repo.",
        link: { label: "Read the code", href: "https://github.com/divyyyam/zethos" },
      },
    ],
  },

  safety: {
    pill: "Built to be verified",
    headline: "Guardrails on every fill.",
    sub: "The agent proposes prices. The vault contract decides whether a trade is allowed.",
    items: [
      {
        title: "Signature check",
        body: "Only quotes signed by the registered agent key are accepted.",
      },
      { title: "Expiry and nonce", body: "Each quote is single-use and dies after its deadline." },
      {
        title: "Size limits",
        body: "Per-trade caps keep any single fill within vault risk limits.",
      },
      { title: "Atomic settlement", body: "Both legs move in one transaction or not at all." },
      {
        title: "Pausable vault",
        body: "The operator can halt quoting instantly if markets break.",
      },
      { title: "Public contracts", body: "Verified source on HashKey Chain for anyone to audit." },
    ],
  },

  cta: {
    pill: "Start today",
    headline: "Stop paying for thin pools.",
    sub: "Get exchange-grade prices on every swap on HashKey Chain.",
    primary: { label: "Launch app", href: "/app" },
  },

  footer: {
    navLabel: "Footer navigation",
    links: [
      { label: "Product", href: "/app" },
      { label: "Docs", href: "https://github.com/divyyyam/zethos/tree/main/docs" },
      { label: "GitHub", href: "https://github.com/divyyyam/zethos" },
      { label: "Hackathon", href: "https://github.com/divyyyam/zethos#zethos" },
    ] satisfies Link[],
    copyright: "© 2026 Zethos. Built for the HashKey Chain Horizon Hackathon.",
    social: {
      x: {
        label: "Share Zethos on X",
        href: "https://x.com/intent/post?text=Zethos%20%E2%80%94%20Exchange%20prices%20for%20every%20swap%20on%20HashKey%20Chain&url=https%3A%2F%2Fgithub.com%2Fdivyyyam%2Fzethos",
      },
      github: { label: "Zethos on GitHub", href: "https://github.com/divyyyam/zethos" },
    },
  },
} as const;
