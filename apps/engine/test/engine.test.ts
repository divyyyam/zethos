import { describe, expect, test } from "bun:test";
import { zeroAddress } from "viem";
import { memoryStore } from "../src/db/memory";
import { EngineError, flowOf } from "../src/engine";
import { paperOf, readyEngine, TAKER, tokens, usdt, whsk } from "./helpers";

const buyHsk = (amount = 100) => ({
  taker: TAKER,
  tokenIn: tokens.USDT.address,
  tokenOut: tokens.WHSK.address,
  amountIn: usdt(amount),
});

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  throw new Error("expected an EngineError");
}

describe("arena", () => {
  test("funds the paper vault 50/50 per pair once prices exist", async () => {
    const { engine } = await readyEngine();
    const status = engine.status();
    expect(status.inventory.USDT).toBe(usdt(50_000));
    expect(status.inventory.WHSK).toBe(whsk(250_000));
    expect(status.equityUsd).toBeCloseTo(100_000, 0);
    expect(status.verifyingContract).toBe(zeroAddress);
    expect(status.pairs.every((pair) => pair.health === "ok")).toBe(true);
  });

  test("reloads the existing arena instead of starting a new one", async () => {
    const store = memoryStore();
    await readyEngine({ store });
    const { engine } = await readyEngine({ store });
    expect((await store.loadArena())?.epoch).toBe(1);
    expect(engine.status().inventory.USDT).toBe(usdt(50_000));
  });
});

describe("loss diagnosis", () => {
  test("returns honest empty evidence and journals the analysis window", async () => {
    const { engine, now } = await readyEngine();
    const diagnosis = engine.diagnosis(now, "HSK/USDT", "1h");
    expect(diagnosis.window).toEqual({ fromTs: now - 60 * 60_000, toTs: now });
    expect(diagnosis.totalLossUsd).toBe(0);
    expect(diagnosis.breakdown).toEqual([]);
    expect(engine.decisions(10, "diagnosis")).toHaveLength(1);
  });

  test("rejects unsupported analysis windows and pairs", async () => {
    const { engine, now } = await readyEngine();
    expect(() => engine.diagnosis(now, undefined, "30d")).toThrow("window must be one of");
    expect(() => engine.diagnosis(now, "NOPE/USDT", "1h")).toThrow("pair is not enabled");
  });
});

describe("quote", () => {
  test("returns a signed paper quote priced above mid", async () => {
    const { engine, now } = await readyEngine();
    const { response } = await engine.quote(buyHsk(), "web", now);
    expect(response.route).toBe("paper");
    expect(paperOf(response).policyId).toBe("v0");
    expect(BigInt(paperOf(response).paperOut)).toBeLessThan(BigInt(response.spotOut));
    expect(response.vsMidBps).toBeGreaterThan(0);
    expect(response.expiresAt).toBe(Number(response.quote.expiry));
    expect(Number(response.quote.expiry) - Number(response.quote.issuedAt)).toBe(
      response.breakdown.ttlSec,
    );
    expect(response.breakdown.sources.length).toBe(4);
    expect(response.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  test("rejects unsupported pairs, tiny and oversized swaps", async () => {
    const { engine, now } = await readyEngine();
    expect(
      await code(engine.quote({ ...buyHsk(), tokenOut: tokens.USDT.address }, undefined, now)),
    ).toBe("invalid_request");
    expect(await code(engine.quote(buyHsk(1), undefined, now))).toBe("invalid_request");
    expect(await code(engine.quote(buyHsk(30_000), undefined, now))).toBe("vault_capacity");
    expect(await code(engine.quote({ ...buyHsk(), amountIn: "-1" }, undefined, now))).toBe(
      "invalid_request",
    );
  });

  test("rate limits per taker", async () => {
    const { engine, now } = await readyEngine();
    for (let index = 0; index < 60; index += 1) await engine.quote(buyHsk(), undefined, now);
    expect(await code(engine.quote(buyHsk(), undefined, now))).toBe("rate_limited");
  });

  test("halts a pair whose feeds are down", async () => {
    const { engine, now } = await readyEngine();
    engine.ingest(
      "HSK/USDT",
      ["hashkey-global", "gate", "kucoin", "mexc"].map((venue) => ({
        venue: venue as "gate",
        book: null,
        error: "timeout",
      })),
      now + 10_000,
    );
    expect(await code(engine.quote(buyHsk(), undefined, now + 10_000))).toBe("pair_halted");
  });
});

describe("paper fill", () => {
  test("settles a valid quote and moves inventory both ways", async () => {
    const { engine, frames, now } = await readyEngine();
    const { response } = await engine.quote(buyHsk(), "web", now);
    const fill = await engine.paperFill(
      { quote: response.quote, signature: response.signature },
      "web",
      now + 1000,
    );
    expect(fill.flow).toBe("user");
    expect(fill.policyId).toBe("v0");
    expect(fill.amountOut).toBe(paperOf(response).paperOut);
    expect(fill.price).toBeGreaterThan(0.1);
    const inventory = engine.status().inventory;
    expect(inventory.USDT).toBe((BigInt(usdt(50_000)) + BigInt(usdt(100))).toString());
    expect(inventory.WHSK).toBe(
      (BigInt(whsk(250_000)) - BigInt(paperOf(response).paperOut)).toString(),
    );
    expect(frames.some((frame) => frame.type === "fill")).toBe(true);
    expect(await engine.fills(TAKER, 10)).toHaveLength(1);
  });

  test("rejects reuse, expiry, tampering and foreign quotes", async () => {
    const { engine, now } = await readyEngine();
    const first = await engine.quote(buyHsk(), undefined, now);
    const body = { quote: first.response.quote, signature: first.response.signature };
    await engine.paperFill(body, undefined, now);
    expect(await code(engine.paperFill(body, undefined, now))).toBe("nonce_used");

    const second = await engine.quote(buyHsk(), undefined, now);
    const late = (Number(second.response.quote.expiry) + 1) * 1000;
    expect(
      await code(
        engine.paperFill(
          { quote: second.response.quote, signature: second.response.signature },
          undefined,
          late,
        ),
      ),
    ).toBe("quote_expired");

    const third = await engine.quote(buyHsk(), undefined, now);
    const tampered = {
      ...third.response.quote,
      amountOut: (BigInt(paperOf(third.response).paperOut) * 2n).toString(),
    };
    expect(
      await code(
        engine.paperFill({ quote: tampered, signature: third.response.signature }, undefined, now),
      ),
    ).toBe("quote_invalid");

    const other = await readyEngine();
    const foreign = await other.engine.quote(buyHsk(), undefined, now);
    expect(
      await code(
        engine.paperFill(
          { quote: foreign.response.quote, signature: foreign.response.signature },
          undefined,
          now,
        ),
      ),
    ).toBe("quote_invalid");
  });

  test("rolls back when the store fails", async () => {
    const store = memoryStore();
    const { engine, now } = await readyEngine({ store });
    const { response } = await engine.quote(buyHsk(), undefined, now);
    const before = engine.status().inventory;
    store.saveFill = async () => {
      throw new Error("db down");
    };
    const body = { quote: response.quote, signature: response.signature };
    await expect(engine.paperFill(body, undefined, now)).rejects.toThrow("db down");
    expect(engine.status().inventory).toEqual(before);
  });
});

test("flow attribution comes only from the client header", () => {
  expect(flowOf("web")).toBe("user");
  expect(flowOf("mcp")).toBe("agent");
  expect(flowOf("sdk")).toBe("agent");
  expect(flowOf("sniper/latecomer")).toBe("attacker");
  expect(flowOf(undefined)).toBe("agent");
});
