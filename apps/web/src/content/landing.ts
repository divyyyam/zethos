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
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    title: "Zethos — An AI agent that runs your token's trading desk on HashKey Chain",
    description:
      "A founder sets the mandate. Zethos quotes firm signed swaps from live exchange books, finds where its strategy loses money, and tests every fix against attackers before it touches the desk.",
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
    cta: { label: "Launch app", href: "/desk" },
  },

  hero: {
    headline: { lead: "A trading desk for your token,", accent: "that earns every change." },
    sub: "You set the mandate. Zethos quotes firm, signed swaps from live exchange books, finds where it loses money, and has to beat an unseen attacker before a new strategy goes live.",
    primary: { label: "Launch app", href: "/desk" },
    secondary: { label: "Look closer", href: "#how-it-works" },
  },

  proof: {
    statement:
      "Token projects pay market makers they *can't inspect*. Zethos runs the desk in the open: every price signed, every loss explained, every *strategy change earned*.",
    note: "Measured paper results are in the Arena.",
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
        title: "Verified, then settled.",
        body: "The vault contract checks the signature, expiry, nonce and caps, then settles both legs atomically. Open Desk to inspect the engine’s current settlement mode.",
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
    kicker: "How the desk improves",
    headline: "It runs the desk. *Then it questions it.*",
    items: [
      {
        title: "A mandate you set",
        art: "balance",
        body: "Pairs, inventory band, spread per trade size, maximum loss. Enforced outside the strategy, and every breach is journaled.",
      },
      {
        title: "Losses with a cause",
        art: "depth",
        body: "Every loss is attributed: stale reference, inventory imbalance, selective execution or adverse size, with dollars and example fills.",
      },
      {
        title: "Strategies as data",
        art: "speed",
        body: "A research agent proposes a new strategy as a bounded spec, never code. It is never in the live pricing loop.",
      },
      {
        title: "Attacked before deployed",
        art: "shield",
        body: "Candidates face the Arena's attackers and held-out data, including an attacker the research agent never saw.",
      },
      {
        title: "Earned, not assumed",
        art: "atomic",
        body: "A qualified strategy gets a small share of requests as a canary, then is promoted or retired from real results.",
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
      {
        title: "Public contracts",
        body: "Open source for anyone to read. Unaudited, and deployed with tiny caps.",
      },
    ],
  },

  cta: {
    headline: "Give your token a desk *you can inspect.*",
    sub: "Firm exchange prices for every swap, and a strategy that has to earn every change.",
    primary: { label: "Launch app", href: "/desk" },
    argument: { value: "+28,228 HSK", label: "on the same 25,000 USDT swap" },
    argumentNote: "Illustrative, from the example above.",
  },

  footer: {
    navLabel: "Footer navigation",
    status: "Open Desk to inspect settlement mode. Arena fills stay paper.",
    backToTop: "Back to top",
    statement: "A desk that *earns every change.*",
    columns: [
      {
        title: "Product",
        links: [
          { label: "Launch app", href: "/desk" },
          { label: "Desk", href: "/desk" },
          { label: "Research", href: "/research" },
          { label: "Arena", href: "/arena" },
        ],
      },
      {
        title: "Build",
        links: [
          { label: "How it works", href: "#how-it-works" },
          { label: "Docs", href: "https://github.com/divyyyam/zethos#readme" },
          { label: "GitHub", href: "https://github.com/divyyyam/zethos" },
        ],
      },
      {
        title: "Elsewhere",
        links: [
          {
            label: "Share on X",
            href: "https://x.com/intent/post?text=Zethos%20%E2%80%94%20An%20AI%20agent%20that%20runs%20your%20token%27s%20trading%20desk%20on%20HashKey%20Chain&url=https%3A%2F%2Fgithub.com%2Fdivyyyam%2Fzethos",
          },
          { label: "Hackathon", href: "https://github.com/divyyyam/zethos#zethos" },
        ],
      },
    ] satisfies { title: string; links: Link[] }[],
    copyright: "© 2026 Zethos. Built for the HashKey Chain Horizon Hackathon.",
  },
} as const;
