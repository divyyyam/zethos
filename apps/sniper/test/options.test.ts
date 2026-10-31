import { describe, expect, it } from "bun:test";
import { parseSniperOptions, resolveAmountIn } from "../src/options.js";

describe("parseSniperOptions", () => {
  it("defaults to standard sniper mode without recording", () => {
    const opts = parseSniperOptions([]);
    expect(opts.mode).toBe("sniper");
    expect(opts.pair).toBe("ETH/USDT");
    expect(opts.amount).toBe("100");
    expect(opts.edge).toBe(1);
    expect(opts.rotate).toBe(3);
    expect(opts.chain).toBe(177);
    expect(opts.record).toBeUndefined();
    expect(opts.heldOut).toBe(false);
    expect(opts.captureOnly).toBe(false);
  });

  it("parses --record and held-out options", () => {
    const opts = parseSniperOptions([
      "--record",
      "attacker-sniper-run-1",
      "--held-out",
      "--pair",
      "HSK/USDT",
      "--description",
      "Rehearsal sniper attack recording",
      "--duration-sec",
      "60",
      "--max-records",
      "500",
    ]);

    expect(opts.record).toBe("attacker-sniper-run-1");
    expect(opts.heldOut).toBe(true);
    expect(opts.pair).toBe("HSK/USDT");
    expect(opts.description).toBe("Rehearsal sniper attack recording");
    expect(opts.durationSec).toBe(60);
    expect(opts.maxRecords).toBe(500);
  });

  it("supports capture-only flag and quiet alias", () => {
    const opts1 = parseSniperOptions(["--capture-only", "--record", "quiet-tape"]);
    expect(opts1.mode).toBe("capture-only");
    expect(opts1.captureOnly).toBe(true);
    expect(opts1.record).toBe("quiet-tape");

    const opts2 = parseSniperOptions(["--quiet", "--record", "quiet-tape-2"]);
    expect(opts2.mode).toBe("capture-only");
    expect(opts2.captureOnly).toBe(true);

    const opts3 = parseSniperOptions(["--mode", "capture-only"]);
    expect(opts3.mode).toBe("capture-only");
    expect(opts3.captureOnly).toBe(true);
  });

  it("preserves all existing attacker modes", () => {
    for (const mode of ["naive", "sniper", "latecomer", "rotating"] as const) {
      const opts = parseSniperOptions(["--mode", mode]);
      expect(opts.mode).toBe(mode);
      expect(opts.captureOnly).toBe(false);
    }
  });

  it("parses and validates custom venue lists", () => {
    const opts = parseSniperOptions(["--venues", "binance,okx"]);
    expect(opts.venues).toEqual(["binance", "okx"]);

    expect(() => parseSniperOptions(["--venues", "binance,unknown_exchange"])).toThrow(
      /Unknown venue/,
    );
  });
});

describe("resolveAmountIn", () => {
  it("converts human amounts using runtime decimals", () => {
    // USDT 6 decimals
    expect(resolveAmountIn("100", 6, "USDT")).toBe("100000000");
    expect(resolveAmountIn("0.5", 6, "USDT")).toBe("500000");
    expect(resolveAmountIn("0.000001", 6, "USDT")).toBe("1");

    // WETH / WHSK 18 decimals
    expect(resolveAmountIn("1", 18, "WETH")).toBe("1000000000000000000");
    expect(resolveAmountIn("0.5", 18, "WETH")).toBe("500000000000000000");
    expect(resolveAmountIn("0.000000000000000001", 18, "WETH")).toBe("1");

    // Arbitrary token decimals (e.g. 8 decimals for WBTC)
    expect(resolveAmountIn("2.5", 8, "WBTC")).toBe("250000000");
  });

  it("rejects amounts with too many decimal places for the runtime token", () => {
    expect(() => resolveAmountIn("100.1234567", 6, "USDT")).toThrow(/max 6 decimals/);
    expect(() => resolveAmountIn("1.0000000000000000001", 18, "WETH")).toThrow(/max 18 decimals/);
  });

  it("rejects zero, negative, or non-numeric amounts", () => {
    expect(() => resolveAmountIn("0", 6, "USDT")).toThrow();
    expect(() => resolveAmountIn("-10", 6, "USDT")).toThrow();
    expect(() => resolveAmountIn("abc", 6, "USDT")).toThrow();
    expect(() => resolveAmountIn("", 6, "USDT")).toThrow();
  });
});
