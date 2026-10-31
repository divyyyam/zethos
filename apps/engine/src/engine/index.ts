import type { Address } from "viem";
import type { Decision } from "../agent/types";
import type { Pair, TierName } from "../config";
import type { Fill } from "../db";
import type { BookResult } from "../feeds";
import type { Trade } from "../feeds/types";
import type { PolicyRecord } from "../policy";
import { arenaView, ensureArena, resetArena } from "./arena";
import { diagnose } from "./diagnosis";
import { tick } from "./heartbeat";
import { decisions, narrate } from "./journal";
import { getStatus, ingest, prune } from "./market";
import { pause, reloadParams, setTaker } from "./operator";
import { fills, init } from "./persistence";
import { pnl, stats } from "./pnl";
import { getPolicy, listPolicies, registerPolicy } from "./policy-registry";
import { quote } from "./quoting";
import { paperFill } from "./settlement";
import { EngineState } from "./state";
import { ingestTrades } from "./tape";
import { takers } from "./toxicity";
import type { EngineDeps, PaperQuote } from "./types";

export { EngineError } from "./errors";
export { flowOf } from "./helpers";
export type { EngineDeps, Frame, PaperQuote, PriceBreakdown } from "./types";

/** Public engine facade. Collaborators operate on one state and share one write queue. */
export class Engine {
  private readonly context: EngineState;
  constructor(deps: EngineDeps) {
    this.context = new EngineState(deps);
  }
  get signerAddress(): Address {
    return this.context.signerAddress;
  }
  async init(): Promise<void> {
    return init(this.context);
  }

  ingest(pair: Pair, results: BookResult[], now: number): void {
    ingest(this.context, pair, results, now);
  }

  ensureArena(now: number): Promise<void> {
    return ensureArena(this.context, now);
  }

  quote(
    input: unknown,
    client: string | undefined,
    now: number,
    ip?: string,
  ): Promise<{ response: PaperQuote; saved: Promise<void> }> {
    return quote(this.context, input, client, now, ip);
  }

  paperFill(input: unknown, client: string | undefined, now: number): Promise<Fill> {
    return paperFill(this.context, input, client, now);
  }

  status() {
    return getStatus(this.context);
  }

  mandate() {
    return structuredClone(this.context.mandate);
  }

  diagnosis(now: number, pair?: string, window?: string) {
    return diagnose(this.context, now, pair, window);
  }

  async fills(taker: string | undefined, limit: number, epoch?: number): Promise<Fill[]> {
    return fills(this.context, taker, limit, epoch);
  }

  stats(pair: string, from: number, to: number) {
    return stats(this.context, pair, from, to);
  }

  prune(now: number): void {
    prune(this.context, now);
  }

  decisions(limit = 20, type?: string): Decision[] {
    return decisions(this.context, limit, type);
  }

  takers(limit = 100) {
    return takers(this.context, limit);
  }

  arenaView() {
    return arenaView(this.context);
  }

  pnl(period: "today" | "7d" | "all", now: number) {
    return pnl(this.context, period, now);
  }

  tick(now: number, gasPrice?: bigint): Promise<void> {
    return tick(this.context, now, gasPrice);
  }

  ingestTrades(pair: Pair, venue: string, trades: Trade[], now: number): Promise<void> {
    return ingestTrades(this.context, pair, venue, trades, now);
  }

  pause(operator: Address, paused: boolean, now: number): Promise<void> {
    return pause(this.context, operator, paused, now);
  }

  setTaker(
    operator: Address,
    address: Address,
    input: { tier?: TierName | null; label?: string },
    now: number,
  ): Promise<void> {
    return setTaker(this.context, operator, address, input, now);
  }

  resetArena(operator: Address, now: number): Promise<void> {
    return resetArena(this.context, operator, now);
  }

  reloadParams(input: unknown, now: number): Promise<void> {
    return reloadParams(this.context, input, now);
  }

  narrate(id: string, narration: string): Promise<void> {
    return narrate(this.context, id, narration);
  }

  registerPolicy(input: unknown, now: number): Promise<PolicyRecord> {
    return registerPolicy(this.context, input, now);
  }

  getPolicy(id: string): Promise<PolicyRecord | null> {
    return getPolicy(this.context, id);
  }

  listPolicies(): Promise<PolicyRecord[]> {
    return listPolicies(this.context);
  }
}
