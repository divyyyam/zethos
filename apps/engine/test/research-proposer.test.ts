import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { defaultParams } from "../src/config";
import {
  type AuditStepRecord,
  createV0Spec,
  HeldOutAccessError,
  hashPolicySpec,
  ProposerConfigError,
  ProposerProviderError,
  ProposerRetryExhaustedError,
  ProposerTimeoutError,
  proposePolicy,
  redactSecrets,
} from "../src/research";

const SAMPLE_DIAGNOSIS = {
  window: { fromTs: 1700000000000, toTs: 1700000060000 },
  totalLossUsd: 1250.5,
  analyzedLossUsd: 1250.5,
  unclassifiedLossUsd: 50.0,
  causes: {
    stale_reference: {
      usd: 750.0,
      share: 0.6,
      fillCount: 8,
      exampleFillIds: ["f-1", "f-2"],
    },
    inventory_imbalance: {
      usd: 250.0,
      share: 0.2,
      fillCount: 4,
      exampleFillIds: ["f-3"],
    },
    selective_execution: {
      usd: 150.0,
      share: 0.12,
      fillCount: 2,
      exampleFillIds: ["f-4"],
    },
    adverse_size: {
      usd: 50.5,
      share: 0.04,
      fillCount: 1,
      exampleFillIds: ["f-5"],
    },
  },
  unclassified: {
    usd: 50.0,
    share: 0.04,
    fillCount: 1,
    exampleFillIds: ["f-6"],
  },
};

const SAMPLE_DEV_STATS = {
  datasets: [
    {
      name: "synthetic-dev-tape",
      kind: "dev",
      from: 1700000000000,
      to: 1700000060000,
      requests: 50,
    },
  ],
  totalFills: 35,
  netUsd: 840.25,
  spreadCaptureUsd: 1250.0,
  maxDrawdownPct: 0.045,
  avgHalfSpreadBps: 18.2,
  honestFillRate: 0.88,
  rejectRate: 0.05,
};

function createMockFetcher(
  responses: Array<{
    status?: number;
    statusText?: string;
    bodyText?: string;
    jsonBody?: unknown;
    throwError?: Error;
  }>,
) {
  let callCount = 0;
  const requests: Array<{ url: string; init: RequestInit; parsedBody: unknown }> = [];

  const mockFetcher = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const current = responses[callCount] ?? responses[responses.length - 1];
    callCount++;

    const bodyStr = typeof init?.body === "string" ? init.body : "";
    let parsedBody: unknown = null;
    try {
      parsedBody = JSON.parse(bodyStr);
    } catch {
      parsedBody = bodyStr;
    }

    requests.push({
      url: String(input),
      init: init ?? {},
      parsedBody,
    });

    if (current?.throwError) {
      throw current.throwError;
    }

    const status = current?.status ?? 200;
    const statusText = current?.statusText ?? (status === 200 ? "OK" : "Error");

    let responsePayload: unknown = current?.jsonBody;
    if (!responsePayload && current?.bodyText !== undefined) {
      responsePayload = {
        candidates: [
          {
            content: {
              parts: [{ text: current.bodyText }],
            },
          },
        ],
      };
    }

    return new Response(JSON.stringify(responsePayload), {
      status,
      statusText,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    fetcher: mockFetcher as unknown as typeof fetch,
    getCallCount: () => callCount,
    getRequests: () => requests,
  };
}

test("proposePolicy > generates valid candidate and local canonical identity on attempt 1", async () => {
  const incumbent = createV0Spec("20261101", defaultParams);
  const auditRecords: AuditStepRecord[] = [];

  const candidateBody = {
    parent: incumbent.id,
    hypothesis: "Add leadMove term to widen quote spread when lead venue divergence is detected.",
    pairs: ["HSK/USDT", "ETH/USDT"],
    reference: { kind: "depthWeighted", params: {} },
    terms: [
      { kind: "base", params: { bps: { "HSK/USDT": 15, "ETH/USDT": 10 } } },
      { kind: "vol", params: { k: 2.0 } },
      { kind: "inventory", params: { k: 0.0015 } },
      { kind: "toxicity", params: { scale: 1.0 } },
      { kind: "leadMove", params: { thresholdBps: 8, windowSec: 15, addBps: 20 } },
      { kind: "tuner", params: {} },
    ],
    clamp: { minBps: 5, maxBps: 200 },
    ttl: { kind: "volScaled", ttlVolK: 1.5, minSec: 5, maxSec: 30 },
  };

  const mock = createMockFetcher([
    {
      bodyText: JSON.stringify(candidateBody),
    },
  ]);

  const result = await proposePolicy({
    diagnosis: SAMPLE_DIAGNOSIS,
    devStats: SAMPLE_DEV_STATS,
    incumbent,
    date: "20261101",
    apiKey: "test-api-key",
    fetcher: mock.fetcher,
    auditWriter: (record) => {
      auditRecords.push(record);
    },
  });

  assert.equal(mock.getCallCount(), 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.candidate.parent, incumbent.id);
  assert.equal(result.hypothesis, candidateBody.hypothesis);

  // ID must be strictly content-derived with explicit date
  const expectedHash = hashPolicySpec(result.candidate);
  assert.equal(result.specHash, expectedHash);
  assert.equal(result.candidate.id, `p-20261101-${expectedHash.slice(2, 10)}`);

  // Verify audit records
  assert.ok(auditRecords.some((r) => r.type === "prompt" && r.attempt === 0));
  assert.ok(auditRecords.some((r) => r.type === "response" && r.attempt === 0));
  assert.ok(auditRecords.some((r) => r.type === "candidate"));
  assert.ok(auditRecords.some((r) => r.type === "summary"));
});

test("proposePolicy > handles invalid JSON and schema errors, recovering on retry", async () => {
  const incumbent = createV0Spec("20261101", defaultParams);
  const auditRecords: AuditStepRecord[] = [];

  // Attempt 0: malformed JSON text
  const response0 = "```json\n{ hypothesis: broken json unquoted, \n```";

  // Attempt 1: valid JSON but schema violation (minBps > maxBps, and tuner not last)
  const response1 = JSON.stringify({
    parent: incumbent.id,
    hypothesis: "Broken bounds candidate",
    pairs: ["HSK/USDT", "ETH/USDT"],
    reference: { kind: "depthWeighted", params: {} },
    terms: [
      { kind: "tuner", params: {} },
      { kind: "base", params: { bps: { "HSK/USDT": 15, "ETH/USDT": 10 } } },
    ],
    clamp: { minBps: 300, maxBps: 50 },
    ttl: { kind: "volScaled", ttlVolK: 1.5, minSec: 5, maxSec: 30 },
  });

  // Attempt 2: corrected valid candidate
  const response2 = JSON.stringify({
    parent: incumbent.id,
    hypothesis: "Corrected candidate with valid bounds and proper term ordering",
    pairs: ["HSK/USDT", "ETH/USDT"],
    reference: { kind: "depthWeighted", params: {} },
    terms: [
      { kind: "base", params: { bps: { "HSK/USDT": 15, "ETH/USDT": 10 } } },
      { kind: "vol", params: { k: 2.0 } },
      { kind: "tuner", params: {} },
    ],
    clamp: { minBps: 5, maxBps: 200 },
    ttl: { kind: "volScaled", ttlVolK: 1.5, minSec: 5, maxSec: 30 },
  });

  const mock = createMockFetcher([
    { bodyText: response0 },
    { bodyText: response1 },
    { bodyText: response2 },
  ]);

  const result = await proposePolicy({
    diagnosis: SAMPLE_DIAGNOSIS,
    devStats: SAMPLE_DEV_STATS,
    incumbent,
    date: "20261101",
    apiKey: "test-api-key",
    fetcher: mock.fetcher,
    auditWriter: (record) => {
      auditRecords.push(record);
    },
  });

  assert.equal(mock.getCallCount(), 3);
  assert.equal(result.attempts, 3);
  assert.equal(result.candidate.parent, incumbent.id);

  // Check validation failures were audited
  const validationAudits = auditRecords.filter((r) => r.type === "validation");
  assert.equal(validationAudits.length, 2);

  // Check the second prompt received the JSON parse error feedback
  const requests = mock.getRequests();
  const req1Body = requests[1]?.parsedBody as {
    contents: Array<{ parts: Array<{ text: string }> }>;
  };
  assert.ok(
    req1Body.contents.some((c) => c.parts.some((p) => p.text.includes("JSON parse error"))),
  );

  // Check the third prompt received the schema validation error feedback
  const req2Body = requests[2]?.parsedBody as {
    contents: Array<{ parts: Array<{ text: string }> }>;
  };
  assert.ok(
    req2Body.contents.some((c) =>
      c.parts.some(
        (p) =>
          p.text.includes("minBps must not exceed maxBps") || p.text.includes("Tuner must be last"),
      ),
    ),
  );
});

test("proposePolicy > retry exhaustion after maxRetries fails cleanly", async () => {
  const incumbent = createV0Spec("20261101", defaultParams);
  const auditRecords: AuditStepRecord[] = [];

  // Persistent invalid response: invalid parent and out-of-range parameters
  const invalidBody = JSON.stringify({
    parent: "p-19990101-wrong000",
    hypothesis: "Invalid parent test",
    pairs: ["HSK/USDT", "ETH/USDT"],
    reference: { kind: "depthWeighted", params: {} },
    terms: [
      { kind: "base", params: { bps: { "HSK/USDT": 150, "ETH/USDT": 10 } } }, // 150 > max 100
    ],
    clamp: { minBps: 5, maxBps: 200 },
    ttl: { kind: "volScaled", ttlVolK: 1.5, minSec: 5, maxSec: 30 },
  });

  const mock = createMockFetcher([
    { bodyText: invalidBody },
    { bodyText: invalidBody },
    { bodyText: invalidBody },
    { bodyText: invalidBody },
  ]);

  let thrownError: unknown = null;
  try {
    await proposePolicy({
      diagnosis: SAMPLE_DIAGNOSIS,
      devStats: SAMPLE_DEV_STATS,
      incumbent,
      date: "20261101",
      apiKey: "test-api-key",
      maxRetries: 3,
      fetcher: mock.fetcher,
      auditWriter: (record) => {
        auditRecords.push(record);
      },
    });
  } catch (err: unknown) {
    thrownError = err;
  }

  assert.ok(thrownError instanceof ProposerRetryExhaustedError);
  assert.equal((thrownError as ProposerRetryExhaustedError).attempts, 4);
  assert.equal(mock.getCallCount(), 4);
  assert.ok(auditRecords.some((r) => r.type === "failure"));
});

test("proposePolicy > rejects unsupported components and mandate-incompatible clamps", async () => {
  const incumbent = createV0Spec("20261101", defaultParams);

  // 1. Unsupported Tier 3 component (reservationFee)
  const unsupportedComponentBody = JSON.stringify({
    parent: incumbent.id,
    hypothesis: "Unsupported component",
    pairs: ["HSK/USDT", "ETH/USDT"],
    reference: { kind: "depthWeighted", params: {} },
    terms: [
      { kind: "base", params: { bps: { "HSK/USDT": 15, "ETH/USDT": 10 } } },
      { kind: "reservationFee", params: { floorBps: 10 } },
    ],
    clamp: { minBps: 5, maxBps: 200 },
    ttl: { kind: "volScaled", ttlVolK: 1.5, minSec: 5, maxSec: 30 },
  });

  const mockUnsupported = createMockFetcher([
    { bodyText: unsupportedComponentBody },
    { bodyText: unsupportedComponentBody },
  ]);

  await assert.rejects(
    async () => {
      await proposePolicy({
        diagnosis: SAMPLE_DIAGNOSIS,
        devStats: SAMPLE_DEV_STATS,
        incumbent,
        date: "20261101",
        apiKey: "test-api-key",
        maxRetries: 1,
        fetcher: mockUnsupported.fetcher,
        auditWriter: () => {},
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ProposerRetryExhaustedError);
      assert.ok(err.message.includes("terms.1.kind"));
      return true;
    },
  );

  // 2. Mandate/owner-incompatible clamp: maxBps (400) exceeds owner spread max (300 bps)
  const mandateExceededBody = JSON.stringify({
    parent: incumbent.id,
    hypothesis: "Clamp exceeds mandate service cap",
    pairs: ["HSK/USDT", "ETH/USDT"],
    reference: { kind: "depthWeighted", params: {} },
    terms: [{ kind: "base", params: { bps: { "HSK/USDT": 15, "ETH/USDT": 10 } } }],
    clamp: { minBps: 5, maxBps: 400 },
    ttl: { kind: "volScaled", ttlVolK: 1.5, minSec: 5, maxSec: 30 },
  });

  const mockMandate = createMockFetcher([
    { bodyText: mandateExceededBody },
    { bodyText: mandateExceededBody },
  ]);

  await assert.rejects(
    async () => {
      await proposePolicy({
        diagnosis: SAMPLE_DIAGNOSIS,
        devStats: SAMPLE_DEV_STATS,
        incumbent,
        date: "20261101",
        apiKey: "test-api-key",
        maxRetries: 1,
        fetcher: mockMandate.fetcher,
        auditWriter: () => {},
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ProposerRetryExhaustedError);
      assert.ok(err.message.includes("Policy clamp exceeds owner spread or mandate limits"));
      return true;
    },
  );
});

test("proposePolicy > handles missing credentials, provider failures, and timeouts without retrying", async () => {
  const incumbent = createV0Spec("20261101", defaultParams);

  // 1. Missing credentials fails synchronously without calling fetcher
  const mock0 = createMockFetcher([]);
  await assert.rejects(
    async () => {
      await proposePolicy({
        diagnosis: SAMPLE_DIAGNOSIS,
        devStats: SAMPLE_DEV_STATS,
        incumbent,
        date: "20261101",
        apiKey: "", // empty
        fetcher: mock0.fetcher,
        auditWriter: () => {},
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ProposerConfigError);
      assert.equal(mock0.getCallCount(), 0);
      return true;
    },
  );

  // 2. HTTP 500 error from provider throws immediately, does not retry
  const mock500 = createMockFetcher([
    { status: 500, statusText: "Internal Server Error", bodyText: "Model overloaded" },
  ]);

  await assert.rejects(
    async () => {
      await proposePolicy({
        diagnosis: SAMPLE_DIAGNOSIS,
        devStats: SAMPLE_DEV_STATS,
        incumbent,
        date: "20261101",
        apiKey: "test-api-key",
        maxRetries: 3,
        fetcher: mock500.fetcher,
        auditWriter: () => {},
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ProposerProviderError);
      assert.equal((err as ProposerProviderError).status, 500);
      assert.equal(mock500.getCallCount(), 1);
      return true;
    },
  );

  // 3. Network timeout throws ProposerTimeoutError immediately
  const mockTimeout = createMockFetcher([
    {
      throwError: new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    },
  ]);

  await assert.rejects(
    async () => {
      await proposePolicy({
        diagnosis: SAMPLE_DIAGNOSIS,
        devStats: SAMPLE_DEV_STATS,
        incumbent,
        date: "20261101",
        apiKey: "test-api-key",
        timeoutMs: 10,
        fetcher: mockTimeout.fetcher,
        auditWriter: () => {},
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ProposerTimeoutError || err instanceof ProposerProviderError);
      assert.equal(mockTimeout.getCallCount(), 1);
      return true;
    },
  );
});

test("redactSecrets > completely sanitizes API keys and authorization headers from strings, objects, and errors", () => {
  const secretKey = "AIzaSyTestSecretKey987654321012345";
  const extraToken = "super_secret_operator_token_1234";

  const rawPayload = {
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini?key=${secretKey}`,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": secretKey,
      Authorization: `Bearer ${extraToken}`,
    },
    errorMessage: `Request failed with key ${secretKey} and token ${extraToken}`,
    nested: {
      apiKey: secretKey,
      logs: [`Key ${secretKey} was used`],
    },
  };

  const sanitized = redactSecrets(rawPayload, [secretKey, extraToken]);

  assert.equal(sanitized.headers["x-goog-api-key"], "[REDACTED]");
  assert.equal(sanitized.headers.Authorization, "[REDACTED]");
  assert.equal(sanitized.nested.apiKey, "[REDACTED]");
  assert.ok(!sanitized.url.includes(secretKey));
  assert.ok(sanitized.url.includes("key=[REDACTED]"));
  assert.ok(!sanitized.errorMessage.includes(secretKey));
  assert.ok(!sanitized.errorMessage.includes(extraToken));
  assert.ok(!sanitized.nested.logs[0]?.includes(secretKey));
});

test("proposePolicy > file audit logging writes sanitized files and redacts credentials", async () => {
  const incumbent = createV0Spec("20261101", defaultParams);
  const tempRunsDir = path.resolve(`temp-test-runs-${Date.now()}`);
  const secretKey = "AIzaSySecretInAudit987654321098765";

  const candidateBody = {
    parent: incumbent.id,
    hypothesis: "Audit trail test candidate",
    pairs: ["HSK/USDT", "ETH/USDT"],
    reference: { kind: "depthWeighted", params: {} },
    terms: [
      { kind: "base", params: { bps: { "HSK/USDT": 15, "ETH/USDT": 10 } } },
      { kind: "vol", params: { k: 2.0 } },
      { kind: "tuner", params: {} },
    ],
    clamp: { minBps: 5, maxBps: 200 },
    ttl: { kind: "volScaled", ttlVolK: 1.5, minSec: 5, maxSec: 30 },
  };

  const mock = createMockFetcher([
    {
      bodyText: JSON.stringify(candidateBody),
    },
  ]);

  try {
    const result = await proposePolicy({
      diagnosis: SAMPLE_DIAGNOSIS,
      devStats: SAMPLE_DEV_STATS,
      incumbent,
      date: "20261101",
      apiKey: secretKey,
      runsDir: tempRunsDir,
      fetcher: mock.fetcher,
    });

    const runDir = path.resolve(tempRunsDir, result.runId);
    const files = await fs.readdir(runDir);

    assert.ok(files.includes("prompt-0.json"));
    assert.ok(files.includes("response-0.json"));
    assert.ok(files.includes("candidate.json"));
    assert.ok(files.includes("summary.json"));

    // Check all written files to ensure secretKey is never present
    for (const file of files) {
      const content = await fs.readFile(path.resolve(runDir, file), "utf-8");
      assert.ok(!content.includes(secretKey), `File ${file} contained unredacted secret!`);
    }
  } finally {
    // Cleanup temporary directory
    await fs.rm(tempRunsDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("proposePolicy > held-out protection strictly rejects held-out inputs without calling fetcher", async () => {
  const incumbent = createV0Spec("20261101", defaultParams);
  const mock = createMockFetcher([]);

  // 1. Diagnosis marked heldOut: true
  await assert.rejects(
    async () => {
      await proposePolicy({
        diagnosis: { ...SAMPLE_DIAGNOSIS, heldOut: true },
        devStats: SAMPLE_DEV_STATS,
        incumbent,
        date: "20261101",
        apiKey: "test-api-key",
        fetcher: mock.fetcher,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof HeldOutAccessError);
      assert.equal(mock.getCallCount(), 0);
      return true;
    },
  );

  // 2. Dev stats contains dataset with kind: "heldout"
  await assert.rejects(
    async () => {
      await proposePolicy({
        diagnosis: SAMPLE_DIAGNOSIS,
        devStats: {
          datasets: [{ name: "synthetic-heldout-leadlag", kind: "heldout" }],
        },
        incumbent,
        date: "20261101",
        apiKey: "test-api-key",
        fetcher: mock.fetcher,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof HeldOutAccessError);
      assert.equal(mock.getCallCount(), 0);
      return true;
    },
  );

  // 3. Dev stats contains scenario manifest marked heldOut: true
  await assert.rejects(
    async () => {
      await proposePolicy({
        diagnosis: SAMPLE_DIAGNOSIS,
        devStats: {
          manifests: [{ name: "leadlag", heldOut: true }],
        },
        incumbent,
        date: "20261101",
        apiKey: "test-api-key",
        fetcher: mock.fetcher,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof HeldOutAccessError);
      assert.equal(mock.getCallCount(), 0);
      return true;
    },
  );
});

test("proposePolicy > no file/network access beyond explicitly supplied inputs and injected transport", async () => {
  const incumbent = createV0Spec("20261101", defaultParams);

  const candidateBody = {
    parent: incumbent.id,
    hypothesis: "Isolated input test",
    pairs: ["HSK/USDT", "ETH/USDT"],
    reference: { kind: "depthWeighted", params: {} },
    terms: [
      { kind: "base", params: { bps: { "HSK/USDT": 15, "ETH/USDT": 10 } } },
      { kind: "vol", params: { k: 2.0 } },
      { kind: "tuner", params: {} },
    ],
    clamp: { minBps: 5, maxBps: 200 },
    ttl: { kind: "volScaled", ttlVolK: 1.5, minSec: 5, maxSec: 30 },
  };

  const mock = createMockFetcher([
    {
      bodyText: JSON.stringify(candidateBody),
    },
  ]);

  const auditEvents: string[] = [];

  const result = await proposePolicy({
    diagnosis: SAMPLE_DIAGNOSIS,
    devStats: SAMPLE_DEV_STATS,
    incumbent,
    date: "20261101",
    apiKey: "test-api-key",
    fetcher: mock.fetcher,
    auditWriter: (record) => {
      auditEvents.push(record.type);
    },
  });

  assert.equal(result.attempts, 1);
  assert.equal(mock.getCallCount(), 1);

  // Inspect the prompt sent over the injected fetcher
  const requests = mock.getRequests();
  const promptBody = requests[0]?.parsedBody as {
    contents: Array<{ parts: Array<{ text: string }> }>;
  };
  const promptText = promptBody.contents[0]?.parts[0]?.text ?? "";

  // Prompt must contain ONLY the supplied facts
  assert.ok(promptText.includes("ZETHOS MARKET-MAKING POLICY PROPOSAL REQUEST"));
  assert.ok(promptText.includes("1250.5")); // from diagnosis
  assert.ok(promptText.includes("synthetic-dev-tape")); // from dev stats
  assert.ok(promptText.includes(incumbent.id)); // from incumbent

  // Prompt must NEVER include attacker code, sniper repo contents, or extraneous data
  assert.ok(!promptText.includes("apps/sniper"));
  assert.ok(!promptText.includes("attack.ts"));
  assert.ok(!promptText.includes("lead-lag attack"));
});

test("CLI scripts/research-propose.ts > enforces flags, exit codes, and usage", async () => {
  const cliPath = path.resolve("scripts/research-propose.ts");

  // 1. --help exits 0
  const helpProc = Bun.spawn(["bun", cliPath, "--help"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const helpCode = await helpProc.exited;
  const helpStdout = await new Response(helpProc.stdout).text();
  assert.equal(helpCode, 0);
  assert.ok(helpStdout.includes("Usage: bun scripts/research-propose.ts"));

  // 2. Missing required flags exits 2
  const missingProc = Bun.spawn(["bun", cliPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const missingCode = await missingProc.exited;
  assert.equal(missingCode, 2);

  // 3. Invalid date exits 2
  const invalidDateProc = Bun.spawn(
    ["bun", cliPath, "--diagnosis=none.json", "--dev-stats=none.json", "--date=invalid-date"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const invalidDateCode = await invalidDateProc.exited;
  assert.equal(invalidDateCode, 2);

  // 4. Missing API key exits 1
  const tmpDir = path.resolve(`temp-cli-test-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const diagPath = path.resolve(tmpDir, "diag.json");
  const statsPath = path.resolve(tmpDir, "stats.json");
  await fs.writeFile(diagPath, JSON.stringify(SAMPLE_DIAGNOSIS));
  await fs.writeFile(statsPath, JSON.stringify(SAMPLE_DEV_STATS));

  try {
    const noKeyProc = Bun.spawn(
      ["bun", cliPath, `--diagnosis=${diagPath}`, `--dev-stats=${statsPath}`, "--date=20261101"],
      {
        env: { ...process.env, GEMINI_API_KEY: "" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const noKeyCode = await noKeyProc.exited;
    const noKeyStderr = await new Response(noKeyProc.stderr).text();
    assert.equal(noKeyCode, 1);
    assert.ok(noKeyStderr.includes("GEMINI_API_KEY must be provided"));

    const rejectedKeyFlag = Bun.spawn(["bun", cliPath, "--api-key=should-not-be-echoed"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const rejectedKeyFlagCode = await rejectedKeyFlag.exited;
    const rejectedKeyFlagStderr = await new Response(rejectedKeyFlag.stderr).text();
    assert.equal(rejectedKeyFlagCode, 2);
    assert.ok(!rejectedKeyFlagStderr.includes("should-not-be-echoed"));
    assert.ok(rejectedKeyFlagStderr.includes("Unknown option '--api-key'"));

    // 5. Held-out input rejection exits 1 with HeldOutAccessError
    const heldOutDiagPath = path.resolve(tmpDir, "heldout-diag.json");
    await fs.writeFile(heldOutDiagPath, JSON.stringify({ ...SAMPLE_DIAGNOSIS, heldOut: true }));

    const heldOutProc = Bun.spawn(
      [
        "bun",
        cliPath,
        `--diagnosis=${heldOutDiagPath}`,
        `--dev-stats=${statsPath}`,
        "--date=20261101",
      ],
      {
        env: { ...process.env, GEMINI_API_KEY: "dummy-key" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const heldOutCode = await heldOutProc.exited;
    const heldOutStderr = await new Response(heldOutProc.stderr).text();
    assert.equal(heldOutCode, 1);
    assert.ok(heldOutStderr.includes("HeldOutAccessError") || heldOutStderr.includes("held-out"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
