# Declarative policy library (R3)

Candidates are strict JSON data, never executable code. `compile` builds the pure S1 policy
from the components below. It binds copied pricing, feed and tier settings. It does not read
the network, wall clock, addresses, client names, flow labels or signer state.
Recompile policies after an owner configuration reload; an existing compiled policy keeps its
original configuration snapshot.

```ts
import { compile, createPolicySpec, createV0Spec, hashPolicySpec } from "./research";

const incumbent = createV0Spec("20261031"); // caller supplies the UTC date
const { id: _id, ...body } = incumbent;
const candidate = createPolicySpec(
  {
    ...body,
    hypothesis: "Widen when ask depth disappears before a buy.",
    terms: [
      ...body.terms.filter((term) => term.kind !== "tuner"),
      { kind: "depthWithdrawal", params: { dropPct: 0.5, windowSec: 10, addBps: 10 } },
      { kind: "tuner", params: {} },
    ],
  },
  "20261031",
);
const policy = compile(candidate); // optional second argument: { params, mandate }
const specHash = hashPolicySpec(candidate); // full keccak256, independent of its short ID
```

`policySpecSchema` checks every boundary and binds the ID to the content. Canonical JSON sorts
object keys recursively and preserves array order; the ID is excluded from the hash. A
content change requires a new ID. Dates are explicit real UTC calendar dates. The parent is
`v0` or another policy ID. Each kind may appear once; `tuner`, when present, must be last.
`createV0Spec` gives the incumbent's equivalent recipe a regular content-derived ID. The
engine's built-in incumbent keeps its existing `v0` identity.

## References and observations

All policies first require enough merged book depth for the requested size. A buy walks asks
by the quote budget; a sell walks bids by the base quantity from runtime token metadata.

| Reference       | Calculation                                                                                                                                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `depthWeighted` | The existing merged-book size walk, exactly as v0 uses it.                                                                                                                                                                                                                                      |
| `median`        | Median of current, accepted, configured, fresh venue mids. Reject when none remain.                                                                                                                                                                                                             |
| `leadWeighted`  | Blend the size walk with the median current lead mid, using `leadWeight`. A lead is eligible only when its move in `lookbackSec` and its current divergence from fused mid have the same nonzero sign. Missing eligible leads falls back to the size walk. Zero weight also uses the size walk. |

Fresh observations have status `ok`, a positive finite mid, and a receipt time no later than
`market.now` and no older than `feeds.staleMs`. Historical samples must be inside the requested
window and strictly older than the current observation. Future, stale, outlier and unconfigured
venues cannot trigger signals. History selects eligible leads; historical prices never become
the quote reference. The resulting reference stays in the convex range of current accepted
mids and the exact size walk, matching the independent execution guard.

For `leadMove` and `rejectIf.leadDivergenceBps`, the lead set is the reference's configured
`leadVenues` for `leadWeighted`, otherwise the pair's configured `feeds.tapeSource`. Every
declared lead must be configured for every pair the policy declares.

## Components

Contributions are spread fractions: `0.002` is 20 bps. `sigmaT = sigma1 * sqrt(ttlSec)`.
Additive components are summed in recipe order; the configured degraded-feed add is then
included. Clamp the sum, apply the optional tuner multiplier, and clamp again.

| Kind              | Contribution                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`            | Pair's `bps / 10000`. If it equals the configured bps, retain the exact configured fraction to avoid a floating-point roundtrip changing v0.                                                                                                                                                                                                                  |
| `vol`             | `k * sigmaT`.                                                                                                                                                                                                                                                                                                                                                 |
| `inventory`       | `k * (baseShare - targetShare)` for sells, its negative for buys.                                                                                                                                                                                                                                                                                             |
| `toxicity`        | `scale * tier.sigmaAdd * sigmaT`.                                                                                                                                                                                                                                                                                                                             |
| `depthWithdrawal` | `addBps / 10000` once if any accepted venue's depth fell by at least `dropPct` from its peak positive depth in `windowSec`. Buys inspect ask depth; sells inspect bid depth. Missing or zero baselines do not trigger.                                                                                                                                        |
| `leadMove`        | `addBps / 10000` once on buys for a positive lead move and positive lead/fused divergence, both at least `thresholdBps`; sells use the corresponding negative move/divergence. Movement uses the oldest valid sample in `windowSec`. No widening after fused catches up.                                                                                      |
| `restoreCost`     | Estimate the hedge to restore target: base USD minus target share of total pair USD determines the excess/deficit. Walk bids to sell excess base or asks to buy a deficit. Add `k * abs(excessUsd) / totalPairUsd * max(0, hedgeSlippageFraction)`. Zero equity, balanced inventory or zero `k` adds zero. Insufficient hedge depth rejects with `inventory`. |
| `sizeCurve`       | `(kBps / 10000) * (notionalUsd / ownerPairSizeCapUsd) ** exponent`. The denominator is the owner's per-pair swap cap; tier size restrictions remain in execution.                                                                                                                                                                                             |
| `tuner`           | Multiply the already clamped sum by `market.tuner`. Without it the multiplier is one.                                                                                                                                                                                                                                                                         |

TTL uses the existing floor-and-clamp algorithm with the recipe's `ttlVolK` and its min/max
seconds inside the owner's configured bounds. Zero volatility chooses the bounded maximum.
This preserves the legacy minimum-TTL clamp order exactly, including configurations where the
minimum exceeds a tier's TTL; execution rejects any result outside the actual tier/global
authority. Compilation does not bypass that final check.

`rejectIf` is checked before reference pricing: volatility above `maxSigma1` returns
`policy_rule`; accepted source count below `minSources` returns `degraded_reject`; absolute
current lead/fused divergence above `leadDivergenceBps` returns `lead_divergence`. Equality is
allowed for these maximums. Replay reconstruction must provide the same accepted-source count
as the engine, rather than count stale or rejected sources. A down market returns `halted`.

## Authority and scope

Compilation checks enabled/mandated pairs, configured lead venues, owner spread bounds and the
smallest mandate bucket's maximum spread. Per-request book impact, raw output amounts, current
and outstanding inventory exposure, tier caps, operating-loss pauses, signing and persistence
remain in the existing execution layer. Compilation alone does not qualify or activate a policy.
Do not treat a policy result as an executable promise until execution has accepted and signed it.

The nine Tier 2 components are supported. `reservationFee` is rejected while Tier 3 and its
reservation request fields remain gated. Evaluation,
qualification, proposal generation and the policy registry follow in separate checkpoints.

## S6 Loss attribution (`attributeLosses`)

Pure, deterministic evidence-based loss diagnosis from fills, markouts and venue history:

```ts
import { attributeLosses } from "./research";

const result = attributeLosses({
  window: { fromTs: 1700000000000, toTs: 1700000060000 },
  fills: recordedFills,
  quotes: matchedQuotes,
  leadPrices: leadVenueSamples,
  inventorySnapshots: snapshots,
  thresholds: {
    staleReferenceBps: 5.0,
    selectiveLatenessRatio: 0.6,
    selectiveFavorableMoveBps: 2.0,
    adverseSizeUsd: 10000,
    inventoryMax5sLossBps: 3.0,
    inventoryMin300sLossBps: 5.0,
    overlapStrategy: "proportional",
  },
});
```

### Diagnosis causes and evidence rules

1. `stale_reference`: At fill time, an accepted lead venue (e.g. `hashkey-global`, `binance`) moved in the adverse direction by at least `staleReferenceBps` (default 5.0 bps) beyond the fused mid.
2. `inventory_imbalance`: The loss comes from residual inventory holding, not the 5 s markout. The 5 s markout was benign (≤ `inventoryMax5sLossBps` loss, default 3.0 bps), while the 300 s residual markout suffered significant loss (< `-inventoryMin300sLossBps`, default 5.0 bps), consistent with holding adverse inventory.
3. `selective_execution`: The fill arrived late in the quote's TTL (`lateness >= selectiveLatenessRatio`, default 0.60) right after a favourable market move for the taker (`favorableMoveBps >= selectiveFavorableMoveBps`, default 2.0 bps) during the quote's lifetime.
4. `adverse_size`: Losses concentrated in large fills whose notional USD meets or exceeds `adverseSizeUsd` (default 10,000 USD).

### Accounting and anti-double-counting guarantees

- **Overlap handling**: Default strategy is `"proportional"`, dividing a multi-cause fill's loss equally among each matching cause. Every matching cause still records the fill in `exampleFillIds`. An optional `"priority"` strategy is available.
- **Denominator and reconciliation**: Shares use `analyzedLossUsd` as the denominator. The sum of attributed cause USD plus `unclassified.usd` equals `analyzedLossUsd` exactly; shares sum to 1.0.
- **Evidence integrity**: Unmatched losses remain in `unclassified`. Fills missing required markout data are placed in `excludedFills` with an explicit reason. No evidence is fabricated.
- **Purity**: Zero network, wall-clock, journal or API dependencies. Timestamps and raw amounts are preserved as strings.

## R7 Scenario loader and held-out protection (`scenarios.ts`)

Loads and validates S9 manifests (`<name>.json`) and NDJSON replay files (`<name>.ndjson`) containing venue book depth, trades and taker requests.

```ts
import { loadScenario, listScenarios } from "./research";

// Research access (default): fails closed if scenario is held-out
const devScenario = await loadScenario("synthetic-dev-tape", { role: "research" });

// Evaluator access: explicit authorization required to read held-out payloads
const heldOutScenario = await loadScenario("synthetic-heldout-leadlag", { role: "evaluator" });
```

### Held-out protection and security guarantees

- **Fail-closed guard**: When a scenario is marked `heldOut: true` in its manifest, research access rejects with `HeldOutAccessError` **before** opening or reading the NDJSON payload. Evaluator access must be explicit (`role: "evaluator"`).
- **Path traversal prevention**: Disallows relative path traversals (`..`), path separators (`/`, `\`), and non-alphanumeric names; resolves strictly within the scenario directory, throwing `ScenarioSecurityError`.
- **Format validation**: Strict zod validation for both manifest and NDJSON records (`book`, `trade`, `taker_request`). Raw amounts in taker requests (`amountIn`) are strictly preserved as base-10 integer strings.
- **Deterministic partitioning**: Supports explicit `devWindow` and `heldOutWindow` from manifests, explicit `timeWindow` filtering, and pure helpers `splitRecordsByTime` / `splitRecordsByRatio`.
- **CLI tool**: `bun scripts/research-scenarios.ts <scenario-name> [--role=research|evaluator] [--list]`.
- **Test fixtures**: Uses explicitly labelled synthetic test fixtures (`scenarios/synthetic-dev-tape`, `scenarios/synthetic-heldout-leadlag`). Real recordings remain a pending dependency on stream 06.

## R4A Policy Proposer (`propose.ts` & `scripts/research-propose.ts`)

Generates candidate market-making policies from validated loss diagnoses and development performance statistics using Gemini, without executable candidate code or live-loop LLMs.

```ts
import { proposePolicy } from "./research";

const result = await proposePolicy({
  diagnosis: validatedDiagnosis,
  devStats: developmentStatistics,
  incumbent: currentIncumbentSpec,
  date: "20261101", // explicit UTC date
  apiKey: process.env.GEMINI_API_KEY,
});

console.log(result.candidate.id); // e.g. "p-20261101-a1b2c3d4"
console.log(result.hypothesis);
```

### Proposer guarantees and invariants

- **Strict candidate construction**: The model returns a proposed `PolicyBody` and hypothesis. The canonical `specHash` and `id: p-<yyyymmdd>-<8hex>` are constructed locally with an explicit UTC date. LLM-generated IDs or hashes are never trusted.
- **Bounded validation retries**: On malformed JSON or schema/bounds/mandate/compilation failures, concise errors are fed back to Gemini for up to 3 retries (4 attempts total). After 3 retries, the process halts with `ProposerRetryExhaustedError`.
- **Fail-closed held-out protection**: The proposer strictly checks inputs for `heldOut: true` or `kind: "heldout"`. Held-out data triggers `HeldOutAccessError` immediately before contacting the provider.
- **Audit trail & secret redaction**: Saves prompts, model responses, validation issues, candidates, and run summaries under `research-runs/<run-id>/`. Credentials, `x-goog-api-key`, and authorization headers are automatically redacted with `[REDACTED]`. `process.env` is never serialized.
- **Provider failure handling**: Missing credentials (`ProposerConfigError`), provider 5xx/4xx errors (`ProposerProviderError`), and timeouts (`ProposerTimeoutError`) fail immediately and are never treated as candidate validation retries.

### CLI Tool (`scripts/research-propose.ts`)

```sh
bun scripts/research-propose.ts \
  --diagnosis=diagnosis.json \
  --dev-stats=dev-stats.json \
  --date=20261101 \
  --incumbent=v0 \
  --out=candidate.json \
  --runs-dir=research-runs
```

#### Input formats:

- **`--diagnosis`**: S6 loss diagnosis JSON (from `attributeLosses` or `GET /diagnosis`), containing `totalLossUsd`, `causes` (`stale_reference`, `inventory_imbalance`, `selective_execution`, `adverse_size`), `shares`, and example fill evidence.
- **`--dev-stats`**: Aggregate development statistics JSON (e.g. from `scripts/research-eval.ts` on dev tape), containing fill counts, net USD, spread capture, drawdown, and fill/reject rates. Must not contain held-out data.
- **`--incumbent`**: Path to incumbent PolicySpec JSON, or `"v0"` for the built-in declarative baseline.
- **`--out`**: Destination path for the generated candidate PolicySpec JSON.

### Full research cycle (`scripts/research-cycle.ts`)

The cycle fetches `/diagnosis`, builds proposal statistics only from non-held-out scenarios, calls
the proposer, then freezes the candidate before opening evaluator-role scenarios. The evaluator
report (including held-out results) is posted unchanged to `POST /policies`; the held-out data is
never passed to Gemini. `ENGINE_URL`, `GEMINI_API_KEY`, and `ADMIN_TOKEN` are read from the
environment and are never printed.

```sh
ENGINE_URL=https://your-engine.workers.dev \
GEMINI_API_KEY=... ADMIN_TOKEN=... \
bun scripts/research-cycle.ts --date=20261101 --incumbent=v0
```

Optional flags include `--pair=HSK/USDT`, `--window=1h|24h|7d`, `--scenarios-dir`, `--runs-dir`,
`--model`, and `--seed`. The cycle fails if there are no development scenarios, the engine diagnosis
is unavailable, proposal/evaluation fails, or policy registration is rejected. It saves the dev
summary, S4 report, and registration response under a cycle folder in `research-runs/`.
