"use client";

import Image from "next/image";
import { type CSSProperties, type ReactNode, useId, useState } from "react";

// Original, deterministic vector artwork. Both scenes share the same geography.
function random(seed: number) {
  let n = seed;
  return () => {
    n += 0x6d2b79f5;
    let value = Math.imul(n ^ (n >>> 15), n | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pine(x: number, y: number, height: number, seed: number) {
  const r = random(seed);
  const points = [`M${x} ${y - height}`];
  for (let tier = 1; tier <= 12; tier++) {
    const width = height * (0.023 + tier * 0.014);
    const top = y - height + (tier / 13) * height;
    points.push(
      `L${x + width * 0.3} ${top - height * 0.035}L${x + width * (0.85 + r() * 0.3)} ${top + height * 0.065}L${x + width * 0.47} ${top + height * 0.04}`,
    );
  }
  points.push(`L${x + height * 0.015} ${y}H${x - height * 0.015}`);
  for (let tier = 12; tier >= 1; tier--) {
    const width = height * (0.023 + tier * 0.014);
    const top = y - height + (tier / 13) * height;
    points.push(
      `L${x - width * 0.47} ${top + height * 0.04}L${x - width * (0.85 + r() * 0.3)} ${top + height * 0.065}L${x - width * 0.3} ${top - height * 0.035}`,
    );
  }
  return `${points.join(" ")}Z`.replace(/-?\d+\.\d+/g, (value) => Number(value).toFixed(1));
}

function forest(seed: number, count: number, start: number, end: number, base: number, scale = 1) {
  const r = random(seed);
  return Array.from({ length: count }, (_, i) =>
    pine(
      start + ((end - start) * (i + r() * 0.8)) / count,
      base + r() * 32,
      (45 + r() * 115) * scale,
      i + seed,
    ),
  ).join(" ");
}

const FAR =
  "M0 408L64 370 98 386 166 310 191 325 238 268 277 299 310 284 357 339 393 328 459 393 495 373 558 416 610 402 676 447 720 430 773 459 826 444 871 467 928 428 966 441 1021 399 1068 421 1128 343 1160 365 1209 288 1242 305 1295 245 1326 279 1353 271 1420 331 1455 315 1520 372 1560 350 1600 381V720H0Z";
const MID =
  "M0 379L69 327 107 342 176 264 212 297 252 283 283 326 319 344 351 384 403 413 439 448 489 460 537 486 585 495 649 522 721 529 803 549 884 530 968 523 1018 500 1062 491 1110 458 1150 446 1209 386 1246 370 1312 295 1351 324 1374 306 1430 360 1460 349 1523 411 1566 395 1600 425V715H0Z";
const NEAR =
  "M0 490Q90 454 157 479T296 515Q370 512 444 555L549 586 631 599 780 618 912 599 1030 592Q1130 559 1213 543T1380 510Q1494 469 1600 489V744H0Z";
const TREES_BACK = `${forest(61, 45, -20, 586, 661, 0.55)} ${forest(37, 46, 1035, 1620, 654, 0.6)}`;
const TREES = `${forest(19, 24, -20, 450, 724, 1.05)} ${forest(29, 26, 1180, 1640, 720, 1.2)}`;
const FOREGROUND = `${pine(67, 803, 318, 6)} ${pine(147, 808, 243, 4)} ${pine(1527, 807, 304, 9)} ${pine(1448, 801, 215, 3)}`;
const FLOWERS = Array.from({ length: 115 }, (_, i) => {
  const r = random(213 + i * 83);
  return { x: r() * 1600, y: 796 + r() * 54, size: 0.8 + r() * 1.9 };
});
const STARS = Array.from({ length: 45 }, (_, i) => {
  const r = random(73 + i * 133);
  return { x: r() * 1600, y: 160 + r() * 290, size: 0.5 + r() * 1.2 };
});

const PALETTES = {
  day: {
    sky: ["#ffffff", "#f5ecf1", "#e3e8f3"],
    far: ["#c6c3df", "#b7b9d9"],
    mid: ["#9299c2", "#acb0d0"],
    shade: "#747fae",
    snow: "#f8e7e7",
    snowShade: "#d3cfe4",
    near: ["#788eaa", "#adc1c9"],
    lake: ["#dbe7eb", "#b7d1cf", "#dce6cf"],
    treesBack: "#547e70",
    trees: "#31594a",
    front: "#25493c",
    meadow: ["#c3cf86", "#8fa560"],
    glow: "#fff9eb",
  },
  night: {
    sky: ["#ffffff", "#b8b9d4", "#535d88"],
    far: ["#6b729d", "#56648c"],
    mid: ["#404e7e", "#596b93"],
    shade: "#35416b",
    snow: "#d4d3e6",
    snowShade: "#a0a8c9",
    near: ["#2c3e64", "#425b78"],
    lake: ["#61789b", "#283c60", "#1b2b47"],
    treesBack: "#29464f",
    trees: "#19343d",
    front: "#10282f",
    meadow: ["#39564c", "#203b35"],
    glow: "#fff5d9",
  },
} as const;

export function LandscapeFallback({
  variant,
  className,
}: {
  variant: "day" | "night";
  className?: string;
}) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const fill = (name: string) => `url(#${id(name)})`;
  const p = PALETTES[variant];
  const night = variant === "night";
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 1600 850"
      preserveAspectRatio="xMidYMax slice"
    >
      <defs>
        {(["sky", "far", "mid", "near", "lake", "meadow"] as const).map((name) => (
          <linearGradient key={name} id={id(name)} x2="0" y2="1">
            {p[name].map((color, i, colors) => (
              <stop key={color} offset={i / (colors.length - 1)} stopColor={color} />
            ))}
          </linearGradient>
        ))}
        <linearGradient id={id("sky-fade")} x2="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0" />
          <stop offset="0.26" stopColor="white" stopOpacity="0" />
          <stop offset="0.58" stopColor="white" />
        </linearGradient>
        <mask id={id("sky-mask")}>
          <rect width="1600" height="850" fill={fill("sky-fade")} />
        </mask>
        <radialGradient id={id("glow")}>
          <stop stopColor={p.glow} stopOpacity="0.9" />
          <stop offset="1" stopColor={p.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("mist")} x2="0" y2="1">
          <stop stopColor={p.glow} stopOpacity="0" />
          <stop offset="0.6" stopColor={p.glow} stopOpacity={night ? "0.09" : "0.28"} />
          <stop offset="1" stopColor={p.glow} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("reflection")} x2="0" y2="1">
          <stop stopColor={p.glow} stopOpacity="0.65" />
          <stop offset="1" stopColor={p.glow} stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="1600" height="850" fill={fill("sky")} mask={fill("sky-mask")} />
      <ellipse cx="830" cy="440" rx="550" ry="180" fill={fill("glow")} />
      {night && (
        <g>
          {STARS.map((s) => (
            <circle key={s.x} cx={s.x} cy={s.y} r={s.size} fill={p.glow} opacity="0.7" />
          ))}
          <circle cx="1125" cy="310" r="115" fill={fill("glow")} opacity="0.4" />
          <circle cx="1125" cy="310" r="24" fill={p.glow} />
        </g>
      )}
      <path d={FAR} fill={fill("far")} />
      <g fill={p.snow} opacity="0.8">
        <path d="M238 268L277 299 310 284 357 339 325 322 307 303 288 323 266 302 248 310 231 289 207 305Z" />
        <path d="M1209 288L1242 305 1295 245 1326 279 1353 271 1401 314 1360 295 1341 301 1314 275 1297 284 1283 272 1252 323 1230 316Z" />
      </g>
      <path d={MID} fill={fill("mid")} />
      <g fill={p.shade} opacity="0.52">
        <path d="M176 264L193 319 183 346 246 405 282 480 398 527 489 547 439 448 403 413 351 384 319 344 283 326 252 283 212 297Z" />
        <path d="M1312 295L1328 355 1304 384 1351 437 1354 482 1457 520 1600 566V425L1566 395 1523 411 1460 349 1430 360 1374 306 1351 324Z" />
      </g>
      <g fill={p.snow}>
        <path d="M176 264L212 297 252 283 283 326 263 314 247 308 231 326 215 313 206 330 188 298 181 319 170 294 146 320 154 294Z" />
        <path d="M1312 295L1351 324 1374 306 1430 360 1392 342 1374 331 1357 345 1338 326 1322 331 1315 318 1294 341 1274 337Z" />
      </g>
      <g fill={p.snowShade}>
        <path d="M176 264L181 319 188 298 206 330 193 319Z" />
        <path d="M1312 295L1315 318 1322 331 1338 326 1351 324Z" />
      </g>
      <g fill="none" stroke={p.snow} opacity="0.2" strokeWidth="2">
        <path d="M107 342L151 385 170 432M252 326L285 381 314 410M1351 364L1394 409 1426 473M1460 387L1501 440 1538 460" />
      </g>
      <path d={NEAR} fill={fill("near")} />
      <rect y="494" width="1600" height="164" fill={fill("mist")} />
      <path d="M0 638Q440 588 800 615T1600 628V850H0Z" fill={fill("lake")} />
      <path
        d="M550 624Q760 641 1020 622L1150 850H454Z"
        fill={fill("reflection")}
        opacity={night ? "0.3" : "0.6"}
      />
      <g fill="none" stroke={p.glow} strokeLinecap="round">
        {Array.from({ length: 23 }, (_, i) => {
          const r = random(5 + i * 71);
          const x = 370 + r() * 750;
          return (
            <path
              key={x}
              d={`M${x} ${634 + i * 7}h${35 + r() * 200}`}
              opacity={0.12 + r() * 0.4}
              strokeWidth={0.6 + r() * 1.3}
            />
          );
        })}
      </g>
      {night && (
        <g>
          <ellipse cx="835" cy="684" rx="90" ry="24" fill={fill("glow")} opacity="0.25" />
          <path
            d="M790 648h95m-77 12h60m-73 13h98m-69 14h39m-64 15h86m-70 17h60"
            stroke={p.glow}
            strokeWidth="2"
            opacity="0.6"
          />
        </g>
      )}
      <path d="M0 615Q115 585 259 631T578 665L690 684Q422 679 315 722T0 753Z" fill={p.treesBack} />
      <path
        d="M1600 615Q1450 587 1315 634T1076 664L976 681Q1220 680 1377 733L1600 767Z"
        fill={p.treesBack}
      />
      <path d={TREES_BACK} fill={p.treesBack} />
      <path d={TREES} fill={p.trees} />
      <path
        d="M0 737Q164 689 310 737T570 783Q747 816 918 804T1167 756Q1404 701 1600 751V850H0Z"
        fill={fill("meadow")}
      />
      <path
        d="M0 776Q175 739 331 776T612 822M1128 803Q1382 738 1600 787"
        fill="none"
        stroke={p.glow}
        strokeWidth="3"
        opacity="0.18"
      />
      <path d={FOREGROUND} fill={p.front} />
      <g fill={p.glow} opacity={night ? "0.3" : "0.85"}>
        {FLOWERS.map((f) => (
          <circle key={f.x} cx={f.x} cy={f.y} r={f.size} />
        ))}
      </g>
      <g fill="none" stroke={p.treesBack} strokeWidth="1" opacity="0.5">
        {FLOWERS.slice(0, 45).map((f) => (
          <path key={f.x} d={`M${f.x} ${f.y + 7}l-2 -9m2 9 3 -6`} />
        ))}
      </g>
    </svg>
  );
}

export function PinesFallback({ className }: { className?: string }) {
  const uid = useId();
  const trees = [
    [82, 405, 156],
    [137, 393, 251],
    [205, 395, 339],
    [266, 401, 260],
    [322, 414, 175],
  ] as const;
  return (
    <svg aria-hidden className={className} viewBox="0 0 400 480">
      <defs>
        <linearGradient id={`${uid}-trees`} x2="1" y2="0.6">
          <stop stopColor="#52745b" />
          <stop offset="1" stopColor="#254b3e" />
        </linearGradient>
        <radialGradient id={`${uid}-grass`}>
          <stop stopColor="#c2cc8d" stopOpacity="0.85" />
          <stop offset="0.6" stopColor="#c2cc8d" stopOpacity="0.45" />
          <stop offset="1" stopColor="#a0b270" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="200" cy="415" rx="198" ry="62" fill={`url(#${uid}-grass)`} />
      <path
        d={trees.map(([x, y, h], i) => pine(x, y, h, i + 13)).join(" ")}
        fill={`url(#${uid}-trees)`}
      />
      <path d={pine(178, 415, 226, 5)} fill="#355e49" />
      <g fill="#fff9eb">
        {[54, 96, 128, 207, 254, 295, 341].map((x, i) => (
          <circle key={x} cx={x} cy={416 + (i % 3) * 8} r="1.8" />
        ))}
      </g>
    </svg>
  );
}

const CLOUD_COLORS = {
  peach: ["#fff5eb", "#f6d8c6", "#dbcee5"],
  lavender: ["#f9f2f4", "#e7d9eb", "#ccc9e4"],
} as const;

export function CloudFallback({
  tone,
  className,
}: {
  tone: keyof typeof CLOUD_COLORS;
  className?: string;
}) {
  const uid = useId();
  const colors = CLOUD_COLORS[tone];
  const style: CSSProperties = {
    background: `radial-gradient(ellipse at 50% 65%, ${colors[1]}66, transparent 65%)`,
  };
  return (
    <div aria-hidden className={className} style={style}>
      <svg aria-hidden viewBox="0 0 480 210" className="h-full w-full overflow-visible" fill="none">
        <defs>
          <linearGradient id={`${uid}-cloud`} x2="0.2" y2="1">
            {colors.map((color, i) => (
              <stop key={color} stopColor={color} offset={i / 2} />
            ))}
          </linearGradient>
          <filter id={`${uid}-soft`} x="-15%" y="-25%" width="130%" height="150%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <g filter={`url(#${uid}-soft)`}>
          <path
            d="M27 152Q5 128 45 116Q38 89 75 86Q69 57 109 63Q125 22 161 47Q179 8 214 37Q242 15 262 52Q304 26 322 65Q359 51 368 85Q415 70 423 106Q465 104 455 134Q486 153 445 167Q346 186 250 177Q132 188 44 170Q5 168 27 152Z"
            fill={`url(#${uid}-cloud)`}
          />
          <path
            d="M65 128Q96 109 124 123Q144 99 175 116Q215 97 247 119Q285 105 310 126Q365 109 412 137"
            stroke={colors[0]}
            strokeWidth="16"
            opacity="0.45"
            strokeLinecap="round"
          />
          <path
            d="M59 154Q140 139 216 154T414 150"
            stroke={colors[2]}
            strokeWidth="16"
            opacity="0.24"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
}

/** Missing or unreadable artwork keeps its vector fallback. */
export function SceneryImage({
  src,
  fallback,
  className,
  sizes,
  priority = false,
  objectPosition = "bottom",
  fit = "cover",
}: {
  src: string | null;
  fallback: ReactNode;
  className?: string;
  sizes: string;
  priority?: boolean;
  objectPosition?: string;
  fit?: "cover" | "contain";
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!src || src === failedSource) return fallback;
  return (
    <div className={`${className?.includes("absolute") ? "" : "relative"} ${className ?? ""}`}>
      <Image
        src={src}
        alt=""
        aria-hidden
        fill
        sizes={sizes}
        preload={priority}
        onError={() => setFailedSource(src)}
        style={{ objectFit: fit, objectPosition }}
      />
    </div>
  );
}
