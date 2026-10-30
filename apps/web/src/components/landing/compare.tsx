"use client";

import { animate, useMotionValue, useMotionValueEvent } from "motion/react";
import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { art } from "../../content/art";
import { landing } from "../../content/landing";
import { useReducedMotionPref } from "../../hooks/use-media-query";
import { Reveal, RiseHeading } from "./primitives";

const { model, range } = landing.compare;
const LOG_MIN = Math.log(range.min);
const LOG_MAX = Math.log(range.max);
const sizeAt = (t: number) => Math.exp(LOG_MIN + t * (LOG_MAX - LOG_MIN));
const tAt = (size: number) => (Math.log(size) - LOG_MIN) / (LOG_MAX - LOG_MIN);

/** Output of a constant-product pool: the bigger the trade, the further it walks the curve. */
function poolOut(usdt: number) {
  const reserveHsk = model.poolUsdt / model.mid;
  const net = usdt * (1 - model.poolFee);
  return (reserveHsk * net) / (model.poolUsdt + net);
}
const zethosOut = (usdt: number) => (usdt / model.mid) * (1 - model.spread);
const poolCost = (usdt: number) => 1 - poolOut(usdt) / (usdt / model.mid);

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

const CHART = { w: 1000, h: 300, pad: 8 };
const MAX_COST = poolCost(range.max);
const pointX = (t: number) => CHART.pad + t * (CHART.w - CHART.pad * 2);
const pointY = (cost: number) =>
  CHART.h - CHART.pad - (cost / MAX_COST) * (CHART.h - CHART.pad * 2);

function CostChart({ t, label }: { t: number; label: string }) {
  const { curve, area } = useMemo(() => {
    const points = Array.from({ length: 80 }, (_, i) => {
      const at = i / 79;
      return `${pointX(at).toFixed(1)},${pointY(poolCost(sizeAt(at))).toFixed(1)}`;
    });
    const flat = pointY(model.spread);
    return {
      curve: `M${points.join(" L")}`,
      area: `M${points.join(" L")} L${pointX(1)},${flat} L${pointX(0)},${flat} Z`,
    };
  }, []);
  const size = sizeAt(t);
  const x = pointX(t);
  const y = pointY(poolCost(size));
  const flat = pointY(model.spread);
  return (
    <svg
      viewBox={`0 0 ${CHART.w} ${CHART.h}`}
      role="img"
      aria-label={label}
      className="h-[200px] w-full md:h-[260px]"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="cost-gap" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#d9532f" stopOpacity="0.28" />
          <stop offset="1" stopColor="#d9532f" stopOpacity="0.02" />
        </linearGradient>
        <clipPath id="cost-clip">
          <rect x="0" y="0" width={x} height={CHART.h} />
        </clipPath>
      </defs>
      <path d={area} fill="url(#cost-gap)" clipPath="url(#cost-clip)" />
      <path
        d={curve}
        fill="none"
        stroke="var(--fg-faint)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeDasharray="3 5"
      />
      <path
        d={curve}
        fill="none"
        stroke="#d9532f"
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
        clipPath="url(#cost-clip)"
      />
      <line
        x1={pointX(0)}
        x2={pointX(1)}
        y1={flat}
        y2={flat}
        stroke="var(--fg)"
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={x}
        x2={x}
        y1={y}
        y2={flat}
        stroke="var(--fg)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * The argument as an instrument. The figures are real arithmetic: a constant-product pool against a
 * flat spread, so a judge can drag from $100 to $25K and watch exactly where a thin pool gives way.
 */
export function Compare() {
  const { compare, chapters } = landing;
  const id = useId();
  const reduced = useReducedMotionPref();
  const [t, setT] = useState(() => tAt(range.start));
  const sweep = useMotionValue(0);
  const touched = useRef(false);
  const section = useRef<HTMLElement>(null);
  useMotionValueEvent(sweep, "change", (v) => {
    if (!touched.current) setT(v);
  });

  // One sweep on first sight, up to the resting size, so the control announces that it moves.
  useEffect(() => {
    const el = section.current;
    if (!el || reduced) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || touched.current) return;
        observer.disconnect();
        sweep.set(0);
        animate(sweep, tAt(range.start), { duration: 2.2, ease: [0.16, 1, 0.3, 1] });
      },
      { threshold: 0.45 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced, sweep]);

  const size = sizeAt(t);
  const pool = poolOut(size);
  const zethos = zethosOut(size);
  const delta = zethos - pool;
  const words = compare.headline.split(". ");

  return (
    <section
      ref={section}
      aria-label={chapters.compare}
      data-world="0.58,0,0,1|0.6,0,0,1"
      data-chapter={chapters.compare}
      className="relative sect bg-white pt-after-window"
    >
      <div className="grid gap-block lg:grid-cols-[minmax(0,1fr)_minmax(0,30%)]">
        <div>
          <Reveal>
            <p className="eyebrow text-fg-soft">{compare.kicker}</p>
          </Reveal>
          <RiseHeading
            lines={[`${words[0]}.`, words[1] ?? ""]}
            className="display t-section mt-4 text-fg"
          />
        </div>
        <Reveal y={40} className="relative hidden lg:block">
          <Image
            src={art.valley.src}
            fill
            sizes="30vw"
            alt=""
            className="plate object-contain object-right"
          />
        </Reveal>
      </div>

      <div className="mt-head grid gap-x-block gap-y-block lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col justify-between gap-block">
          <div>
            <p className="num text-[max(3.75rem,calc(var(--cw)*0.09))] text-fg">+{fmt(delta)}</p>
            <p className="lead mt-3 text-fg-soft">HSK {compare.deltaLabel}</p>
          </div>
          <dl className="grid grid-cols-2 gap-6 border-t border-line pt-6">
            <div>
              <dt className="eyebrow flex items-center gap-2 text-fg-soft">
                <span aria-hidden className="size-1.5 rounded-full bg-[#d9532f]" />
                {compare.pool.name}
              </dt>
              <dd className="mt-4 num text-[2rem] text-fg-soft md:text-[2.75rem]">{fmt(pool)}</dd>
              <dd className="mt-1 text-[15px] text-fg-soft">{compare.pool.resultLabel}</dd>
            </div>
            <div>
              <dt className="eyebrow flex items-center gap-2 text-fg">
                <span aria-hidden className="size-1.5 rounded-full bg-fg" />
                {compare.zethos.name}
              </dt>
              <dd className="mt-4 num text-[2rem] text-fg md:text-[2.75rem]">{fmt(zethos)}</dd>
              <dd className="mt-1 text-[15px] text-fg-soft">{compare.zethos.resultLabel}</dd>
            </div>
          </dl>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-4">
            <label htmlFor={id} className="eyebrow text-fg-soft">
              {compare.sliderHint}
            </label>
            <output htmlFor={id} className="num text-[max(1.75rem,calc(var(--cw)*0.032))] text-fg">
              {fmt(size)}{" "}
              <span className="font-sans text-[0.45em] tracking-normal text-fg-soft">USDT</span>
            </output>
          </div>
          <div className="mt-3" data-cursor="drag">
            <CostChart t={t} label={compare.chartLabel} />
            <input
              id={id}
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={t}
              aria-label={compare.sliderLabel}
              aria-valuetext={`${fmt(size)} USDT`}
              className="size-slider -mt-1 block"
              style={{ "--fill": `${t * 100}%` } as React.CSSProperties}
              onChange={(event) => {
                touched.current = true;
                setT(Number(event.target.value));
              }}
            />
          </div>
          <div className="flex justify-between num-sm text-sm text-fg-soft">
            <span>$100</span>
            <span>{compare.chartLabel}</span>
            <span>$25K</span>
          </div>
        </div>
      </div>

      <p className="mt-block max-w-[680px] text-[15px] leading-relaxed text-fg-faint">
        {compare.note}
      </p>
    </section>
  );
}
