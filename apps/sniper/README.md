# Public paper sniper

Run the engine, then `bun run --cwd apps/sniper start -- --mode sniper --pair ETH/USDT --amount 100`.
Set `ZETHOS_ENGINE_URL` for a remote engine and `ZETHOS_CHAIN_ID` for testnet.

Modes: `naive` fills immediately, `sniper` fills favorable stale prices, `latecomer` waits
until the last second, and `rotating --rotate 3` changes paper identity every three fills.
`--edge-bps 1` sets the minimum fast-feed edge. Amounts are USDT sold. There are no keys.

The bot reads Binance's public book-ticker WebSocket for ETH or Gate's for HSK. All engine
interaction uses the public SDK. Its printed P&L is a **paper estimate at the fast-feed mid**;
the Arena's completed markouts are the independent measurement. Quotes and fills are never
retried automatically. A quiet market may produce no snipes; that is expected.
