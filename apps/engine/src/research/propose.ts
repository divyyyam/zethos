import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GEMINI_MODEL, defaultParams, type Params } from "../config";
import { defaultMandate, loadMandate, type Mandate } from "../policy/mandate";
import { createPolicySpec, hashPolicySpec } from "./canonical";
import { compile } from "./compile";
import { HeldOutAccessError } from "./scenarios";
import {
  type PolicyBody,
  type PolicySpec,
  policyBodySchema,
  policyDateSchema,
  policySpecSchema,
} from "./schema";

export class ProposerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposerError";
  }
}

export class ProposerConfigError extends ProposerError {
  constructor(message: string) {
    super(message);
    this.name = "ProposerConfigError";
  }
}

export class ProposerProviderError extends ProposerError {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProposerProviderError";
  }
}

export class ProposerTimeoutError extends ProposerError {
  constructor(message: string) {
    super(message);
    this.name = "ProposerTimeoutError";
  }
}

export class ProposerValidationError extends ProposerError {
  constructor(
    message: string,
    public readonly issues: readonly string[] = [],
  ) {
    super(message);
    this.name = "ProposerValidationError";
  }
}

export class ProposerRetryExhaustedError extends ProposerError {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastIssues: readonly string[] = [],
  ) {
    super(message);
    this.name = "ProposerRetryExhaustedError";
  }
}

/**
 * Asserts that an input object or file does not contain or reference held-out scenarios or data.
 * Fails closed with HeldOutAccessError.
 */
export function assertNotHeldOut(data: unknown, label = "Input"): void {
  if (data === null || typeof data !== "object") return;
  const obj = data as Record<string, unknown>;

  if (obj.heldOut === true) {
    throw new HeldOutAccessError(`${label} is marked held-out; proposer access is strictly denied`);
  }
  if (obj.kind === "heldout") {
    throw new HeldOutAccessError(`${label} has kind 'heldout'; proposer access is strictly denied`);
  }
  if (typeof obj.name === "string" && obj.name.includes("heldout")) {
    throw new HeldOutAccessError(
      `${label} references held-out scenario '${obj.name}'; proposer access is strictly denied`,
    );
  }

  if (Array.isArray(obj.datasets)) {
    for (const dataset of obj.datasets) {
      if (dataset && typeof dataset === "object") {
        const d = dataset as Record<string, unknown>;
        if (d.heldOut === true || d.kind === "heldout") {
          throw new HeldOutAccessError(
            `${label} contains held-out dataset '${String(d.name ?? "unnamed")}'; proposer access is strictly denied`,
          );
        }
      }
    }
  }

  if (Array.isArray(obj.manifests)) {
    for (const manifest of obj.manifests) {
      if (manifest && typeof manifest === "object") {
        const m = manifest as Record<string, unknown>;
        if (m.heldOut === true) {
          throw new HeldOutAccessError(
            `${label} contains held-out manifest '${String(m.name ?? "unnamed")}'; proposer access is strictly denied`,
          );
        }
      }
    }
  }
}

/**
 * Redacts API keys, secret credentials, and authorization headers from strings, objects, and URLs.
 */
export function redactSecrets<T>(data: T, secrets: readonly string[] = []): T {
  const activeSecrets = secrets.filter((s): s is string => typeof s === "string" && s.length >= 4);

  function sanitizeString(str: string): string {
    let result = str;
    for (const secret of activeSecrets) {
      result = result.replaceAll(secret, "[REDACTED]");
    }
    // Google AI Studio / Gemini API key pattern (AIzaSy...)
    result = result.replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED]");
    // URL query key parameter
    result = result.replace(/([?&]key=)[^&]+/g, "$1[REDACTED]");
    // Authorization / Bearer tokens
    result = result.replace(/(Bearer\s+)[A-Za-z0-9-_.]+/gi, "$1[REDACTED]");
    return result;
  }

  function walk(val: unknown): unknown {
    if (typeof val === "string") {
      return sanitizeString(val);
    }
    if (Array.isArray(val)) {
      return val.map(walk);
    }
    if (val !== null && typeof val === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        const lowerKey = k.toLowerCase();
        if (
          lowerKey === "x-goog-api-key" ||
          lowerKey === "authorization" ||
          lowerKey === "apikey" ||
          lowerKey === "api_key" ||
          lowerKey === "admin_token"
        ) {
          out[k] = "[REDACTED]";
        } else if (lowerKey === "env" || lowerKey === "process.env") {
          out[k] = "[REDACTED]";
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return val;
  }

  return walk(data) as T;
}

/**
 * Extracts raw JSON string from LLM response text, stripping markdown code fences if present.
 */
export function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export const COMPONENT_LIBRARY_DOCUMENTATION = `
### Zethos Declarative Market-Making Policy Language (Tier 2)

A PolicySpec defines deterministic pricing rules. The candidate output must be a strict JSON object matching the PolicyBody schema.

#### References:
- "depthWeighted": Merged-book size-walk (params: {})
- "median": Median of current accepted fresh venue mids (params: {})
- "leadWeighted": Convex combination of size-walk with lead mid (params: { leadVenues: ["hashkey-global" | "binance"], leadWeight: number (0..0.9), lookbackSec: number (1..60) })

#### Components (Terms):
At most 9 unique components. Terms are summed in array order. If "tuner" is present, it MUST be the last term.
1. "base": Pair constant half-spread bps (params: { bps: { "HSK/USDT": number (1..100), "ETH/USDT": number (1..100) } })
2. "vol": Volatility scaling (params: { k: number (0..5) }) -> k * sigma1 * sqrt(ttl)
3. "inventory": Inventory skew (params: { k: number (0..0.01) }) -> k * (baseShare - targetShare)
4. "toxicity": Taker tier penalty (params: { scale: number (0..2) }) -> scale * tier.sigmaAdd * sigma1 * sqrt(ttl)
5. "depthWithdrawal": Sudden depth withdrawal defense (params: { dropPct: number (0.1..0.9), windowSec: number (1..30), addBps: number (0..100) })
6. "leadMove": Lead venue divergence defense (params: { thresholdBps: number (1..100), windowSec: number (1..30), addBps: number (0..100) })
7. "restoreCost": Rebalance hedge cost addition (params: { k: number (0..2) })
8. "sizeCurve": Large trade notional widening (params: { exponent: number (0.5..2), kBps: number (0..50) })
9. "tuner": Multiplies clamped spread by live tuner (params: {}) -> MUST be last in terms!

#### Clamp & TTL:
- clamp: { minBps: number, maxBps: number } with 0 < minBps <= maxBps < 10000. Must not exceed owner spread bounds or mandate service spread caps.
- ttl: { kind: "volScaled", ttlVolK: number (> 0), minSec: integer (1..120), maxSec: integer (1..120) } with minSec <= maxSec.
- rejectIf (optional): { maxSigma1?: number (>= 0), minSources?: integer (1..6), leadDivergenceBps?: number (> 0) }

#### Invariants:
- The output JSON must NEVER include executable code or functions.
- The parent field must be exactly the incumbent ID.
- Pairs must match the mandated pairs (e.g. ["HSK/USDT", "ETH/USDT"]).
- Base bps must specify bps for every declared pair.
- The hypothesis string must be concise (max 500 characters) explaining why this change counters the loss causes.
`.trim();

export interface AuditStepRecord {
  type: "prompt" | "response" | "validation" | "candidate" | "summary" | "failure";
  attempt: number;
  timestamp: number;
  payload: unknown;
}

export type AuditWriter = (record: AuditStepRecord) => Promise<void> | void;

/**
 * Creates a file-based audit writer that stores prompts, responses, validations, and final candidates.
 * Redacts secrets from every written file.
 */
export function createFileAuditWriter(
  runsDir: string,
  runId: string,
  secrets: readonly string[] = [],
): AuditWriter {
  const targetDir = path.resolve(runsDir, runId);
  let dirReady: Promise<void> | null = null;

  async function ensureDirectory(): Promise<void> {
    if (!dirReady) {
      dirReady = (async () => {
        const fsPromises = fs as unknown as {
          mkdir?: (p: string, options?: { recursive?: boolean }) => Promise<void>;
        };
        if (typeof fsPromises.mkdir === "function") {
          await fsPromises.mkdir(targetDir, { recursive: true });
        }
      })();
    }
    await dirReady;
  }

  return async (record: AuditStepRecord) => {
    await ensureDirectory();
    const redacted = redactSecrets(record, secrets);
    const filename = `${record.type}-${record.attempt}.json`;
    await fs.writeFile(
      path.resolve(targetDir, filename),
      JSON.stringify(redacted.payload, null, 2),
    );
    if (record.type === "candidate") {
      await fs.writeFile(
        path.resolve(targetDir, "candidate.json"),
        JSON.stringify(redacted.payload, null, 2),
      );
    }
    if (record.type === "summary") {
      await fs.writeFile(
        path.resolve(targetDir, "summary.json"),
        JSON.stringify(redacted.payload, null, 2),
      );
    }
  };
}

export interface ProposeOptions {
  /** Validated loss diagnosis data (from attributeLosses or GET /diagnosis). */
  diagnosis: unknown;
  /** Aggregate development performance statistics (from evaluatePolicies or dev tape replay). */
  devStats: unknown;
  /** Current incumbent policy spec that serves as the parent. */
  incumbent: PolicySpec;
  /** Explicit UTC calendar date in yyyymmdd format. */
  date: string;
  /** Desk mandate limits (defaults to defaultMandate). */
  mandate?: Mandate | undefined;
  /** Engine strategy parameters (defaults to defaultParams). */
  params?: Params | undefined;
  /** Gemini model name (defaults to GEMINI_MODEL env or DEFAULT_GEMINI_MODEL). */
  model?: string | undefined;
  /** Gemini API key (defaults to GEMINI_API_KEY env). */
  apiKey?: string | undefined;
  /** Maximum retry attempts after initial proposal failure (defaults to 3). */
  maxRetries?: number | undefined;
  /** Per-request timeout in milliseconds (defaults to 30000). */
  timeoutMs?: number | undefined;
  /** Base runs directory for file audit logging (defaults to "research-runs"). */
  runsDir?: string | undefined;
  /** Custom run ID (defaults to auto-generated identifier). */
  runId?: string | undefined;
  /** Injected network fetcher for Gemini API calls. */
  fetcher?: typeof fetch | undefined;
  /** Injected audit writer callback. */
  auditWriter?: AuditWriter | undefined;
  /** Injected clock function returning ms timestamp. */
  now?: (() => number) | undefined;
}

export interface ProposeResult {
  candidate: PolicySpec;
  hypothesis: string;
  specHash: string;
  runId: string;
  attempts: number;
}

type GeminiContent = {
  role: "user" | "model";
  parts: { text: string }[];
};

/**
 * Builds the initial user prompt containing validated diagnosis, dev statistics, incumbent spec,
 * component library documentation, and strict response formatting instructions.
 */
function buildInitialPrompt(
  diagnosis: unknown,
  devStats: unknown,
  incumbent: PolicySpec,
  mandate: Mandate,
): string {
  return [
    `# ZETHOS MARKET-MAKING POLICY PROPOSAL REQUEST`,
    ``,
    `## 1. Validated Loss Diagnosis (S6)`,
    JSON.stringify(diagnosis, null, 2),
    ``,
    `## 2. Development Dataset Performance Statistics`,
    JSON.stringify(devStats, null, 2),
    ``,
    `## 3. Current Incumbent Policy (${incumbent.id})`,
    JSON.stringify(incumbent, null, 2),
    ``,
    `## 4. Approved Component Library & Constraints`,
    COMPONENT_LIBRARY_DOCUMENTATION,
    ``,
    `Mandate service spread caps: ${JSON.stringify(mandate.service.maxHalfSpreadBps)}`,
    `Mandate pairs: ${JSON.stringify(mandate.pairs)}`,
    ``,
    `## 5. Instructions`,
    `- Formulate a hypothesis explaining how your proposed changes mitigate the diagnosed loss causes.`,
    `- Return a JSON object representing the candidate PolicyBody.`,
    `- "parent" must be exactly "${incumbent.id}".`,
    `- "hypothesis" must be a concise string (max 500 characters).`,
    `- "pairs" must be ${JSON.stringify(incumbent.pairs)}.`,
    `- Ensure all parameter bounds and component uniqueness rules are strictly satisfied.`,
    `- If "tuner" is included, it MUST be the last term in "terms".`,
    `- Output ONLY valid JSON matching the PolicyBody schema, with no commentary outside the JSON.`,
  ].join("\n");
}

/**
 * Proposes a candidate PolicySpec using Gemini, validating output strictly against schemas,
 * bounds, mandate limits, and compilation. Bounded to at most maxRetries correction attempts.
 */
export async function proposePolicy(options: ProposeOptions): Promise<ProposeResult> {
  const clock = options.now ?? Date.now;
  const startTime = clock();

  // 1. Held-out guards: strictly fail closed before any processing or network calls
  assertNotHeldOut(options.diagnosis, "Diagnosis");
  assertNotHeldOut(options.devStats, "Dev statistics");

  // 2. Validate explicit date and incumbent spec
  const dateParsed = policyDateSchema.safeParse(options.date);
  if (!dateParsed.success) {
    throw new ProposerValidationError(`Invalid UTC date: ${dateParsed.error.issues[0]?.message}`);
  }
  const date = dateParsed.data;

  const incumbentParsed = policySpecSchema.safeParse(options.incumbent);
  if (!incumbentParsed.success) {
    throw new ProposerValidationError(
      `Invalid incumbent spec: ${incumbentParsed.error.issues[0]?.message}`,
    );
  }
  const incumbent = incumbentParsed.data;

  const mandate = loadMandate(options.mandate ?? defaultMandate);
  const params = options.params ?? defaultParams;
  const maxRetries = options.maxRetries ?? 3;
  const timeoutMs = options.timeoutMs ?? 30000;
  const model = options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.trim() === "") {
    throw new ProposerConfigError("GEMINI_API_KEY is required to generate policy proposals");
  }

  const runId =
    options.runId ??
    `run-${date}-${clock().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const auditWriter =
    options.auditWriter ??
    (options.runsDir
      ? createFileAuditWriter(options.runsDir, runId, [apiKey])
      : createFileAuditWriter("research-runs", runId, [apiKey]));

  const initialUserPrompt = buildInitialPrompt(
    options.diagnosis,
    options.devStats,
    incumbent,
    mandate,
  );

  const contents: GeminiContent[] = [
    {
      role: "user",
      parts: [{ text: initialUserPrompt }],
    },
  ];

  const fetcher = options.fetcher ?? fetch;
  const totalAllowedAttempts = maxRetries + 1; // 1 initial + maxRetries retries
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < totalAllowedAttempts; attempt++) {
    // Record prompt audit (secrets redacted by audit writer)
    await auditWriter({
      type: "prompt",
      attempt,
      timestamp: clock(),
      payload: redactSecrets(contents, [apiKey]),
    });

    const signal = AbortSignal.timeout(timeoutMs);
    let responseText = "";

    try {
      const response = await fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          signal,
          body: JSON.stringify({
            contents,
            systemInstruction: {
              parts: [
                {
                  text: "You are an expert quantitative researcher for Zethos. Return only valid JSON representing a PolicyBody.",
                },
              ],
            },
            generationConfig: {
              temperature: 0.2,
              responseMimeType: "application/json",
            },
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const sanitizedMsg = redactSecrets(
          `Gemini request failed: HTTP ${response.status} ${response.statusText} ${errorText}`.trim(),
          [apiKey],
        );
        throw new ProposerProviderError(sanitizedMsg, response.status);
      }

      const responseJson = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const candidateContent = responseJson.candidates?.[0]?.content;
      responseText = candidateContent?.parts?.map((p) => p.text ?? "").join("\n") ?? "";

      if (!responseText.trim()) {
        throw new ProposerProviderError("Gemini returned empty candidate content");
      }
    } catch (err: unknown) {
      if (signal.aborted) {
        throw new ProposerTimeoutError(`Gemini request timed out after ${timeoutMs}ms`);
      }
      if (err instanceof ProposerError) {
        throw err;
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      throw new ProposerProviderError(
        redactSecrets(`Gemini network call failed: ${rawMsg}`, [apiKey]),
      );
    }

    // Record raw response audit
    await auditWriter({
      type: "response",
      attempt,
      timestamp: clock(),
      payload: responseText,
    });

    // Parse and validate the response
    const issues: string[] = [];
    let parsedJson: unknown;

    try {
      const jsonStr = extractJsonText(responseText);
      parsedJson = JSON.parse(jsonStr);
    } catch (jsonErr: unknown) {
      issues.push(
        `JSON parse error: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`,
      );
    }

    if (issues.length === 0 && parsedJson && typeof parsedJson === "object") {
      // Allow unnesting if the model wrapped the body in candidate, policy, or body
      const raw = parsedJson as Record<string, unknown>;
      const candidateBody =
        raw.candidate && typeof raw.candidate === "object"
          ? raw.candidate
          : raw.policy && typeof raw.policy === "object"
            ? raw.policy
            : raw.body && typeof raw.body === "object"
              ? raw.body
              : raw;

      // Never trust an LLM-provided ID or specHash; strip if present
      delete (candidateBody as Record<string, unknown>).id;
      delete (candidateBody as Record<string, unknown>).specHash;

      // Validate against policyBodySchema
      const bodyParsed = policyBodySchema.safeParse(candidateBody);
      if (!bodyParsed.success) {
        for (const issue of bodyParsed.error.issues) {
          issues.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      } else {
        const body: PolicyBody = bodyParsed.data;

        // Verify parent matches incumbent
        if (body.parent !== incumbent.id) {
          issues.push(`Parent mismatch: expected '${incumbent.id}', got '${body.parent}'`);
        }

        // Verify declared pairs are within mandate
        for (const pair of body.pairs) {
          if (!mandate.pairs.includes(pair)) {
            issues.push(
              `Policy pair '${pair}' is outside desk mandate [${mandate.pairs.join(", ")}]`,
            );
          }
        }

        // Construct canonical PolicySpec locally
        let spec: PolicySpec | null = null;
        try {
          spec = createPolicySpec(body, date);
        } catch (specErr: unknown) {
          issues.push(
            `Canonical spec creation error: ${specErr instanceof Error ? specErr.message : String(specErr)}`,
          );
        }

        // Verify policy compiles against current mandate and params
        if (spec) {
          try {
            compile(spec, { mandate, params });
          } catch (compileErr: unknown) {
            issues.push(
              `Policy compilation error: ${compileErr instanceof Error ? compileErr.message : String(compileErr)}`,
            );
          }
        }

        if (issues.length === 0 && spec) {
          // Success!
          const specHash = hashPolicySpec(spec);
          await auditWriter({
            type: "candidate",
            attempt,
            timestamp: clock(),
            payload: spec,
          });

          await auditWriter({
            type: "summary",
            attempt,
            timestamp: clock(),
            payload: {
              runId,
              date,
              model,
              success: true,
              attempts: attempt + 1,
              candidateId: spec.id,
              specHash,
              hypothesis: spec.hypothesis,
              durationMs: clock() - startTime,
            },
          });

          return {
            candidate: spec,
            hypothesis: spec.hypothesis,
            specHash,
            runId,
            attempts: attempt + 1,
          };
        }
      }
    }

    lastIssues = issues;

    // Record validation failure
    await auditWriter({
      type: "validation",
      attempt,
      timestamp: clock(),
      payload: {
        valid: false,
        issues,
      },
    });

    if (attempt < maxRetries) {
      // Append assistant's response and correction prompt to conversation
      contents.push({
        role: "model",
        parts: [{ text: responseText }],
      });
      contents.push({
        role: "user",
        parts: [
          {
            text: [
              `The proposed policy failed validation with the following errors:`,
              ...issues.map((err) => `- ${err}`),
              ``,
              `Please correct these errors and return a corrected valid JSON PolicyBody.`,
              `Remember:`,
              `- "parent" must be exactly "${incumbent.id}".`,
              `- "pairs" must be ${JSON.stringify(incumbent.pairs)}.`,
              `- "clamp.minBps" must not exceed "clamp.maxBps".`,
              `- If "tuner" is in "terms", it MUST be the final term.`,
              `- Return ONLY the valid JSON object.`,
            ].join("\n"),
          },
        ],
      });
    }
  }

  // All retries exhausted
  await auditWriter({
    type: "failure",
    attempt: totalAllowedAttempts,
    timestamp: clock(),
    payload: {
      runId,
      date,
      model,
      success: false,
      attempts: totalAllowedAttempts,
      error: `Policy proposal failed validation after ${maxRetries} retries`,
      issues: lastIssues,
      durationMs: clock() - startTime,
    },
  });

  throw new ProposerRetryExhaustedError(
    `Policy proposal failed validation after ${maxRetries} retries: ${lastIssues.join("; ")}`,
    totalAllowedAttempts,
    lastIssues,
  );
}
