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
reservation request fields remain gated. Attribution, scenario loading, evaluation,
qualification, proposal generation and the policy registry follow in separate checkpoints.
