import YahooFinance from "yahoo-finance2";

import {
  UnknownSymbolError,
  type DailyClose,
  type MarketDataProvider,
  type Quote,
} from "./provider";

/**
 * Yahoo Finance via the `yahoo-finance2` package.
 *
 * The package rather than hand-rolled requests because it owns the parts that
 * are easy to get wrong and that Yahoo changes without notice: the cookie/crumb
 * handshake `quote()` needs, response validation, and retries. It also exposes
 * batch quotes, which is what lets a refresh of the whole board be one request
 * instead of one per company.
 *
 * Still isolated behind `MarketDataProvider`, because this is an undocumented
 * upstream either way.
 */

/**
 * Yahoo accepts far more symbols per quote call than we have companies, but
 * chunking keeps one oversized URL from failing the whole sweep.
 */
const QUOTE_CHUNK_SIZE = 40;

/**
 * Some listings are missing from the quote endpoint but still have chart data --
 * OPT.AX, suspended since July, is one. For those we read the price out of the
 * chart's metadata instead, one request each.
 *
 * Bounded so a broken quote endpoint degrades into a slow-but-working refresh
 * rather than a stampede, and the shortfall is logged rather than hidden.
 */
const QUOTE_FALLBACK_LIMIT = 15;
const QUOTE_FALLBACK_CONCURRENCY = 4;

/** Enough history for the chart call to carry current metadata. */
const FALLBACK_WINDOW_DAYS = 10;

/** In-memory cookie jar by default; nothing is written to disk (Vercel is read-only). */
const yahoo = new YahooFinance({
  // A console nag about an unrelated user survey, not something we can act on.
  suppressNotices: ["yahooSurvey"],
});

/** ASX listings are suffixed `.AX` on Yahoo: JBH -> JBH.AX. */
function symbolFor(ticker: string): string {
  return `${ticker.trim().toUpperCase()}.AX`;
}

function tickerFor(symbol: string | undefined): string | null {
  if (!symbol) return null;
  return symbol.toUpperCase().replace(/\.AX$/, "");
}

/** "No data found, symbol may be delisted" is Yahoo's answer for an unknown symbol. */
function isUnknownSymbol(error: unknown): boolean {
  return (
    error instanceof Error && /no data found|may be delisted/i.test(error.message)
  );
}

function isoDaysAgo(days: number): string {
  const shifted = new Date();
  shifted.setUTCDate(shifted.getUTCDate() - days);
  return shifted.toISOString().slice(0, 10);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function asDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000);
  }
  // A missing timestamp means "as of now" rather than "unknown": the price is
  // current, Yahoo just didn't stamp it.
  return new Date();
}

/**
 * The exchange-local date of a daily bar.
 *
 * The package hands back the bar's opening instant, which for the ASX is 10:00
 * local. Reading the UTC date off that directly happens to be correct while
 * Sydney is on AEST (+10, so 10:00 local is exactly midnight UTC) and wrong by a
 * day once daylight saving starts (+11 puts it at 23:00 UTC the previous day).
 * Shifting by the exchange's own offset first is right in both.
 */
function exchangeDate(barOpen: Date, gmtOffsetSeconds: number): string {
  return new Date(barOpen.getTime() + gmtOffsetSeconds * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Price from a chart request's metadata -- the fallback for tickers the quote
 * endpoint skips. Returns null rather than throwing: the caller is already
 * treating this ticker as "might not be priceable".
 */
async function quoteFromChart(ticker: string): Promise<Quote | null> {
  try {
    const chart = await yahoo.chart(symbolFor(ticker), {
      period1: isoDaysAgo(FALLBACK_WINDOW_DAYS),
      interval: "1d",
    });

    const price = chart.meta?.regularMarketPrice;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      return null;
    }

    return {
      price,
      currency:
        typeof chart.meta.currency === "string" ? chart.meta.currency : null,
      asOf: asDate(chart.meta.regularMarketTime),
    };
  } catch {
    return null;
  }
}

export const yahooProvider: MarketDataProvider = {
  name: "yahoo",

  async fetchQuotes(tickers: string[]): Promise<Map<string, Quote>> {
    const found = new Map<string, Quote>();
    if (tickers.length === 0) return found;

    for (const batch of chunk(tickers, QUOTE_CHUNK_SIZE)) {
      const result = await yahoo.quote(batch.map(symbolFor));
      const rows = Array.isArray(result) ? result : [result];

      for (const row of rows) {
        const ticker = tickerFor(row?.symbol);
        const price = row?.regularMarketPrice;

        // An unpriced row (halted, or a symbol Yahoo echoes without data) is
        // left out, so the caller sees it as "no quote" rather than as zero.
        if (!ticker) continue;
        if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
          continue;
        }

        found.set(ticker, {
          price,
          currency: typeof row.currency === "string" ? row.currency : null,
          asOf: asDate(row.regularMarketTime),
        });
      }
    }

    const missing = tickers.filter((ticker) => !found.has(ticker));
    if (missing.length === 0) return found;

    const attempts = missing.slice(0, QUOTE_FALLBACK_LIMIT);
    if (missing.length > attempts.length) {
      console.warn(
        `quote endpoint skipped ${missing.length} tickers; falling back on chart for ${attempts.length} of them this run`,
      );
    }

    let next = 0;
    await Promise.all(
      Array.from(
        { length: Math.min(QUOTE_FALLBACK_CONCURRENCY, attempts.length) },
        async function worker() {
          while (next < attempts.length) {
            const ticker = attempts[next++];
            const quote = await quoteFromChart(ticker);
            if (quote) found.set(ticker, quote);
          }
        },
      ),
    );

    return found;
  },

  async fetchCloses(ticker: string, from: string): Promise<DailyClose[]> {
    const symbol = symbolFor(ticker);

    // Translated in `.catch` rather than a try/block so the result type is still
    // inferred from the call; annotating it by hand widens it to `unknown`.
    const chart = await yahoo
      .chart(symbol, { period1: from, interval: "1d" })
      .catch((error: unknown) => {
        if (isUnknownSymbol(error)) throw new UnknownSymbolError(symbol);
        throw error;
      });

    const gmtOffset =
      typeof chart.meta?.gmtoffset === "number" ? chart.meta.gmtoffset : 0;

    // Keyed by date, last write wins: the in-progress bar can share a date with
    // an earlier one, and a Map keeps the fresher value without the caller
    // having to dedupe before it hits a composite primary key.
    const byDate = new Map<string, number>();

    for (const bar of chart.quotes) {
      const close = bar?.close;
      if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) {
        continue;
      }
      if (!(bar.date instanceof Date)) continue;
      byDate.set(exchangeDate(bar.date, gmtOffset), close);
    }

    return [...byDate].map(([date, close]) => ({ date, close }));
  },
};
