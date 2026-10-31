import { describe, expect, it } from "bun:test";
import { defaultParams } from "../src/config";
import type { Policy, PolicyMarketState } from "../src/policy/types";
import {
  compile,
  createV0Spec,
  type LoadedScenario,
  simulatePolicyOnScenario,
} from "../src/research";

const T0 = 1_800_000_000_000; // a multiple of the 2 s poll cadence
const book = (ts: number, venue: "hashkey-global" | "gate", mid: number) => ({
  type: "book" as const,
  ts,
  pair: "HSK/USDT" as const,
  venue,
  book: {
    bids: [
      [mid * 0.9995, 2e6],
      [mid * 0.999, 2e6],
    ] as [number, number][],
    asks: [
      [mid * 1.0005, 2e6],
      [mid * 1.001, 2e6],
    ] as [number, number][],
  },
});

function scenario(
  source: string,
  tier: "normal" | "toxic" | "internal" = "normal",
): LoadedScenario {
  return {
    manifest: {
      name: "lag-test",
      source,
      pair: "HSK/USDT",
      recordedAt: T0,
      heldOut: source === "held-out",
      description: "held-out attacker",
    },
    records: [
      book(T0, "hashkey-global", 0.1),
      book(T0, "gate", 0.1),
      // The market moves 2% between engine polls.
      book(T0 + 500, "hashkey-global", 0.102),
      book(T0 + 600, "gate", 0.102),
      {
        type: "taker_request",
        ts: T0 + 900,
        pair: "HSK/USDT",
        side: "buy",
        amountIn: "200000000",
        taker: "0x00000000000000000000000000000000000000a1",
        tier,
      },
    ],
  } as unknown as LoadedScenario;
}

describe("evaluator models the engine's poll lag", () => {
  it("shows the policy only books the engine would have polled", () => {
    const seen: number[] = [];
    const spy: Policy = {
      id: "spy",
      decide(market: PolicyMarketState) {
        seen.push(market.fused.mid);
        return { kind: "reject", reason: "policy_rule" };
      },
    };
    simulatePolicyOnScenario(spy, scenario("held-out"), { engineLagMs: 2000 });
    simulatePolicyOnScenario(spy, scenario("held-out"), { engineLagMs: 0 });
    expect(seen[0]).toBeCloseTo(0.1, 9);
    expect(seen[1]).toBeCloseTo(0.102, 9);
  });

  it("defaults the lag to the engine's feed poll interval", () => {
    const seen: number[] = [];
    const spy: Policy = {
      id: "spy",
      decide(market: PolicyMarketState) {
        seen.push(market.fused.mid);
        return { kind: "reject", reason: "policy_rule" };
      },
    };
    expect(defaultParams.feeds.pollMs).toBeGreaterThan(900);
    simulatePolicyOnScenario(spy, scenario("held-out"));
    expect(seen[0]).toBeCloseTo(0.1, 9);
  });

  it("lets an attacker take a quote priced from a stale view, and not from a fresh one", () => {
    const v0 = compile(createV0Spec("20261101"));
    const stale = simulatePolicyOnScenario(v0, scenario("held-out"), { engineLagMs: 2000 });
    const fresh = simulatePolicyOnScenario(v0, scenario("held-out"), { engineLagMs: 0 });
    expect(stale.fills).toBe(1);
    expect(stale.attackerTakeUsd).toBeGreaterThan(0);
    expect(fresh.fills).toBe(0);
    expect(fresh.attackerTakeUsd).toBe(0);
  });

  it("classifies requests in attacker recordings as attacker flow whatever the tier", () => {
    const v0 = compile(createV0Spec("20261101"));
    const heldOut = simulatePolicyOnScenario(v0, scenario("held-out", "normal"), {
      engineLagMs: 2000,
    });
    // No honest requests: the fill counts against the desk, not toward honest fill rate.
    expect(heldOut.honestFillRate).toBe(1);
    expect(heldOut.attackerTakeUsd).toBeGreaterThan(0);

    const tape = simulatePolicyOnScenario(v0, scenario("tape", "normal"), { engineLagMs: 2000 });
    expect(tape.attackerTakeUsd).toBe(0);
    const internal = simulatePolicyOnScenario(v0, scenario("sniper", "internal"), {
      engineLagMs: 2000,
    });
    expect(internal.attackerTakeUsd).toBe(0);
  });
});
