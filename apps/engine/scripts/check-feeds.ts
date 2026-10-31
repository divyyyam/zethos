import { defaultParams } from "../src/config";
import { pollBooks, pollTrades } from "../src/feeds";
import { fuse } from "../src/feeds/fuse";

let failures = 0;
for (const pair of defaultParams.pairs) {
  const books = await pollBooks(pair, { ...defaultParams.feeds, timeoutMs: 10000 });
  const fused = fuse(
    books.map((b) => ({ venue: b.venue, book: b.book, at: Date.now() })),
    Date.now(),
    defaultParams.feeds,
  );
  console.log(
    JSON.stringify({
      pair,
      health: fused.health,
      mid: fused.mid,
      sources: books.map((b) => ({ venue: b.venue, ok: b.book !== null, error: b.error })),
    }),
  );
  if (fused.health !== "ok") failures++;
  try {
    const trades = await pollTrades(pair, { ...defaultParams.feeds, timeoutMs: 10000 });
    console.log(
      JSON.stringify({
        pair,
        tapeSource: defaultParams.feeds.tapeSource[pair],
        trades: trades.length,
      }),
    );
  } catch (error) {
    console.error(String(error));
    failures++;
  }
}
process.exitCode = failures ? 1 : 0;
