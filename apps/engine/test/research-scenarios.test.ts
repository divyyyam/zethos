import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  defaultScenariosDir,
  HeldOutAccessError,
  listScenarios,
  loadScenario,
  loadScenarioManifest,
  materializeScenarioPartitions,
  parseScenarioRecords,
  resolveScenarioPaths,
  ScenarioFormatError,
  ScenarioSecurityError,
  scenarioManifestSchema,
  scenarioRecordSchema,
  splitRecordsByRatio,
  splitRecordsByTime,
} from "../src/research";

describe("R7 Scenario Loader and Held-Out Protection", () => {
  const scenariosDir = defaultScenariosDir();

  describe("Manifest validation", () => {
    it("validates valid scenario manifests", () => {
      const valid = {
        name: "test-scenario",
        source: "tape",
        pair: "HSK/USDT",
        recordedAt: 1700000000000,
        heldOut: false,
        description: "Valid test scenario",
        devWindow: { fromTs: 1000, toTs: 2000 },
        heldOutWindow: { fromTs: 2001, toTs: 3000 },
      };
      const parsed = scenarioManifestSchema.parse(valid);
      expect(parsed.name).toBe("test-scenario");
      expect(parsed.heldOut).toBe(false);
      expect(parsed.devWindow?.fromTs).toBe(1000);
    });

    it("rejects manifests with missing or invalid fields", () => {
      expect(() =>
        scenarioManifestSchema.parse({
          name: "missing-fields",
          // missing source, pair, recordedAt, heldOut, description
        }),
      ).toThrow();

      expect(() =>
        scenarioManifestSchema.parse({
          name: "invalid-pair",
          source: "tape",
          pair: "BTC/USDT", // unsupported pair
          recordedAt: 1700000000000,
          heldOut: false,
          description: "Invalid pair",
        }),
      ).toThrow();

      expect(() =>
        scenarioManifestSchema.parse({
          name: "invalid/name", // invalid characters
          source: "tape",
          pair: "HSK/USDT",
          recordedAt: 1700000000000,
          heldOut: false,
          description: "Invalid name",
        }),
      ).toThrow();
    });
  });

  describe("Record schema and NDJSON parsing", () => {
    it("parses valid book, trade and taker_request records", () => {
      const bookLine = JSON.stringify({
        type: "book",
        ts: 1000,
        pair: "HSK/USDT",
        venue: "hashkey-global",
        book: {
          bids: [[2.0, 500]],
          asks: [[2.01, 500]],
        },
      });

      const tradeLine = JSON.stringify({
        type: "trade",
        ts: 1001,
        pair: "HSK/USDT",
        venue: "hashkey-global",
        trade: {
          id: "tr-1",
          ts: 1001,
          side: "buy",
          price: 2.01,
          size: 100,
        },
      });

      const takerRequestLine = JSON.stringify({
        type: "taker_request",
        ts: 1002,
        pair: "HSK/USDT",
        side: "sell",
        amountIn: "100000000000000000000", // 100 WHSK
        taker: "0x1111111111111111111111111111111111111111",
        tier: "normal",
        score: 0.15,
      });

      const ndjson = [bookLine, tradeLine, takerRequestLine].join("\n");
      const records = parseScenarioRecords(ndjson, "test-ndjson");

      expect(records.length).toBe(3);
      expect(records[0]?.type).toBe("book");
      expect(records[1]?.type).toBe("trade");
      expect(records[2]?.type).toBe("taker_request");
    });

    it("preserves raw amountIn as base-10 integer string without numerical degradation", () => {
      const largeAmount =
        "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // 2^256 - 1
      const record = scenarioRecordSchema.parse({
        type: "taker_request",
        ts: 1000,
        pair: "HSK/USDT",
        side: "buy",
        amountIn: largeAmount,
        taker: "0x1111111111111111111111111111111111111111",
      });

      if (record.type === "taker_request") {
        expect(record.amountIn).toBe(largeAmount);
        expect(typeof record.amountIn).toBe("string");
      } else {
        throw new Error("Expected taker_request record");
      }
    });

    it("rejects malformed records and pinpoints the line number", () => {
      const goodLine = JSON.stringify({
        type: "book",
        ts: 1000,
        pair: "HSK/USDT",
        venue: "hashkey-global",
        book: { bids: [[2.0, 500]], asks: [[2.01, 500]] },
      });
      const badLine = JSON.stringify({
        type: "book",
        ts: 1001,
        pair: "HSK/USDT",
        venue: "hashkey-global",
        book: { bids: [], asks: [[2.01, 500]] }, // empty bids array
      });

      const ndjson = `${goodLine}\n${badLine}`;
      expect(() => parseScenarioRecords(ndjson, "test-malformed")).toThrow(ScenarioFormatError);

      try {
        parseScenarioRecords(ndjson, "test-malformed");
      } catch (err: unknown) {
        expect((err as ScenarioFormatError).message).toContain("line 2");
      }
    });

    it("enforces monotonic chronological ordering", () => {
      const line1 = JSON.stringify({
        type: "book",
        ts: 2000,
        pair: "HSK/USDT",
        venue: "hashkey-global",
        book: { bids: [[2.0, 500]], asks: [[2.01, 500]] },
      });
      const line2 = JSON.stringify({
        type: "book",
        ts: 1000, // out of order
        pair: "HSK/USDT",
        venue: "hashkey-global",
        book: { bids: [[2.0, 500]], asks: [[2.01, 500]] },
      });

      expect(() => parseScenarioRecords(`${line1}\n${line2}`, "out-of-order")).toThrow(
        "records must be monotonically ordered by timestamp",
      );
    });
  });

  describe("Security: Path Traversal Prevention", () => {
    it("rejects relative path traversal sequences", () => {
      expect(() => resolveScenarioPaths("../secret", scenariosDir)).toThrow(ScenarioSecurityError);
      expect(() => resolveScenarioPaths("..\\secret", scenariosDir)).toThrow(ScenarioSecurityError);
      expect(() => resolveScenarioPaths("subdir/scenario", scenariosDir)).toThrow(
        ScenarioSecurityError,
      );
      expect(() => resolveScenarioPaths("subdir\\scenario", scenariosDir)).toThrow(
        ScenarioSecurityError,
      );
    });

    it("rejects empty names or names with illegal characters or null bytes", () => {
      expect(() => resolveScenarioPaths("", scenariosDir)).toThrow(ScenarioSecurityError);
      expect(() => resolveScenarioPaths("scenario\0inject", scenariosDir)).toThrow(
        ScenarioSecurityError,
      );
      expect(() => resolveScenarioPaths("scenario;rm -rf", scenariosDir)).toThrow(
        ScenarioSecurityError,
      );
    });

    it("accepts valid alphanumeric names with underscores and dashes", () => {
      const res = resolveScenarioPaths("synthetic-dev-tape", scenariosDir);
      expect(res.manifestPath.endsWith("synthetic-dev-tape.json")).toBe(true);
      expect(res.payloadPath.endsWith("synthetic-dev-tape.ndjson")).toBe(true);
    });
  });

  describe("Fail-closed held-out protection", () => {
    it("fails closed BEFORE reading NDJSON payload when requesting held-out scenario as research", async () => {
      // 1. Regular held-out scenario loading with research role fails
      await expect(
        loadScenario("synthetic-heldout-leadlag", { role: "research", scenariosDir }),
      ).rejects.toThrow(HeldOutAccessError);

      // 2. Default role (when omitted) must be 'research' and fail closed
      await expect(loadScenario("synthetic-heldout-leadlag", { scenariosDir })).rejects.toThrow(
        HeldOutAccessError,
      );

      // 3. Crucial proof of failing BEFORE payload access:
      // Create a temporary manifest that has heldOut: true, but NO corresponding .ndjson file on disk!
      const tempManifestName = "temp-heldout-missing-payload";
      const tempManifestPath = path.resolve(scenariosDir, `${tempManifestName}.json`);
      const tempPayloadPath = path.resolve(scenariosDir, `${tempManifestName}.ndjson`);

      await fs.writeFile(
        tempManifestPath,
        JSON.stringify({
          name: tempManifestName,
          source: "synthetic-generator",
          pair: "HSK/USDT",
          recordedAt: 1700000000000,
          heldOut: true,
          description: "Temporary manifest without payload",
        }),
      );

      try {
        // Calling with research role MUST fail with HeldOutAccessError, NOT an ENOENT / file not found error!
        await expect(
          loadScenario(tempManifestName, { role: "research", scenariosDir }),
        ).rejects.toThrow(HeldOutAccessError);
      } finally {
        await fs.rm(tempManifestPath, { force: true });
        await fs.rm(tempPayloadPath, { force: true });
      }
    });

    it("permits explicit evaluator access to held-out scenarios", async () => {
      const loaded = await loadScenario("synthetic-heldout-leadlag", {
        role: "evaluator",
        scenariosDir,
      });

      expect(loaded.manifest.name).toBe("synthetic-heldout-leadlag");
      expect(loaded.manifest.heldOut).toBe(true);
      expect(loaded.records.length).toBeGreaterThan(0);
      expect(loaded.recordCounts.books).toBe(1);
      expect(loaded.recordCounts.trades).toBe(1);
      expect(loaded.recordCounts.takerRequests).toBe(1);
    });

    it("allows research access to non-held-out (dev) scenarios", async () => {
      const loaded = await loadScenario("synthetic-dev-tape", {
        role: "research",
        scenariosDir,
      });

      expect(loaded.manifest.name).toBe("synthetic-dev-tape");
      expect(loaded.manifest.heldOut).toBe(false);
      expect(loaded.records.length).toBeGreaterThan(0);
    });
  });

  describe("Time-window splitting and partitions", () => {
    it("partitions records by time timestamp boundary deterministically", () => {
      const records = parseScenarioRecords(
        [
          JSON.stringify({
            type: "book",
            ts: 1000,
            pair: "HSK/USDT",
            venue: "hashkey-global",
            book: { bids: [[2.0, 500]], asks: [[2.01, 500]] },
          }),
          JSON.stringify({
            type: "book",
            ts: 2000,
            pair: "HSK/USDT",
            venue: "hashkey-global",
            book: { bids: [[2.0, 500]], asks: [[2.01, 500]] },
          }),
          JSON.stringify({
            type: "book",
            ts: 3000,
            pair: "HSK/USDT",
            venue: "hashkey-global",
            book: { bids: [[2.0, 500]], asks: [[2.01, 500]] },
          }),
          JSON.stringify({
            type: "book",
            ts: 4000,
            pair: "HSK/USDT",
            venue: "hashkey-global",
            book: { bids: [[2.0, 500]], asks: [[2.01, 500]] },
          }),
        ].join("\n"),
      );

      const { dev, heldOut } = splitRecordsByTime(records, 2500);
      expect(dev.length).toBe(2);
      expect(dev.map((r) => r.ts)).toEqual([1000, 2000]);
      expect(heldOut.length).toBe(2);
      expect(heldOut.map((r) => r.ts)).toEqual([3000, 4000]);
      expect(dev.length + heldOut.length).toBe(records.length);
    });

    it("splits records by ratio deterministically", () => {
      const records = parseScenarioRecords(
        [
          JSON.stringify({
            type: "book",
            ts: 1000,
            pair: "HSK/USDT",
            venue: "hashkey-global",
            book: { bids: [[2.0, 500]], asks: [[2.01, 500]] },
          }),
          JSON.stringify({
            type: "book",
            ts: 2000,
            pair: "HSK/USDT",
            venue: "hashkey-global",
            book: { bids: [[2.0, 500]], asks: [[2.01, 500]] },
          }),
          JSON.stringify({
            type: "book",
            ts: 3000,
            pair: "HSK/USDT",
            venue: "hashkey-global",
            book: { bids: [[2.0, 500]], asks: [[2.01, 500]] },
          }),
          JSON.stringify({
            type: "book",
            ts: 4000,
            pair: "HSK/USDT",
            venue: "hashkey-global",
            book: { bids: [[2.0, 500]], asks: [[2.01, 500]] },
          }),
        ].join("\n"),
      );

      const { dev, heldOut, splitTs } = splitRecordsByRatio(records, 0.5);
      expect(splitTs).toBe(3000);
      expect(dev.length).toBe(2);
      expect(heldOut.length).toBe(2);
    });

    it("respects devWindow and heldOutWindow partition boundaries on load", async () => {
      // synthetic-dev-tape has:
      // devWindow: 1700000000000 to 1700000005000 (first 3 records)
      // heldOutWindow: 1700000005001 to 1700000010000 (last 1 record)

      const devSplit = await loadScenario("synthetic-dev-tape", {
        split: "dev",
        scenariosDir,
      });
      expect(devSplit.records.length).toBe(3);
      expect(devSplit.records.every((r) => r.ts <= 1700000005000)).toBe(true);

      const heldOutSplit = await loadScenario("synthetic-dev-tape", {
        split: "held-out",
        role: "evaluator", // held-out split requires evaluator authorization
        scenariosDir,
      });
      expect(heldOutSplit.records.length).toBe(1);
      expect(heldOutSplit.records[0]?.ts).toBe(1700000006000);

      // Attempting to read held-out split with research role must reject
      await expect(
        loadScenario("synthetic-dev-tape", {
          split: "held-out",
          role: "research",
          scenariosDir,
        }),
      ).rejects.toThrow(HeldOutAccessError);
    });

    it("respects custom timeWindow filter", async () => {
      const filtered = await loadScenario("synthetic-dev-tape", {
        role: "evaluator",
        timeWindow: {
          fromTs: 1700000002000,
          toTs: 1700000003000,
        },
        split: "all",
        scenariosDir,
      });

      expect(filtered.records.length).toBe(2);
      expect(filtered.records.map((r) => r.ts)).toEqual([1700000002000, 1700000003000]);
    });
  });

  describe("Scenario listing and manifest discovery", () => {
    it("lists all available scenarios in directory", async () => {
      const manifests = await listScenarios({ scenariosDir });
      expect(manifests.length).toBeGreaterThanOrEqual(2);
      const names = manifests.map((m) => m.name);
      expect(names).toContain("synthetic-dev-tape");
      expect(names).toContain("synthetic-heldout-leadlag");
    });

    it("loads manifest without payload", async () => {
      const manifest = await loadScenarioManifest("synthetic-heldout-leadlag", { scenariosDir });
      expect(manifest.name).toBe("synthetic-heldout-leadlag");
      expect(manifest.heldOut).toBe(true);
      expect(manifest.pair).toBe("HSK/USDT");
    });
  });

  describe("Checkpoint A Hardened Invariants", () => {
    const UINT256_MAX_STR =
      "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const UINT256_OVERFLOW_STR =
      "115792089237316195423570985008687907853269984665640564039457584007913129639936";

    it("rejects amountIn equal to or greater than 2^256", () => {
      expect(() =>
        scenarioRecordSchema.parse({
          type: "taker_request",
          ts: 1000,
          pair: "HSK/USDT",
          side: "buy",
          amountIn: UINT256_OVERFLOW_STR,
          taker: "0x1111111111111111111111111111111111111111",
        }),
      ).toThrow();
    });

    it("rejects zero, negative or non-integer amounts in scenario records", () => {
      const baseReq = {
        type: "taker_request",
        ts: 1000,
        pair: "HSK/USDT",
        side: "buy",
        taker: "0x1111111111111111111111111111111111111111",
      };

      expect(() => scenarioRecordSchema.parse({ ...baseReq, amountIn: "0" })).toThrow();
      expect(() => scenarioRecordSchema.parse({ ...baseReq, amountIn: "-100" })).toThrow();
      expect(() => scenarioRecordSchema.parse({ ...baseReq, amountIn: "100.5" })).toThrow();
      expect(() => scenarioRecordSchema.parse({ ...baseReq, amountIn: "abc" })).toThrow();
      expect(() => scenarioRecordSchema.parse({ ...baseReq, amountIn: "" })).toThrow();

      // Valid amounts
      expect(scenarioRecordSchema.parse({ ...baseReq, amountIn: "1" })).toBeDefined();
      expect(scenarioRecordSchema.parse({ ...baseReq, amountIn: UINT256_MAX_STR })).toBeDefined();
    });

    it("validates explicit taker tiers: normal, toxic, internal", () => {
      const baseReq = {
        type: "taker_request" as const,
        ts: 1000,
        pair: "HSK/USDT" as const,
        side: "buy" as const,
        amountIn: "1000000000",
        taker: "0x1111111111111111111111111111111111111111",
      };

      expect(scenarioRecordSchema.parse({ ...baseReq, tier: "normal" })).toBeDefined();
      expect(scenarioRecordSchema.parse({ ...baseReq, tier: "toxic" })).toBeDefined();
      expect(scenarioRecordSchema.parse({ ...baseReq, tier: "internal" })).toBeDefined();
      expect(() =>
        scenarioRecordSchema.parse({ ...baseReq, tier: "invalid_tier" as unknown as "normal" }),
      ).toThrow();
    });

    it("rejects empty bids or asks arrays in book records", () => {
      const baseBook = {
        type: "book",
        ts: 1000,
        pair: "HSK/USDT",
        venue: "hashkey-global",
      };

      expect(() =>
        scenarioRecordSchema.parse({
          ...baseBook,
          book: { bids: [], asks: [[2.01, 500]] },
        }),
      ).toThrow();

      expect(() =>
        scenarioRecordSchema.parse({
          ...baseBook,
          book: { bids: [[2.0, 500]], asks: [] },
        }),
      ).toThrow();
    });

    it("rejects manifests with inverted or overlapping dev and held-out windows", () => {
      const baseManifest = {
        name: "test-window-check",
        source: "tape",
        pair: "HSK/USDT",
        recordedAt: 1700000000000,
        heldOut: false,
        description: "Test window validation",
      };

      // Inverted dev window
      expect(() =>
        scenarioManifestSchema.parse({
          ...baseManifest,
          devWindow: { fromTs: 2000, toTs: 1000 },
        }),
      ).toThrow();

      // Inverted held-out window
      expect(() =>
        scenarioManifestSchema.parse({
          ...baseManifest,
          heldOutWindow: { fromTs: 4000, toTs: 3000 },
        }),
      ).toThrow();

      // Overlapping windows
      expect(() =>
        scenarioManifestSchema.parse({
          ...baseManifest,
          devWindow: { fromTs: 1000, toTs: 2500 },
          heldOutWindow: { fromTs: 2000, toTs: 3000 },
        }),
      ).toThrow();
    });

    it("strictly isolates held-out records: research cannot request 'all' or 'held-out' on mixed manifests", async () => {
      // synthetic-dev-tape has both devWindow and heldOutWindow
      await expect(
        loadScenario("synthetic-dev-tape", {
          role: "research",
          split: "all",
          scenariosDir,
        }),
      ).rejects.toThrow(HeldOutAccessError);

      await expect(
        loadScenario("synthetic-dev-tape", {
          role: "research",
          split: "held-out",
          scenariosDir,
        }),
      ).rejects.toThrow(HeldOutAccessError);
    });

    it("rejects research requests when timeWindow extends into the held-out partition", async () => {
      // synthetic-dev-tape devWindow is 1700000000000 to 1700000005000; held-out is 1700000005001 to 1700000010000
      await expect(
        loadScenario("synthetic-dev-tape", {
          role: "research",
          timeWindow: {
            fromTs: 1700000004000,
            toTs: 1700000007000, // extends past 1700000005000
          },
          scenariosDir,
        }),
      ).rejects.toThrow(HeldOutAccessError);
    });

    it("fails closed BEFORE reading mixed payload if materialized dev file is missing for research", async () => {
      const tempName = "temp-mixed-no-dev-file";
      const manifestPath = path.resolve(scenariosDir, `${tempName}.json`);
      const payloadPath = path.resolve(scenariosDir, `${tempName}.ndjson`);

      // Write manifest with held-out window, but do NOT create .dev.ndjson
      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          name: tempName,
          source: "tape",
          pair: "HSK/USDT",
          recordedAt: 1700000000000,
          heldOut: false,
          description: "Mixed manifest without separate dev partition file",
          devWindow: { fromTs: 1000, toTs: 2000 },
          heldOutWindow: { fromTs: 2001, toTs: 3000 },
        }),
      );

      // Create payload that contains held-out records
      await fs.writeFile(
        payloadPath,
        `${JSON.stringify({
          type: "book",
          ts: 1500,
          pair: "HSK/USDT",
          venue: "hashkey-global",
          book: { bids: [[2.0, 100]], asks: [[2.01, 100]] },
        })}\n`,
      );

      try {
        // Research access MUST fail with HeldOutAccessError because .dev.ndjson does not exist
        await expect(
          loadScenario(tempName, { role: "research", split: "dev", scenariosDir }),
        ).rejects.toThrow(HeldOutAccessError);

        // Evaluator CAN load via main payload
        const evalLoaded = await loadScenario(tempName, {
          role: "evaluator",
          split: "dev",
          scenariosDir,
        });
        expect(evalLoaded.records.length).toBe(1);
      } finally {
        await fs.rm(manifestPath, { force: true });
        await fs.rm(payloadPath, { force: true });
      }
    });

    it("rejects scenarios where record pairs mismatch manifest pair", async () => {
      const tempName = "temp-pair-mismatch";
      const manifestPath = path.resolve(scenariosDir, `${tempName}.json`);
      const payloadPath = path.resolve(scenariosDir, `${tempName}.ndjson`);

      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          name: tempName,
          source: "tape",
          pair: "HSK/USDT", // Manifest specifies HSK/USDT
          recordedAt: 1700000000000,
          heldOut: false,
          description: "Pair mismatch test",
        }),
      );

      // Record contains ETH/USDT
      await fs.writeFile(
        payloadPath,
        `${JSON.stringify({
          type: "book",
          ts: 1000,
          pair: "ETH/USDT", // Mismatch!
          venue: "binance",
          book: { bids: [[2000, 10]], asks: [[2001, 10]] },
        })}\n`,
      );

      try {
        await expect(loadScenario(tempName, { role: "evaluator", scenariosDir })).rejects.toThrow(
          ScenarioFormatError,
        );
      } finally {
        await fs.rm(manifestPath, { force: true });
        await fs.rm(payloadPath, { force: true });
      }
    });

    it("verifies materializeScenarioPartitions partitions files accurately", async () => {
      const tempName = "temp-partition-test";
      const manifestPath = path.resolve(scenariosDir, `${tempName}.json`);
      const payloadPath = path.resolve(scenariosDir, `${tempName}.ndjson`);
      const devPath = path.resolve(scenariosDir, `${tempName}.dev.ndjson`);
      const heldOutPath = path.resolve(scenariosDir, `${tempName}.heldout.ndjson`);

      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          name: tempName,
          source: "tape",
          pair: "HSK/USDT",
          recordedAt: 1700000000000,
          heldOut: false,
          description: "Partition materialization test",
          devWindow: { fromTs: 1000, toTs: 2000 },
          heldOutWindow: { fromTs: 2001, toTs: 3000 },
        }),
      );

      const r1 = JSON.stringify({
        type: "book",
        ts: 1500,
        pair: "HSK/USDT",
        venue: "hashkey-global",
        book: { bids: [[2.0, 100]], asks: [[2.01, 100]] },
      });
      const r2 = JSON.stringify({
        type: "book",
        ts: 2500,
        pair: "HSK/USDT",
        venue: "hashkey-global",
        book: { bids: [[2.05, 100]], asks: [[2.06, 100]] },
      });

      await fs.writeFile(payloadPath, `${r1}\n${r2}\n`);

      try {
        const result = await materializeScenarioPartitions(tempName, { scenariosDir });
        expect(result.devPath).toBe(devPath);
        expect(result.heldOutPath).toBe(heldOutPath);

        const devContent = await fs.readFile(devPath, "utf-8");
        expect(devContent.trim()).toBe(r1);

        const heldOutContent = await fs.readFile(heldOutPath, "utf-8");
        expect(heldOutContent.trim()).toBe(r2);
      } finally {
        await fs.rm(manifestPath, { force: true });
        await fs.rm(payloadPath, { force: true });
        await fs.rm(devPath, { force: true });
        await fs.rm(heldOutPath, { force: true });
      }
    });

    it("verifies CLI boundary enforces held-out protection and exit codes", async () => {
      const scriptPath = path.resolve(__dirname, "../scripts/research-scenarios.ts");

      // 1. Research (default) loading held-out scenario must exit with code 1
      const proc1 = Bun.spawnSync(["bun", scriptPath, "synthetic-heldout-leadlag"], {
        cwd: path.resolve(__dirname, ".."),
      });
      expect(proc1.exitCode).toBe(1);
      const stderr1 = proc1.stderr.toString();
      expect(stderr1).toContain("[HELD-OUT GUARD]");

      // 2. Research (default) requesting split=held-out on mixed scenario must exit with code 1
      const proc2 = Bun.spawnSync(["bun", scriptPath, "synthetic-dev-tape", "--split=held-out"], {
        cwd: path.resolve(__dirname, ".."),
      });
      expect(proc2.exitCode).toBe(1);
      const stderr2 = proc2.stderr.toString();
      expect(stderr2).toContain("[HELD-OUT GUARD]");

      // 3. Evaluator loading held-out scenario must succeed with exit code 0
      const proc3 = Bun.spawnSync(
        ["bun", scriptPath, "synthetic-heldout-leadlag", "--role=evaluator"],
        {
          cwd: path.resolve(__dirname, ".."),
        },
      );
      expect(proc3.exitCode).toBe(0);
      const stdout3 = proc3.stdout.toString();
      expect(stdout3).toContain("[SCENARIO LOADED] synthetic-heldout-leadlag");
    });
  });
});
