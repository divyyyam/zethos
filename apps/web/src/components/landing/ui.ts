/**
 * The landing page's sizing scale. Every section composes these instead of picking its own
 * paddings, widths, radii and type sizes, so edges, rhythm and hierarchy line up page-wide.
 * Plain strings in a non-client module, so server and client components can both import them.
 */
export const ui = {
  /** Standard section: 20/32px gutters, 96/128px vertical rhythm. */
  section: "relative px-5 py-24 md:px-8 md:py-32",
  /** Sections that are a framed panel get half the outer rhythm; the panel pads itself. */
  panelSection: "relative px-5 py-12 md:px-8 md:py-16",
  /** The one content column every grid aligns to. */
  container: "mx-auto w-full max-w-[1200px]",
  /** Space between a section header and the content under it. */
  afterHeader: "mt-12 md:mt-16",
  /** Gap inside card grids. */
  gridGap: "gap-3 md:gap-4",

  /** Cards and the CTA panel (brief: 24px). Nested blocks step down to 16px; full panels up to 32px. */
  card: "rounded-[24px]",
  inset: "rounded-2xl",
  panel: "rounded-[32px]",
  cardPad: "p-6 md:p-8",
  panelPad: "px-6 py-14 md:px-14 md:py-20",

  /** Type scale. */
  h2: "font-display text-[clamp(1.875rem,3.7vw,2.75rem)] font-normal leading-[1.1] tracking-[-0.03em] text-balance text-ink",
  cardTitle:
    "font-display text-xl font-medium leading-snug tracking-[-0.02em] text-ink md:text-[22px]",
  itemTitle:
    "font-display text-[17px] font-medium leading-snug tracking-[-0.015em] text-ink md:text-lg",
  lead: "font-body text-base leading-relaxed text-ink-muted text-pretty md:text-[17px]",
  body: "font-body text-sm leading-relaxed text-ink-muted md:text-[15px]",
  fine: "font-body text-xs leading-relaxed text-ink-muted",

  /** 44px icon tile used by feature, callout and guarantee items. */
  iconChip: "flex size-11 shrink-0 items-center justify-center rounded-2xl",
} as const;
