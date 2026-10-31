# Public paper sniper

Run the engine, then `bun run --cwd apps/sniper start -- --mode sniper --pair ETH/USDT --amount 100`.
Set `ZETHOS_ENGINE_URL` for a remote engine and `ZETHOS_CHAIN_ID` for testnet.

## Modes

- `naive`: fills immediately when quote is returned.
- `sniper`: fills favorable stale prices when fast-feed mid diverges by at least `--edge-bps`.
- `latecomer`: waits until the final second before expiry before evaluating edge and filling.
- `rotating`: rotates paper identity every N fills (`--rotate 3`).
- `capture-only` (or `--capture-only` / `--quiet`): listens to public order books and trades without requesting quotes or submitting paper fills.

`--edge-bps 1` sets the minimum fast-feed edge. Amounts are in the sold token (USDT for buys). There are no keys.

The bot reads Binance's public book-ticker WebSocket for ETH or Gate's for HSK. All engine
interaction uses the public SDK. Its printed P&L is a **paper estimate at the fast-feed mid**;
the Arena's completed markouts are the independent measurement. Quotes and fills are never
retried automatically. A quiet market may produce no snipes; that is expected.

## S9 Scenario Recording

The sniper includes an integrated S9 scenario recorder (`--record <name>`) producing
chronologically ordered NDJSON (`<name>.ndjson`) and a valid S9 manifest (`<name>.json`).

### 1. Recording an Existing Attacker Mode

Run any attacker mode with `--record <name>`:

```sh
bun run --cwd apps/sniper start -- \
  --mode sniper \
  --pair ETH/USDT \
  --amount 100 \
  --edge-bps 1 \
  --record eth-sniper-run-1
```

Records:
- `book`: per-venue bids/asks with depth from public exchange feeds.
- `trade`: public exchange trades deduplicated by trade ID.
- `taker_request`: attempted quote requests with raw `amountIn` resolved via runtime token decimals, recorded even if the engine rejects the request.

### 2. Capture-Only Quiet Market Tape

To record quiet market tape without requesting quotes or submitting paper fills:

```sh
bun run --cwd apps/sniper start -- \
  --capture-only \
  --pair ETH/USDT \
  --record eth-quiet-tape-30m \
  --duration-sec 1800
```

This gathers only `book` and `trade` records with `source: "tape"`.

### 3. Selecting Output Location and Held-Out Metadata

- `--record <name>`: scenario name (alphanumeric, underscores, hyphens; e.g. `eth-sniper-01`).
- `--held-out`: marks the scenario as `heldOut: true` in the manifest. Held-out recordings are strictly protected by the engine loader and accessible only to `evaluator` roles (denied to `research` roles).
- `--description "<text>"`: custom description for the manifest.
- `--scenarios-dir <path>`: custom destination directory (defaults to `apps/engine/scenarios`).
- `--venues <list>`: comma-separated list of venues to record (e.g. `--venues binance,okx,hashkey-global`). Defaults to the pair's standard venues.
- `--duration-sec <n>`: automatically stops recording after N seconds.
- `--max-records <n>`: stops recording after N records are captured.
- `--max-fills <n>`: stops after N fills.

Example held-out recording command:

```sh
bun run --cwd apps/sniper start -- \
  --mode sniper \
  --pair HSK/USDT \
  --record hsk-heldout-run-1 \
  --held-out \
  --description "Held-out attacker recording for evaluation"
```

### 4. Stopping Safely

To stop recording safely:
- Press `Ctrl+C` (SIGINT) or send `SIGTERM`.
- Or specify `--duration-sec <seconds>` or `--max-records <n>`.

On shutdown, the recorder:
1. Stops the feed polling collector and disconnects WebSockets.
2. Flushes all buffered records to `<name>.ndjson` in monotonically non-decreasing timestamp order.
3. Ensures equal-timestamp records are ordered deterministically (`book` < `trade` < `taker_request`, followed by tie-breakers).
4. Validates and writes `<name>.json` manifest atomically.
5. Incomplete captures (0 records captured) are cleaned up and rejected with an error; an incomplete capture is never reported as successful.

### 5. Overwrite Protection

If `<name>.json` or `<name>.ndjson` already exists in the target directory, the recorder refuses to start and throws an error immediately to prevent accidental data loss.

### 6. Public Feeds & Unavailable-Venue Behavior

- **Direct Public Exchange View**:
  Books and trades are captured directly from public exchange REST feeds (Binance, Gate, HashKey Global, OKX, KuCoin, MEXC), not from engine internal state. The engine does not expose per-venue order book depth or public trade streams over public endpoints. Direct exchange views may differ from the engine's internal fused view due to network latency, geographic topology, and rate limits. Do not treat recorder feed observations and engine feed views as identical.
- **Unavailable Venues & ISP Blocks**:
  Some ISPs or cloud regions block access to OKX and KuCoin. When an exchange endpoint is unreachable or returns HTTP errors, the collector marks that venue as unhealthy, logs the error, and continues recording observations from reachable venues without crashing or fabricating book data.

### 7. Validating a Recording

Verify the scenario against the engine's strict S9 scenario loader:

```sh
# For dev recordings (accessible to research and evaluator):
bun --cwd apps/engine scripts/research-scenarios.ts <name> --role=research

# For held-out recordings (evaluator access only):
bun --cwd apps/engine scripts/research-scenarios.ts <name> --role=evaluator

# Verify held-out guard fails closed for research:
bun --cwd apps/engine scripts/research-scenarios.ts <name> --role=research
# Exit code 1: [HELD-OUT GUARD] Access denied: scenario '<name>' is held-out
```
