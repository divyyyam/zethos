import { ArrowDown } from "lucide-react";
import type { CSSProperties } from "react";
import { landing } from "../../content/landing";
import { PrimaryButton, Rich } from "./primitives";

/** Title on paper, then the first window onto the world. Animates in CSS, before hydration. */
export function Hero() {
  const { hero, chapters } = landing;
  return (
    <section
      aria-labelledby="hero-title"
      data-world="0,0.13,0,1|0.05,0.13,0,1"
      data-chapter={chapters.hero}
      className="relative flex min-h-[100svh] flex-col sect overflow-clip pt-chrome pb-edge"
    >
      <div className="relative z-10 pt-block pb-block ">
        <h1 id="hero-title" className="display t-hero text-fg">
          <span className="line-mask">
            <span className="hero-line" style={{ "--i": 0 } as CSSProperties}>
              {hero.headline.lead}
            </span>
          </span>
          <span className="line-mask">
            <span className="hero-line" style={{ "--i": 1 } as CSSProperties}>
              <Rich text={`*${hero.headline.accent}*`} />
            </span>
          </span>
        </h1>
        <div className="intro-fade mt-6 grid items-end gap-6 md:grid-cols-[minmax(0,560px)_1fr]">
          <p className="lead text-fg-soft">{hero.sub}</p>
          <div className="flex items-center gap-6 md:justify-end">
            <a
              href={hero.secondary.href}
              data-cursor="hover"
              className="group inline-flex items-center gap-2 font-medium"
            >
              {hero.secondary.label}
              <ArrowDown
                aria-hidden
                className="size-4 transition-transform duration-500 ease-expo group-hover:translate-y-1"
              />
            </a>
            <PrimaryButton href={hero.primary.href}>{hero.primary.label}</PrimaryButton>
          </div>
        </div>
      </div>

      <div className="world-window min-h-[max(300px,60svh)] flex-1">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%] rounded-[inherit] bg-[linear-gradient(to_top,rgb(13_11_43/0.72),transparent)]"
        />
        <dl
          className="intro-fade ink-light absolute inset-x-inset bottom-inset flex flex-wrap items-end gap-x-block gap-y-3 "
          style={{ "--delay": "2s" } as CSSProperties}
        >
          {hero.ticker.map((item) => (
            <div key={item.label}>
              <dt className="text-sm text-fg-soft">{item.label}</dt>
              <dd className="num mt-1.5 text-[max(1.75rem,calc(var(--cw)*0.026))]">{item.value}</dd>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-2 pb-1">
            <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-white" />
            <span className="text-sm text-fg-soft">{hero.tickerNote}</span>
          </div>
        </dl>
      </div>
    </section>
  );
}
