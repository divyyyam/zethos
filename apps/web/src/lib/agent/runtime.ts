// The in-browser agent: compiles intents into plans, then senses, prices, verifies, guards, settles
// and measures. Everything it reports comes from an engine response or the user's own words.
// It only ever paper-fills. It holds no key, and a live quote is not something it can settle.
import {
  type Fill,
  type PairStatus,
  type PaperQuote,
  type PriceBreakdown,
  type QuoteRequest,
  type Status,
  type Zethos,
  ZethosError,
} from "@zethos/sdk";
import { type Address, formatUnits, parseUnits } from "viem";
import { failureMessage } from "../engine/sdk";
import { type Intent, parseIntent, type SwapIntent, type Trigger } from "./intent";

type Pair = PairStatus["pair"];
export const STAGES = ["sense", "price", "verify", "guard", "settle", "measure"] as const;
export type Stage = (typeof STAGES)[number];
export type StageState = "idle" | "active" | "done" | "failed" | "skipped";

export type MissionStatus =
  | "draft"
  | "armed"
  | "running"
  | "holding"
  | "measuring"
  | "done"
  | "stopped"
  | "failed";

export const DEFAULT_MAX_COST_BPS = 150;
export const DEFAULT_HOLD_MS = 60_000;
export const DEFAULT_TRIGGER_MS = 15 * 60_000;
export const MARKOUT_HORIZONS = [1, 5, 30] as const;
/** The engine's smallest swap is $5; slices stay clear of it so a mid move can't strand one. */
const MIN_SLICE_USD = 6;
const HOLD_RETRY_MS = 5_000;
const TRIGGER_TICK_MS = 1_000;
const FEED_STALE_MS = 15_000;
const STATUS_POLL_MS = 3_000;
const HISTORY_POINTS = 600;
const VENUE_POINTS = 120;
const TAPE_ROWS = 30;
const LADDER_USD = [100, 500, 2_000, 10_000, 25_000];

export interface Plan {
  pair: Pair;
  side: "buy" | "sell";
  soldSymbol: string;
  boughtSymbol: string;
  soldDecimals: number;
  boughtDecimals: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  /** True when the user sized the other token, so the input is a conversion at the live price. */
  approximate: boolean;
  sliceAmounts: string[];
  intervalMs: number;
  estOut: number | null;
  estUsd: number | null;
  maxCostBps: number;
  holdMs: number;
  trigger: Trigger | null;
  triggerMs: number;
  notes: string[];
}

export interface SliceRun {
  index: number;
  amountIn: string;
  state: "pending" | "active" | "filled" | "failed" | "skipped";
  fill: Fill | null;
  paid: number | null;
  received: number | null;
  price: number | null;
  vsMidBps: number | null;
  markouts: Partial<Record<(typeof MARKOUT_HORIZONS)[number], number>>;
}

export interface TriggerRun {
  label: string;
  targetPrice: number;
  direction: "below" | "above";
  referenceMid: number;
  currentMid: number;
  expiresAt: number;
  firedAt: number | null;
}

export interface LogLine {
  t: number;
  text: string;
  tone: "info" | "good" | "warn" | "bad";
}

export type Report =
  | { type: "market"; pairs: PairStatus[]; equityUsd: number | null; riskState: string }
  | {
      type: "explain";
      pair: Pair;
      usd: number;
      vsMidBps: number;
      ttlSec: number;
      breakdown: PriceBreakdown;
    }
  | {
      type: "ladder";
      pair: Pair;
      rungs: { usd: number; costBps: number | null; ttlSec: number | null; note: string | null }[];
    }
  | {
      type: "position";
      rows: {
        pair: Pair;
        baseSymbol: string;
        net: number;
        quoteFlow: number;
        mid: number | null;
        pnlUsd: number | null;
        fills: number;
      }[];
      truncated: boolean;
    }
  | { type: "help" }
  | { type: "notice"; title: string; detail: string };

export interface Mission {
  id: string;
  text: string;
  createdAt: number;
  taker: Address;
  status: MissionStatus;
  plan: Plan | null;
  dryRun: boolean;
  report: Report | null;
  stages: Record<Stage, { state: StageState; detail: string | null }>;
  slices: SliceRun[];
  trigger: TriggerRun | null;
  log: LogLine[];
  /** The most recent priced quote, for "why this price". */
  quote: {
    vsMidBps: number;
    ttlSec: number;
    expiresAt: number;
    out: number;
    breakdown: PriceBreakdown;
    signature: string;
    nonce: string;
    id: string;
  } | null;
  arrivalMid: number | null;
  nextSliceAt: number | null;
  error: string | null;
}

export type Connection = "unconfigured" | "connecting" | "live" | "polling" | "offline";
export interface MarketState {
  connection: Connection;
  status: Status | null;
  /** Failure of the most recent status read, shown as a failure while the stale numbers grey out. */
  error: string | null;
  updatedAt: number;
  history: Partial<Record<Pair, { t: number; mid: number }[]>>;
  venues: Partial<Record<Pair, Record<string, { t: number; bps: number }[]>>>;
  tape: Fill[];
}

export type AgentSdk = Pick<
  Zethos,
  "status" | "quote" | "verifyQuote" | "paperFill" | "fills" | "stats" | "stream"
>;
export interface AgentDeps {
  sdk: AgentSdk | null;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollMs?: number;
}

export interface Submitted {
  /** Why the sentence was refused, when it was. */
  refusal: string | null;
  missions: Mission[];
}

const ACTIVE: MissionStatus[] = ["armed", "running", "holding", "measuring"];
export function isActive(status: MissionStatus): boolean {
  return ACTIVE.includes(status);
}
const STOPPABLE: MissionStatus[] = ["armed", "running", "holding"];
export function isStoppable(status: MissionStatus): boolean {
  return STOPPABLE.includes(status);
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

function decimalString(value: number, decimals: number): string {
  return value.toFixed(Math.min(decimals, 8));
}

export function formatToken(value: number): string {
  const digits = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}
export function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value < 1 ? 5 : 2,
    maximumFractionDigits: value < 1 ? 5 : 2,
  }).format(value);
}
export function formatBps(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} bps`;
}

function targetOf(trigger: Trigger, mid: number): { price: number; direction: "below" | "above" } {
  if ("price" in trigger) return { price: trigger.price, direction: trigger.type };
  const drop = trigger.type === "drop";
  return {
    price: mid * (1 + ((drop ? -1 : 1) * trigger.pct) / 100),
    direction: drop ? "below" : "above",
  };
}
function triggerLabel(trigger: Trigger, target: number): string {
  if (trigger.type === "drop") return `mid drops ${trigger.pct}% to ${formatPrice(target)}`;
  if (trigger.type === "rise") return `mid rises ${trigger.pct}% to ${formatPrice(target)}`;
  return `mid is ${trigger.type} ${formatPrice(target)}`;
}

/** Sizes a swap intent against live market data. Returns a refusal string if it can't be run. */
export function compilePlan(intent: SwapIntent, pair: PairStatus): Plan | string {
  const { base, quote, mid, halfSpread } = pair;
  if (mid === null || pair.halted)
    return `${pair.pair} isn’t priced right now, so I can’t size it.`;
  const buy = intent.side === "buy";
  const [sold, bought] = buy ? [quote, base] : [base, quote];
  const ask = mid * (1 + (halfSpread?.buy ?? 0));
  const bid = mid * (1 - (halfSpread?.sell ?? 0));
  const sizedInSold = buy ? intent.amountIn === "quote" : intent.amountIn === "base";
  const stated = Number(intent.amount);
  const human = sizedInSold
    ? intent.amount
    : decimalString(buy ? stated * ask : stated / bid, sold.decimals);
  let total: bigint;
  try {
    total = parseUnits(human, sold.decimals);
  } catch {
    return `That ${sold.symbol} amount has too many decimal places.`;
  }
  if (total <= 0n) return "That amount rounds to nothing.";
  const amount = Number(formatUnits(total, sold.decimals));
  const estOut = buy ? amount / ask : amount * bid;
  const estUsd = buy ? amount : amount * mid;
  const notes: string[] = [];
  let count = intent.slices?.count ?? 1;
  if (count > 1 && estUsd / count < MIN_SLICE_USD) {
    const fitted = Math.floor(estUsd / MIN_SLICE_USD);
    if (fitted < 2) return `$${estUsd.toFixed(2)} is too small to slice. Run it as one swap.`;
    notes.push(`Reduced to ${fitted} slices so each one clears the $5 minimum.`);
    count = fitted;
  }
  if (estUsd < 5) return `Minimum swap is $5. This is about $${estUsd.toFixed(2)}.`;
  const each = total / BigInt(count);
  const sliceAmounts = Array.from({ length: count }, (_, index) =>
    (index === count - 1 ? total - each * BigInt(count - 1) : each).toString(),
  );
  if (!sizedInSold)
    notes.push(`You sized the ${bought.symbol} side, so ${sold.symbol} in is a live conversion.`);
  return {
    pair: pair.pair,
    side: intent.side,
    soldSymbol: sold.symbol,
    boughtSymbol: bought.symbol,
    soldDecimals: sold.decimals,
    boughtDecimals: bought.decimals,
    tokenIn: sold.address,
    tokenOut: bought.address,
    amountIn: total.toString(),
    approximate: !sizedInSold,
    sliceAmounts,
    intervalMs: count > 1 ? (intent.slices?.durationMs ?? 0) / (count - 1) : 0,
    estOut,
    estUsd,
    maxCostBps: intent.maxCostBps ?? DEFAULT_MAX_COST_BPS,
    holdMs: intent.expiresInMs ?? DEFAULT_HOLD_MS,
    trigger: intent.trigger,
    triggerMs: intent.expiresInMs ?? DEFAULT_TRIGGER_MS,
    notes,
  };
}

export class AgentRuntime {
  private missions: Mission[] = [];
  private market: MarketState;
  private readonly listeners = new Set<() => void>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly sdk: AgentSdk | null;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly pollMs: number;
  private retained = 0;
  private disconnect: (() => void) | null = null;
  private counter = 0;

  constructor(deps: AgentDeps) {
    this.sdk = deps.sdk;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? abortableSleep;
    this.pollMs = deps.pollMs ?? STATUS_POLL_MS;
    this.market = {
      connection: deps.sdk ? "connecting" : "unconfigured",
      status: null,
      error: null,
      updatedAt: 0,
      history: {},
      venues: {},
      tape: [],
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getMissions = () => this.missions;
  getMarket = () => this.market;

  /** Keeps the live feed open while a page is watching. Running missions keep it open too. */
  retain(): () => void {
    this.retained += 1;
    this.connect();
    return () => {
      this.retained -= 1;
      this.releaseFeedIfIdle();
    };
  }

  private releaseFeedIfIdle(): void {
    if (this.retained > 0 || this.missions.some((mission) => isActive(mission.status))) return;
    this.disconnect?.();
    this.disconnect = null;
  }

  private connect(): void {
    if (!this.sdk || this.disconnect) return;
    const sdk = this.sdk;
    let open = false;
    const controller = new AbortController();
    const poll = async () => {
      while (!controller.signal.aborted) {
        await this.refreshStatus();
        if (open && this.market.connection === "polling") this.setMarket({ connection: "live" });
        await this.sleep(this.pollMs, controller.signal);
      }
    };
    void poll();
    void this.seed();
    const unsubscribe = sdk.stream({
      onOpen: () => {
        open = true;
        this.setMarket({ connection: "live" });
      },
      onClose: () => {
        open = false;
        if (this.market.connection === "live") this.setMarket({ connection: "polling" });
      },
      price: ({ pair, mid, ts }) => {
        if (mid !== null) this.pushMid(pair, mid, ts);
      },
      fill: ({ fill }) => {
        this.setMarket({
          tape: [fill, ...this.market.tape.filter((row) => row.id !== fill.id)].slice(0, TAPE_ROWS),
        });
      },
    });
    this.disconnect = () => {
      controller.abort();
      unsubscribe();
    };
  }

  private async seed(): Promise<void> {
    if (!this.sdk) return;
    try {
      const tape = await this.sdk.fills({ limit: TAPE_ROWS });
      const known = new Set(this.market.tape.map((row) => row.id));
      this.setMarket({
        tape: [...this.market.tape, ...tape.filter((row) => !known.has(row.id))].slice(
          0,
          TAPE_ROWS,
        ),
      });
    } catch {
      /* The tape fills in from the stream; a failed backfill leaves it empty, not fabricated. */
    }
    const since = this.now() - 15 * 60_000;
    for (const pair of ["HSK/USDT", "ETH/USDT"] as const) {
      try {
        const { series } = await this.sdk.stats({ pair, from: since, to: this.now() });
        const recent = this.market.history[pair] ?? [];
        const first = recent[0]?.t ?? Number.POSITIVE_INFINITY;
        this.setMarket({
          history: {
            ...this.market.history,
            [pair]: [...series.filter((point) => point.t < first), ...recent].slice(
              -HISTORY_POINTS,
            ),
          },
        });
      } catch {
        /* History starts from now instead. */
      }
    }
  }

  private async refreshStatus(): Promise<Status | null> {
    if (!this.sdk) return null;
    try {
      const status = await this.sdk.status();
      const at = this.now();
      const venues = { ...this.market.venues };
      for (const pair of status.pairs) {
        if (pair.mid === null) continue;
        const traces = { ...(venues[pair.pair] ?? {}) };
        for (const source of pair.sources) {
          if (source.status !== "ok") continue;
          traces[source.venue] = [
            ...(traces[source.venue] ?? []),
            { t: at, bps: (source.mid / pair.mid - 1) * 10_000 },
          ].slice(-VENUE_POINTS);
        }
        venues[pair.pair] = traces;
        this.pushMid(pair.pair, pair.mid, pair.updatedAt ?? at);
      }
      this.setMarket({
        status,
        venues,
        error: null,
        updatedAt: at,
        connection: this.market.connection === "live" ? "live" : "polling",
      });
      return status;
    } catch (error) {
      this.setMarket({ error: failureMessage(error), connection: "offline" });
      return null;
    }
  }

  private pushMid(pair: Pair, mid: number, t: number): void {
    const series = this.market.history[pair] ?? [];
    const last = series.at(-1);
    if (last && t <= last.t) return;
    this.setMarket({
      updatedAt: this.now(),
      history: {
        ...this.market.history,
        [pair]: [...series, { t, mid }].slice(-HISTORY_POINTS),
      },
    });
  }

  private setMarket(next: Partial<MarketState>): void {
    this.market = { ...this.market, ...next };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private latestMid(pair: Pair): number | null {
    if (this.now() - this.market.updatedAt > FEED_STALE_MS) return null;
    return this.market.history[pair]?.at(-1)?.mid ?? null;
  }

  private pairStatus(pair: Pair): PairStatus | null {
    return this.market.status?.pairs.find((row) => row.pair === pair) ?? null;
  }

  /** Reads a sentence. Reads run at once; a swap becomes a draft that waits for authorization. */
  submit(text: string, taker: Address): Submitted {
    const { intent } = parseIntent(text);
    return this.submitIntent(text,taker,intent);
  }

  /** A language interpretation still passes through the same plan limits and consent gate. */
  submitIntent(text:string,taker:Address,intent:Intent):Submitted {
    if (intent.kind === "unknown") return { refusal: intent.reason, missions: [] };
    if (!this.sdk)
      return { refusal: "The engine isn’t connected, so I can’t act on this yet.", missions: [] };
    if (intent.kind === "stop") {
      const stopped = this.stopAll();
      return {
        refusal: null,
        missions: [
          this.addReport(text, taker, {
            type: "notice",
            title: stopped
              ? `Stopped ${stopped} mission${stopped === 1 ? "" : "s"}`
              : "Nothing running",
            detail: stopped
              ? "Fills that already settled stay settled. Nothing new will be priced for them."
              : "No armed or running missions to stop.",
          }),
        ],
      };
    }
    if (intent.kind === "help") {
      return { refusal: null, missions: [this.addReport(text, taker, { type: "help" })] };
    }
    if (intent.kind === "swap") {
      const pair = this.pairStatus(intent.pair);
      if (!pair)
        return {
          refusal: "Waiting for the first market read. Try again in a moment.",
          missions: [],
        };
      const plan = compilePlan(intent, pair);
      if (typeof plan === "string") return { refusal: plan, missions: [] };
      return { refusal: null, missions: [this.addDraft(text, taker, plan, intent.dryRun)] };
    }
    const mission = this.addPendingReport(text, taker);
    void this.runRead(mission.id, intent, taker);
    return { refusal: null, missions: [mission] };
  }

  /** Runs a draft. Authorization covers exactly the limits shown on it. */
  authorize(id: string): void {
    const mission = this.find(id);
    if (mission?.status !== "draft" || !mission.plan || !this.sdk) return;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.connect();
    void this.runSwap(id, mission.plan, mission.dryRun, controller.signal).finally(() => {
      this.controllers.delete(id);
      this.releaseFeedIfIdle();
    });
  }

  discard(id: string): void {
    this.missions = this.missions.filter(
      (mission) => mission.id !== id || mission.status !== "draft",
    );
    this.emit();
  }

  dismiss(id: string): void {
    this.missions = this.missions.filter(
      (mission) => mission.id !== id || isActive(mission.status),
    );
    this.emit();
  }

  stop(id: string): void {
    const mission = this.find(id);
    if (!mission || !isStoppable(mission.status)) return;
    this.controllers.get(id)?.abort();
  }

  stopAll(): number {
    const running = this.missions.filter((mission) => isStoppable(mission.status));
    for (const mission of running) this.stop(mission.id);
    return running.length;
  }

  private find(id: string): Mission | undefined {
    return this.missions.find((mission) => mission.id === id);
  }

  private patch(id: string, change: (mission: Mission) => Partial<Mission>): void {
    this.missions = this.missions.map((mission) =>
      mission.id === id ? { ...mission, ...change(mission) } : mission,
    );
    this.emit();
  }

  private stage(id: string, stage: Stage, state: StageState, detail?: string): void {
    this.patch(id, (mission) => ({
      stages: {
        ...mission.stages,
        [stage]: { state, detail: detail ?? mission.stages[stage].detail },
      },
    }));
  }

  private log(id: string, text: string, tone: LogLine["tone"] = "info"): void {
    const line = { t: this.now(), text, tone };
    this.patch(id, (mission) => ({ log: [...mission.log, line] }));
  }

  private blank(text: string, taker: Address): Mission {
    return {
      id: `m${++this.counter}_${this.now().toString(36)}`,
      text,
      createdAt: this.now(),
      taker,
      status: "running",
      plan: null,
      dryRun: false,
      report: null,
      stages: Object.fromEntries(
        STAGES.map((stage) => [stage, { state: "idle", detail: null }]),
      ) as Mission["stages"],
      slices: [],
      trigger: null,
      log: [],
      quote: null,
      arrivalMid: null,
      nextSliceAt: null,
      error: null,
    };
  }

  private add(mission: Mission): Mission {
    this.missions = [mission, ...this.missions].slice(0, 30);
    this.emit();
    return mission;
  }

  private addDraft(text: string, taker: Address, plan: Plan, dryRun: boolean): Mission {
    return this.add({
      ...this.blank(text, taker),
      status: "draft",
      plan,
      dryRun,
      slices: plan.sliceAmounts.map((amountIn, index) => ({
        index,
        amountIn,
        state: "pending",
        fill: null,
        paid: null,
        received: null,
        price: null,
        vsMidBps: null,
        markouts: {},
      })),
    });
  }

  private addReport(text: string, taker: Address, report: Report): Mission {
    return this.add({ ...this.blank(text, taker), status: "done", report });
  }

  private addPendingReport(text: string, taker: Address): Mission {
    return this.add(this.blank(text, taker));
  }

  private async runRead(
    id: string,
    intent: Exclude<Intent, SwapIntent | { kind: "unknown" | "stop" | "help" }>,
    taker: Address,
  ): Promise<void> {
    if (!this.sdk) return;
    try {
      if (intent.kind === "flatten") {
        await this.flatten(id, intent.pair, taker);
        return;
      }
      const report = await this.readReport(intent, taker);
      this.patch(id, () => ({ status: "done", report }));
    } catch (error) {
      this.patch(id, () => ({ status: "failed", error: failureMessage(error) }));
    }
  }

  private async readReport(
    intent: Exclude<Intent, SwapIntent | { kind: "unknown" | "stop" | "help" | "flatten" }>,
    taker: Address,
  ): Promise<Report> {
    const sdk = this.sdk as AgentSdk;
    if (intent.kind === "market") {
      const status = await sdk.status();
      return {
        type: "market",
        pairs: status.pairs.filter((row) => !intent.pair || row.pair === intent.pair),
        equityUsd: status.equityUsd,
        riskState: status.riskState,
      };
    }
    if (intent.kind === "position") return this.position(taker);
    const status = await sdk.status();
    const pair = status.pairs.find((row) => row.pair === intent.pair);
    if (!pair) throw new ZethosError("invalid_request", `${intent.pair} isn’t enabled.`);
    const request = (usd: number): QuoteRequest => ({
      taker,
      tokenIn: pair.quote.address,
      tokenOut: pair.base.address,
      amountIn: parseUnits(String(usd), pair.quote.decimals).toString(),
    });
    if (intent.kind === "explain") {
      const usd = 500;
      const quote = await sdk.quote(request(usd));
      if (quote.route !== "paper") throw new ZethosError("wrong_mode", "No paper quote available");
      return {
        type: "explain",
        pair: pair.pair,
        usd,
        vsMidBps: quote.vsMidBps,
        ttlSec: quote.breakdown.ttlSec,
        breakdown: quote.breakdown,
      };
    }
    const rungs: Extract<Report, { type: "ladder" }>["rungs"] = [];
    for (const usd of LADDER_USD) {
      try {
        const quote = await sdk.quote(request(usd));
        rungs.push(
          quote.route === "paper"
            ? { usd, costBps: quote.vsMidBps, ttlSec: quote.breakdown.ttlSec, note: null }
            : { usd, costBps: null, ttlSec: null, note: "No signed route" },
        );
      } catch (error) {
        rungs.push({ usd, costBps: null, ttlSec: null, note: failureMessage(error) });
      }
    }
    return { type: "ladder", pair: pair.pair, rungs };
  }

  private async position(taker: Address): Promise<Report> {
    const sdk = this.sdk as AgentSdk;
    const [status, fills] = await Promise.all([sdk.status(), sdk.fills({ taker, limit: 100 })]);
    const rows = status.pairs.map((pair) => {
      const mine = fills.filter((fill) => fill.pair === pair.pair);
      let net = 0;
      let quoteFlow = 0;
      for (const fill of mine) {
        const [baseRaw, quoteRaw] =
          fill.side === "buy" ? [fill.amountOut, fill.amountIn] : [fill.amountIn, fill.amountOut];
        const sign = fill.side === "buy" ? 1 : -1;
        net += sign * Number(formatUnits(BigInt(baseRaw), pair.base.decimals));
        quoteFlow -= sign * Number(formatUnits(BigInt(quoteRaw), pair.quote.decimals));
      }
      return {
        pair: pair.pair,
        baseSymbol: pair.base.symbol,
        net,
        quoteFlow,
        mid: pair.mid,
        pnlUsd: pair.mid === null ? null : net * pair.mid + quoteFlow,
        fills: mine.length,
      };
    });
    return { type: "position", rows, truncated: fills.length >= 100 };
  }

  private async flatten(id: string, pair: Pair | null, taker: Address): Promise<void> {
    const report = await this.position(taker);
    if (report.type !== "position") return;
    const open = report.rows.filter(
      (row) => (!pair || row.pair === pair) && row.mid !== null && Math.abs(row.net * row.mid) >= 5,
    );
    if (open.length === 0) {
      this.patch(id, () => ({
        status: "done",
        report: {
          type: "notice",
          title: "Nothing to flatten",
          detail: "This identity holds no position worth $5 or more.",
        },
      }));
      return;
    }
    this.missions = this.missions.filter((mission) => mission.id !== id);
    for (const row of open) {
      const intent: SwapIntent = {
        kind: "swap",
        pair: row.pair,
        side: row.net > 0 ? "sell" : "buy",
        amount: decimalString(Math.abs(row.net), 18),
        amountIn: "base",
        dryRun: false,
        slices: null,
        trigger: null,
        maxCostBps: null,
        expiresInMs: null,
      };
      const status = this.pairStatus(row.pair);
      const plan = status ? compilePlan(intent, status) : "Waiting for the first market read.";
      if (typeof plan === "string") {
        this.addReport(`Flatten ${row.pair}`, taker, {
          type: "notice",
          title: `Can’t flatten ${row.pair}`,
          detail: plan,
        });
      } else {
        this.addDraft(
          `Flatten ${row.baseSymbol}: ${row.net > 0 ? "sell" : "buy back"} ${formatToken(Math.abs(row.net))}`,
          taker,
          plan,
          false,
        );
      }
    }
    this.emit();
  }

  private finish(
    id: string,
    status: "done" | "stopped" | "failed",
    error: string | null = null,
  ): void {
    this.patch(id, (mission) => ({
      status,
      error,
      nextSliceAt: null,
      stages: Object.fromEntries(
        STAGES.map((stage) => {
          const current = mission.stages[stage];
          return [
            stage,
            current.state === "active"
              ? { ...current, state: status === "failed" ? "failed" : "skipped" }
              : current,
          ];
        }),
      ) as Mission["stages"],
    }));
  }

  private async runSwap(
    id: string,
    plan: Plan,
    dryRun: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    if (plan.trigger) {
      this.patch(id, () => ({ status: "armed" }));
      const fired = await this.watchTrigger(id, plan, plan.trigger, signal);
      if (!fired) return;
    }
    this.patch(id, () => ({ status: "running", arrivalMid: this.latestMid(plan.pair) }));
    const measures: Promise<void>[] = [];
    for (let index = 0; index < plan.sliceAmounts.length; index += 1) {
      if (signal.aborted) return this.stopped(id);
      const outcome = await this.runSlice(id, plan, index, dryRun, signal, measures);
      if (outcome !== "filled") {
        this.markRemaining(id, index);
        if (outcome === "aborted") return this.stopped(id);
        if (outcome === "previewed") {
          this.log(id, "Dry run: priced and verified. Nothing was filled.", "good");
          return this.finish(id, "done");
        }
        return; // runSlice already recorded the failure.
      }
      if (index < plan.sliceAmounts.length - 1) {
        const at = this.now() + plan.intervalMs;
        this.patch(id, () => ({ nextSliceAt: at, status: "running" }));
        await this.sleep(plan.intervalMs, signal);
        this.patch(id, () => ({ nextSliceAt: null }));
        if (signal.aborted) {
          this.markRemaining(id, index + 1);
          return this.stopped(id);
        }
      }
    }
    this.patch(id, () => ({ status: "measuring" }));
    this.stage(id, "measure", "active");
    await Promise.all(measures);
    this.stage(id, "measure", "done");
    this.log(id, "Measured price after the fill at 1 s, 5 s and 30 s.", "good");
    this.finish(id, "done");
  }

  private stopped(id: string): void {
    this.log(id, "Stopped by you. Anything already filled stays filled.", "warn");
    this.finish(id, "stopped");
  }

  private markRemaining(id: string, from: number): void {
    this.patch(id, (mission) => ({
      slices: mission.slices.map((slice) =>
        slice.index >= from && (slice.state === "pending" || slice.state === "active")
          ? { ...slice, state: "skipped" }
          : slice,
      ),
    }));
  }

  private async watchTrigger(
    id: string,
    plan: Plan,
    trigger: Trigger,
    signal: AbortSignal,
  ): Promise<boolean> {
    let reference = this.latestMid(plan.pair);
    while (reference === null) {
      if (signal.aborted) {
        this.stopped(id);
        return false;
      }
      await this.sleep(TRIGGER_TICK_MS, signal);
      reference = this.latestMid(plan.pair);
    }
    const { price, direction } = targetOf(trigger, reference);
    const expiresAt = this.now() + plan.triggerMs;
    const label = triggerLabel(trigger, price);
    this.patch(id, () => ({
      trigger: {
        label,
        targetPrice: price,
        direction,
        referenceMid: reference as number,
        currentMid: reference as number,
        expiresAt,
        firedAt: null,
      },
    }));
    this.log(id, `Armed: acts when ${label}. Reference mid ${formatPrice(reference)}.`);
    while (true) {
      if (signal.aborted) {
        this.stopped(id);
        return false;
      }
      if (this.now() >= expiresAt) {
        this.log(id, "The trigger expired without firing. Nothing was filled.", "warn");
        this.finish(id, "stopped");
        return false;
      }
      // A stale feed reads as null: it can't fire a trigger, and it can't clear one either.
      const mid = this.latestMid(plan.pair);
      if (mid !== null) {
        this.patch(id, (mission) =>
          mission.trigger ? { trigger: { ...mission.trigger, currentMid: mid } } : {},
        );
        if (direction === "below" ? mid <= price : mid >= price) {
          this.patch(id, (mission) =>
            mission.trigger ? { trigger: { ...mission.trigger, firedAt: this.now() } } : {},
          );
          this.log(id, `Trigger fired at mid ${formatPrice(mid)}.`, "good");
          return true;
        }
      }
      await this.sleep(TRIGGER_TICK_MS, signal);
    }
  }

  private async runSlice(
    id: string,
    plan: Plan,
    index: number,
    dryRun: boolean,
    signal: AbortSignal,
    measures: Promise<void>[],
  ): Promise<"filled" | "failed" | "aborted" | "previewed"> {
    const sdk = this.sdk as AgentSdk;
    const label =
      plan.sliceAmounts.length > 1 ? `Slice ${index + 1}/${plan.sliceAmounts.length}: ` : "";
    const fail = (stage: Stage, text: string): "failed" => {
      this.stage(id, stage, "failed", text);
      this.setSlice(id, index, { state: "failed" });
      this.log(id, `${label}${text}`, "bad");
      this.finish(id, "failed", text);
      return "failed";
    };
    this.setSlice(id, index, { state: "active" });
    const request: QuoteRequest = {
      taker: (this.find(id) as Mission).taker,
      tokenIn: plan.tokenIn,
      tokenOut: plan.tokenOut,
      amountIn: plan.sliceAmounts[index] as string,
    };
    const holdUntil = this.now() + plan.holdMs;
    let expiredRetries = 1;

    while (true) {
      if (signal.aborted) return "aborted";

      this.stage(id, "sense", "active");
      let status: Status;
      try {
        status = await sdk.status();
      } catch (error) {
        return fail("sense", failureMessage(error));
      }
      if (signal.aborted) return "aborted";
      if (status.mode !== "shadow")
        return fail(
          "sense",
          "Agent execution is paper-only. Use the swap page to sign live fills.",
        );
      if (status.paused) return fail("sense", "The vault is paused.");
      const pair = status.pairs.find((row) => row.pair === plan.pair);
      if (!pair || pair.halted || pair.mid === null)
        return fail("sense", `${plan.pair} is halted: no healthy price source.`);
      const healthy = pair.sources.filter((source) => source.status === "ok").length;
      this.stage(
        id,
        "sense",
        "done",
        `${healthy}/${pair.sources.length} venues · mid ${formatPrice(pair.mid)}`,
      );
      if (healthy < pair.sources.length)
        this.log(
          id,
          `${label}${pair.sources.length - healthy} price source(s) excluded from the mid.`,
          "warn",
        );

      this.stage(id, "price", "active");
      let quote: PaperQuote;
      try {
        const response = await sdk.quote(request);
        if (response.route !== "paper")
          return fail(
            "price",
            "The engine offered a non-paper route, which this agent can’t settle.",
          );
        quote = response;
      } catch (error) {
        return fail("price", failureMessage(error));
      }
      if (signal.aborted) return "aborted";
      const out = Number(formatUnits(BigInt(quote.paperOut), plan.boughtDecimals));
      const price =
        plan.side === "buy"
          ? Number(formatUnits(BigInt(request.amountIn), plan.soldDecimals)) / out
          : out / Number(formatUnits(BigInt(request.amountIn), plan.soldDecimals));
      this.patch(id, () => ({
        quote: {
          vsMidBps: quote.vsMidBps,
          ttlSec: quote.breakdown.ttlSec,
          expiresAt: quote.expiresAt,
          out,
          breakdown: quote.breakdown,
          signature: quote.signature,
          nonce: quote.quote.nonce,
          id: quote.id,
        },
      }));
      this.stage(id, "price", "done", `${formatPrice(price)} · ${quote.breakdown.ttlSec}s firm`);
      this.log(
        id,
        `${label}Quote ${quote.id.slice(0, 14)} at ${formatPrice(price)}, ${quote.vsMidBps.toFixed(1)} bps from mid.`,
      );

      this.stage(id, "verify", "active");
      const verification = await sdk.verifyQuote(quote, request).catch((error: unknown) => error);
      if (verification instanceof Error) return fail("verify", failureMessage(verification));
      const checked = verification as Awaited<ReturnType<AgentSdk["verifyQuote"]>>;
      if (signal.aborted) return "aborted";
      if (!checked.ok) {
        // A quote that aged out while we looked at it is safe to re-price. Anything else is not.
        if (
          checked.reasons.length === 1 &&
          checked.reasons[0] === "expired" &&
          expiredRetries > 0
        ) {
          expiredRetries -= 1;
          this.log(id, `${label}Quote aged out before settling. Re-pricing once.`, "warn");
          continue;
        }
        return fail("verify", `Refused the quote: ${checked.reasons.join(", ")}.`);
      }
      this.stage(id, "verify", "done", "Signature and terms match");
      this.log(
        id,
        `${label}Checked locally: signer, taker, pair, amount, expiry and price sanity.`,
        "good",
      );

      this.stage(id, "guard", "active");
      if (quote.vsMidBps > plan.maxCostBps) {
        if (this.now() + HOLD_RETRY_MS > holdUntil) {
          return fail(
            "guard",
            `Cost stayed at ${quote.vsMidBps.toFixed(1)} bps, above your ${plan.maxCostBps} bps limit. Nothing was filled.`,
          );
        }
        this.patch(id, () => ({ status: "holding" }));
        this.stage(
          id,
          "guard",
          "active",
          `${quote.vsMidBps.toFixed(1)} bps > ${plan.maxCostBps} bps`,
        );
        this.log(
          id,
          `${label}Holding: ${quote.vsMidBps.toFixed(1)} bps is above your ${plan.maxCostBps} bps limit.`,
          "warn",
        );
        await this.sleep(HOLD_RETRY_MS, signal);
        continue;
      }
      this.patch(id, () => ({ status: "running" }));
      this.stage(id, "guard", "done", `${quote.vsMidBps.toFixed(1)} of ${plan.maxCostBps} bps`);

      if (dryRun) {
        this.setSlice(id, index, { state: "skipped", vsMidBps: quote.vsMidBps, price });
        this.stage(id, "settle", "skipped", "Dry run");
        this.stage(id, "measure", "skipped");
        return "previewed";
      }

      // Past this point the stop button no longer applies: the fill either lands or it doesn't.
      this.stage(id, "settle", "active");
      let fill: Fill;
      try {
        fill = await sdk.paperFill(quote, request);
      } catch (error) {
        if (error instanceof ZethosError && error.code === "quote_expired" && expiredRetries > 0) {
          expiredRetries -= 1;
          this.log(
            id,
            `${label}Quote expired at the vault, so it did not fill. Re-pricing once.`,
            "warn",
          );
          continue;
        }
        // Never retried: a network failure here leaves the outcome unknown, not failed.
        const ambiguous =
          error instanceof ZethosError && (error.code === "network" || error.code === "timeout");
        return fail(
          "settle",
          ambiguous
            ? `${failureMessage(error)} The fill may or may not have settled. Check “my position” before retrying.`
            : failureMessage(error),
        );
      }
      const paid = Number(formatUnits(BigInt(fill.amountIn), plan.soldDecimals));
      const received = Number(formatUnits(BigInt(fill.amountOut), plan.boughtDecimals));
      this.setSlice(id, index, {
        state: "filled",
        fill,
        paid,
        received,
        price: fill.price,
        vsMidBps: quote.vsMidBps,
      });
      this.stage(id, "settle", "done", "Paper fill settled");
      this.log(
        id,
        `${label}Filled: ${formatToken(paid)} ${plan.soldSymbol} for ${formatToken(received)} ${plan.boughtSymbol} at ${formatPrice(fill.price)}.`,
        "good",
      );
      measures.push(this.measure(id, index, plan, fill));
      return "filled";
    }
  }

  private setSlice(id: string, index: number, change: Partial<SliceRun>): void {
    this.patch(id, (mission) => ({
      slices: mission.slices.map((slice) =>
        slice.index === index ? { ...slice, ...change } : slice,
      ),
    }));
  }

  /** Client-side markout from the public mid. Positive means the price moved in the user's favour. */
  private async measure(id: string, index: number, plan: Plan, fill: Fill): Promise<void> {
    const never = new AbortController().signal;
    let elapsed = 0;
    for (const horizon of MARKOUT_HORIZONS) {
      await this.sleep((horizon - elapsed) * 1000, never);
      elapsed = horizon;
      const mid = this.latestMid(plan.pair);
      if (mid === null) continue;
      const bps = (plan.side === "buy" ? mid / fill.price - 1 : 1 - mid / fill.price) * 10_000;
      this.patch(id, (mission) => ({
        slices: mission.slices.map((slice) =>
          slice.index === index
            ? { ...slice, markouts: { ...slice.markouts, [horizon]: bps } }
            : slice,
        ),
      }));
      if (index === 0 || index === plan.sliceAmounts.length - 1)
        this.stage(
          id,
          "measure",
          this.find(id)?.stages.measure.state ?? "active",
          `${horizon}s ${formatBps(bps)}`,
        );
    }
  }
}

export interface MissionTotals {
  filled: number;
  paid: number;
  received: number;
  avgPrice: number | null;
  costBps: number | null;
}

/** Totals over settled fills only. `costBps` compares the average fill with the arrival mid. */
export function missionTotals(mission: Mission): MissionTotals {
  const fills = mission.slices.filter((slice) => slice.state === "filled");
  const paid = fills.reduce((sum, slice) => sum + (slice.paid ?? 0), 0);
  const received = fills.reduce((sum, slice) => sum + (slice.received ?? 0), 0);
  const buy = mission.plan?.side === "buy";
  const avgPrice = received > 0 && paid > 0 ? (buy ? paid / received : received / paid) : null;
  const costBps =
    avgPrice !== null && mission.arrivalMid
      ? (buy ? avgPrice / mission.arrivalMid - 1 : 1 - avgPrice / mission.arrivalMid) * 10_000
      : null;
  return { filled: fills.length, paid, received, avgPrice, costBps };
}
