import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  defaultScenariosDir,
  HeldOutAccessError,
  listScenarios,
  loadScenario,
  loadScenarioManifest,
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
});
