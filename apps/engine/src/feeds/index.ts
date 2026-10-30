import type { Pair, Params, VenueId } from "../config";
import type { Book, Trade } from "./types";
import { VENUES } from "./venues";

export interface BookResult {
  venue: VenueId;
  book: Book | null;
  error: string | null;
}

export async function pollTrades(pair: Pair, feeds: Params["feeds"], fetcher: typeof fetch = fetch): Promise<Trade[]> {
  const venue = feeds.tapeSource[pair];
  const response = await fetcher(VENUES[venue].tradesUrl(pair), { signal: AbortSignal.timeout(feeds.timeoutMs) });
  if (!response.ok) throw new Error(`Trade feed ${venue}: HTTP ${response.status}`);
  return VENUES[venue].parseTrades(await response.json());
}

export async function pollBooks(
  pair: Pair,
  feeds: Params["feeds"],
  fetcher: typeof fetch = fetch,
): Promise<BookResult[]> {
  return Promise.all(
    feeds.sources[pair].map(async (venue): Promise<BookResult> => {
      try {
        const response = await fetcher(VENUES[venue].bookUrl(pair, feeds.bookLevels), {
          signal: AbortSignal.timeout(feeds.timeoutMs),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { venue, book: VENUES[venue].parseBook(await response.json()), error: null };
      } catch (error) {
        return { venue, book: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}
