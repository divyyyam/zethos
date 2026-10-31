# Zethos MCP server

Connect an AI agent to Zethos through the public `@zethos/sdk`. The server reads markets,
gets and locally verifies signed quotes, and settles **paper** swaps under one configured
public taker address. Agent fills appear in the frontend Arena as `agent` flow through the
engine's existing stream. The server never holds a private key, signs or broadcasts a transaction.

## Run

From the repository root:

```powershell
bun install
bun run --cwd packages/shared build
bun run --cwd packages/sdk build
Copy-Item apps/mcp/.env.example apps/mcp/.env
```

Set `ZETHOS_TAKER_ADDRESS` in `apps/mcp/.env` to a nonzero **public** address. Start the
engine separately on port 8787. Stdio clients spawn the MCP process; its stdin/stdout carry
protocol messages, not a terminal chat. All diagnostic output goes to stderr.

For Claude Desktop, merge this entry into `mcpServers` in its configuration, adjusting the
absolute repository path and Bun executable if necessary:

```json
{
  "mcpServers": {
    "zethos": {
      "command": "bun",
      "args": ["run", "--cwd", "D:/hacks/zethos/apps/mcp", "start"],
      "env": {
        "ZETHOS_ENGINE_URL": "http://localhost:8787",
        "ZETHOS_CHAIN_ID": "177",
        "ZETHOS_TAKER_ADDRESS": "0x1111111111111111111111111111111111111111",
        "ZETHOS_MAX_NOTIONAL_USD": "1000",
        "ZETHOS_DAILY_NOTIONAL_USD": "5000"
      }
    }
  }
}
```

The example address is a public paper identity, not a wallet controlled by this server.
Choose your own public identity. Use `bun src/index.ts --transport stdio` or
`bun dist/index.js` from `apps/mcp` for a direct entry point; `bun run build` produces `dist`.

For Streamable HTTP:

```powershell
bun run --cwd apps/mcp start:http
```

Connect a compatible MCP client to `http://127.0.0.1:8788/mcp`. This is stateless HTTP with
JSON responses; quote and spending state are shared across requests and survive reconnects.
It serves the established MCP protocol supported by the official `@modelcontextprotocol/sdk`
1.32.2, using [stdio and Streamable HTTP](https://ts.sdk.modelcontextprotocol.io/server).

HTTP binds to loopback by default and rejects foreign Host and Origin headers. Set
`MCP_AUTH_TOKEN` for bearer authentication. Binding beyond loopback requires that token;
put a remote deployment behind HTTPS and send `Authorization: Bearer <token>` from the
trusted client. `MCP_ALLOWED_ORIGINS` permits explicitly named browser origins. All clients
with access share the configured taker and budget; this is a single-identity server,
not a public service with separate user accounts. OAuth client discovery is not implemented.

## Tools and English requests

| Tool                              | Purpose                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `get_market`, `get_market_status` | Sources, freshness, mid, half-spreads, risk and venue depth                      |
| `get_quote`                       | Quote one pair/side/decimal amount; return pay/receive and an opaque `quoteId`   |
| `verify_quote`                    | Verify the stored signature, exact request bindings, expiry and price protection |
| `execute_swap`                    | Requires `confirm: true`; paper-fill once, or return unsigned live calls         |
| `build_fill_tx`                   | Live only: verified unsigned exact-amount approve/fill calldata                  |
| `get_my_fills`                    | This identity's fills and available five-second markouts                         |
| `explain_decision`                | A journal decision's reason, narration and inputs                                |
| `get_arena`                       | Paper P&L, flow split and tier counts                                            |
| `get_stats`                       | Price history, venue depth and fill metrics                                      |

The connected AI client understands English and maps it to tool inputs. No additional Gemini
key is needed by the MCP server. For example:

- “How much HSK can I get for 100 USDT?” → quote and verify only.
- “Sell 0.02 ETH for USDT.” → show the quote, obtain approval, then execute once.
- “Why did the spread widen?” → explain a recorded decision.

`buy` spends **USDT**, `sell` spends the **base token** (HSK/ETH). Amounts are decimal strings
in the token being sold. Exact-output buys, multi-trade requests, triggers and schedules are
not MCP operations; the model is instructed to clarify rather than silently alter the request.
Tool descriptions and the `best-price-swap(pair, side, amount)` prompt guide this sequence:
`get_market` → `get_quote` → `verify_quote` → show exact amounts and expiry → ask the user →
`execute_swap(confirm: true)`. The MCP client's approval settings remain the human control;
the boolean alone cannot prove a human approved. Keep execution approval enabled in the client.

Resources: `zethos://status`, `zethos://decisions/recent`, `zethos://methodology`.

## Limits, storage and errors

Signed quotes and their original requests stay server-side. Tools accept a `quoteId`, never
replacement signed fields. `get_quote` verifies before showing a price; execution verifies
again. All token decimals come from engine metadata, not constants in the server.

Per-swap and UTC-day limits are enforced in code with bigint arithmetic, rounding notional
up to a millionth of a dollar. USDT is modelled as $1. Sales use a healthy reference price
no older than ten seconds and the larger of input valuation and quoted USDT proceeds;
execution revalues sales and applies the larger notional. These are conservative paper
budget estimates, not a dollar FX oracle.

The SQLite ledger defaults to `apps/mcp/data/mcp.db`. It scopes quotes, receipts and budgets
to engine origin, chain and taker. Retain the ledger across restarts and use the **same file**
for processes sharing that identity and budget. `MCP_STATE_PATH=:memory:` is only suitable
for isolated tests: restarting it resets state. Separate files or machines do not share limits.

Budget is reserved atomically **before** settlement. Concurrent calls for a quote cannot
submit it twice. A completed call returns the stored receipt on repetition, including after
restart. A crash or uncertain response retains its reservation and blocks resubmission;
use `get_my_fills` to inspect the outcome before requesting any new trade. A definitive engine
rejection returns its original code, releases that reservation and remains terminal for that
quote. No fill is retried automatically. Engine errors are structured `{ error, message }`
tool errors; unavailable data stays unavailable.

Live mode returns ordered `{ to, data, value, account }` transactions and an app link, never
a settlement claim. The live signer is read from the vault through the SDK. Unsigned call
preparation also reserves budget since the server cannot observe whether a wallet broadcasts
it later. The app link opens the swap page; importing an MCP-cached quote into the web wallet
is not implemented. The current engine deliberately refuses live mode until its deployment
work is complete; this branch is covered using a real signed fixture and mocked RPC.

## Configuration

| Variable                    | Default / requirement                                           |
| --------------------------- | --------------------------------------------------------------- |
| `ZETHOS_ENGINE_URL`         | `http://localhost:8787` (origin only)                           |
| `ZETHOS_CHAIN_ID`           | `177`, or `133`                                                 |
| `ZETHOS_TAKER_ADDRESS`      | Required nonzero public address                                 |
| `ZETHOS_MAX_NOTIONAL_USD`   | `1000` per swap                                                 |
| `ZETHOS_DAILY_NOTIONAL_USD` | `5000` per UTC day                                              |
| `ZETHOS_WEB_URL`            | `http://localhost:3000` for Arena/app links                     |
| `MCP_STATE_PATH`            | Persistent SQLite path above                                    |
| `MCP_HOST`, `MCP_PORT`      | `127.0.0.1`, `8788`                                             |
| `MCP_AUTH_TOKEN`            | Optional on loopback; required otherwise, minimum 32 characters |
| `MCP_ALLOWED_ORIGINS`       | Comma-separated exact origins; no browser origins by default    |
| `HSK_RPC_URL`               | Optional; required for live verification/simulation             |

## Validation and rehearsal

```powershell
bun run --cwd apps/mcp test
bun run --cwd apps/mcp typecheck
bun run --cwd apps/mcp lint
bun run --cwd apps/mcp build
```

Tests use the official MCP client over stdio and Streamable HTTP against the real engine
and SDK. A finite **synthetic test** NDJSON replay makes the integration deterministic; it
is not performance evidence. Tests also cover genuine EIP-712 verification, expiry, tampering,
per-swap/daily budgets, concurrent requests, unknown submissions, restart receipts, HTTP
access checks, and unsigned live calldata without broadcasting.

For the demo, run the engine and web app, open `/arena`, connect the desktop client and ask
for a quote. Approve one paper swap and confirm its fill appears as `agent`. Then ask for
the latest decision's explanation. A credentialed Claude Desktop session and a sustained
deployed rehearsal still need to be run on the owner's machine.
