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
      "Zethos quotes every swap on HashKey Chain against live exchange order books and fills it from its own on-chain vault. No thin pools, no surprise slippage.",
    ogImage: "/og.png",
  },

  chapters: {
    hero: "The horizon",
    proof: "The problem",
    how: "The book",
    compare: "The difference",
    quote: "The promise",
    features: "The craft",
    safety: "The guardrails",
    cta: "The close",
  },

  nav: {
    label: "Primary navigation",
    wordmark: "zethos",
    homeLabel: "Zethos home",
    cta: { label: "Launch app", href: "/app" },
  },

  hero: {
    headline: { lead: "Every swap on HashKey,", accent: "at exchange prices." },
    sub: "Zethos prices your swap against live exchange order books and fills it straight from its vault. No thin pools, no surprise slippage.",
    primary: { label: "Launch app", href: "/app" },
    secondary: { label: "Look closer", href: "#how-it-works" },
    ticker: [
      { label: "HSK / USDT", value: "0.0820" },
      { label: "Spread", value: "0.08%" },
      { label: "Quote valid", value: "30s" },
    ],
    tickerNote: "Sample data",
  },

  proof: {
    statement:
      "Most on-chain swaps are priced by a *thin pool*. The real market lives on exchange order books. Zethos brings that price to *your swap*, and settles it on-chain.",
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
    note: "Sample figures. Live numbers arrive with the Zethos engine.",
    integrationsLabel: "Built with and priced against",
    integrations: ["HashKey Chain", "HashKey Global", "Binance", "OKX", "Foundry"],
  },

  howItWorks: {
    id: "how-it-works",
    reveal: { kicker: "Look closer", title: "That horizon is an *order book.*" },
    bids: "Bids",
    asks: "Asks",
    mid: { label: "Exchange mid", value: "0.0820" },
    firm: { label: "Your firm quote", value: "0.08207", delta: "+0.08%" },
    settled: { word: "Settled", ring: "ALL OR NOTHING  ·  ATOMIC SETTLEMENT  ·  " },
    stepLabel: "Go to step",
    steps: [
      {
        title: "Request a quote.",
        body: "Pick a pair and size. Zethos returns a firm, signed price in under a second.",
      },
      {
        title: "Priced against the exchange.",
        body: "Zethos reads live order books across major exchanges and adds a tight spread sized to volatility and vault inventory.",
      },
      {
        title: "Settled on-chain.",
        body: "You submit the signed quote. The vault contract verifies it and swaps atomically, so it's all or nothing.",
      },
    ] satisfies Step[],
  },

  compare: {
    kicker: "The same swap, two outcomes",
    headline: "Drag the size. *Watch the pool give way.*",
    sliderLabel: "Swap size in USDT",
    sliderHint: "Trade size",
    pool: { name: "Typical AMM pool", resultLabel: "You'd expect" },
    zethos: { name: "Zethos", resultLabel: "Guaranteed by quote" },
    deltaLabel: "more on the same trade",
    chartLabel: "Cost vs exchange mid, by trade size",
    note: "Illustrative. A constant-product pool holding $250K per side with a 0.30% fee, against a 0.08% Zethos spread at a 0.0820 mid. Not live prices.",
    model: { mid: 0.082, poolUsdt: 250_000, poolFee: 0.003, spread: 0.0008 },
    range: { min: 100, max: 25_000, start: 8_000 },
  },

  quote: {
    kicker: "Inside a quote",
    headline: "Every quote is a *signed promise.*",
    ticket: {
      title: "Firm quote",
      badge: "Sample",
      payLabel: "You pay",
      pay: "25,000.00",
      payToken: "USDT",
      receiveLabel: "You receive",
      receive: "304,634.60",
      receiveToken: "HSK",
      rows: [
        { label: "Price", value: "0.08207 USDT" },
        { label: "Exchange mid", value: "0.08200 USDT" },
        { label: "Spread", value: "0.08%" },
      ],
      signedLabel: "Signed by Zethos",
      signature: "0x7a3f94be20d1c7e85fa6c91e",
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
        body: "The vault checks every signature, nonce and expiry before it moves a token.",
      },
    ],
  },

  features: {
    kicker: "What you get",
    headline: "Built like a market maker. *Feels like a swap.*",
    items: [
      {
        title: "Exchange-grade depth",
        art: "depth",
        body: "Size up without walking a curve. Quotes reflect the depth of major exchange books.",
      },
      {
        title: "Sub-second quotes",
        art: "speed",
        body: "Pick a pair, get a signed price before you finish reading it.",
      },
      {
        title: "All-or-nothing fills",
        art: "atomic",
        body: "One atomic transaction. It settles in full or reverts, never halfway.",
      },
      {
        title: "Inventory-aware spreads",
        art: "balance",
        body: "Spreads tighten when the vault wants your side of the trade.",
      },
      {
        title: "Nothing to sandwich",
        art: "shield",
        body: "The price is fixed before you sign, so there is no slippage for a bot to farm.",
      },
      {
        title: "Open source",
        art: "open",
        body: "Contracts, engine and this page live in one public repo.",
        link: { label: "Read the code", href: "https://github.com/divyyyam/zethos" },
      },
    ],
  },

  safety: {
    kicker: "Built to be verified",
    headline: "Six gates. *Every fill.*",
    sub: "Zethos proposes prices. The vault contract decides whether a trade is allowed.",
    items: [
      {
        title: "Signature check",
        body: "Only quotes signed by the registered Zethos key are accepted.",
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
    headline: "Stop paying for *thin pools.*",
    sub: "Get exchange-grade prices on every swap on HashKey Chain.",
    primary: { label: "Launch app", href: "/app" },
    argument: { value: "+28,228 HSK", label: "on the same 25,000 USDT swap" },
    argumentNote: "Illustrative, from the example above.",
  },

  footer: {
    navLabel: "Footer navigation",
    status: "Preview on HashKey Chain",
    backToTop: "Back to top",
    statement: "Exchange prices, on *every swap.*",
    columns: [
      {
        title: "Product",
        links: [
          { label: "Launch app", href: "/app" },
          { label: "Insights", href: "/stats" },
          { label: "Operator", href: "/operator" },
        ],
      },
      {
        title: "Build",
        links: [
          { label: "How it works", href: "#how-it-works" },
          { label: "Docs", href: "https://github.com/divyyyam/zethos/tree/main/docs" },
          { label: "GitHub", href: "https://github.com/divyyyam/zethos" },
        ],
      },
      {
        title: "Elsewhere",
        links: [
          {
            label: "Share on X",
            href: "https://x.com/intent/post?text=Zethos%20%E2%80%94%20Exchange%20prices%20for%20every%20swap%20on%20HashKey%20Chain&url=https%3A%2F%2Fgithub.com%2Fdivyyyam%2Fzethos",
          },
          { label: "Hackathon", href: "https://github.com/divyyyam/zethos#zethos" },
        ],
      },
    ] satisfies { title: string; links: Link[] }[],
    copyright: "© 2026 Zethos. Built for the HashKey Chain Horizon Hackathon.",
  },
} as const;
