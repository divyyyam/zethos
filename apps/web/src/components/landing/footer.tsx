"use client";

import { ArrowUp, ArrowUpRight } from "lucide-react";
import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useId, useRef } from "react";
import { landing } from "../../content/landing";
import { useReducedMotionPref } from "../../hooks/use-media-query";
import { LogoMark } from "./logo-mark";
import { Magnetic } from "./magnetic";
import { EASE, Rich } from "./primitives";
import { useScrollTo } from "./scroll";

/**
 * The page's last window, in the shape of its name. A white sheet with the letters punched out of
 * it, so the live night world shows through "zethos". Sized by viewBox: it always spans the display.
 */
function Wordmark({ text }: { text: string }) {
  const id = useId();
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduced = useReducedMotionPref();
  return (
    <svg ref={ref} data-world-view aria-hidden viewBox="0 0 1000 318" className="block w-full">
      <mask id={id}>
        <rect width="1000" height="318" fill="#fff" />
        <motion.g
          initial={false}
          animate={{ y: inView || reduced ? 0 : 120 }}
          transition={{ duration: 1.6, ease: EASE }}
        >
          <text
            x="12"
            y="296"
            fill="#000"
            fontFamily="var(--font-serif)"
            fontSize="400"
            fontWeight="500"
            textLength="976"
            lengthAdjust="spacingAndGlyphs"
          >
            {text}
          </text>
        </motion.g>
      </mask>
      <rect width="1000" height="318" fill="#fff" mask={`url(#${id})`} />
    </svg>
  );
}

function FooterLink({ href, label }: { href: string; label: string }) {
  const external = href.startsWith("http");
  const className =
    "group inline-flex items-center gap-1 bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat pb-0.5 font-medium text-fg transition-[background-size] duration-500 ease-expo hover:bg-[length:100%_1px] focus-visible:bg-[length:100%_1px]";
  if (!external)
    return (
      <Link href={href} data-cursor="hover" className={className}>
        {label}
      </Link>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      data-cursor="hover"
      className={className}
    >
      {label}
      <ArrowUpRight
        aria-hidden
        className="size-3.5 text-fg-faint transition-transform duration-500 ease-expo group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
      />
    </a>
  );
}

/** Full width by design: an index on paper, then the name, then the small print. */
export function Footer() {
  const { footer, nav, chapters } = landing;
  const scrollTo = useScrollTo();
  return (
    <footer data-world="1,0.1,0,1|1,0.1,0,1" data-chapter={chapters.cta} className="relative">
      <div className="grid gap-x-block gap-y-block bg-white px-[var(--gutter)] pt-section pb-head lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col justify-between gap-block">
          <div>
            <LogoMark className="size-8 text-fg" motion="live" />
            <p className="display mt-6 max-w-[14ch] text-[clamp(2.4rem,4.2vw,4.75rem)] text-fg">
              <Rich text={footer.statement} />
            </p>
          </div>
          <p className="flex items-center gap-2 text-[15px] text-fg-soft">
            <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-[#2f9e6f]" />
            {footer.status}
          </p>
        </div>
        <nav
          aria-label={footer.navLabel}
          className="grid grid-cols-2 gap-x-head gap-y-block sm:grid-cols-3"
        >
          {footer.columns.map((column) => (
            <div key={column.title}>
              <p className="text-[15px] text-fg-faint">{column.title}</p>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <FooterLink {...link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <Wordmark text={nav.wordmark} />

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 bg-white px-[var(--gutter)] py-6 ">
        <p className="text-sm text-fg-faint">{footer.copyright}</p>
        <Magnetic strength={0.3}>
          <button
            type="button"
            data-cursor="hover"
            onClick={() => scrollTo(0)}
            className="group flex h-11 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-inverse"
          >
            {footer.backToTop}
            <ArrowUp
              aria-hidden
              className="size-4 transition-transform duration-500 ease-expo group-hover:-translate-y-0.5"
            />
          </button>
        </Magnetic>
      </div>
    </footer>
  );
}
