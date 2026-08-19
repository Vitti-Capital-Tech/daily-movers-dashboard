import {
  UnknownSymbolError,
  type DailyClose,
  type MarketDataProvider,
  type PriceHistory,
  type Quote,
} from "./provider";

/**
 * Yahoo Finance chart endpoint.
 *
 * One request per ticker returns both the daily closes and the latest price, so
 * a company's whole performance row costs a single call. No key, no account,
 * roughly 20-minute delayed intraday -- fine for "what happened after we
 * covered it", and deliberately isolated behind `MarketDataProvider` because
 * it's an undocumented endpoint that Yahoo can change without notice.
 */

const CHART_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart";

const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Yahoo serves an empty body to obviously-scripted clients. This is the same
 * User-Agent shape any browser sends; nothing is being disguised.
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** ASX listings are suffixed `.AX` on Yahoo: JBH -> JBH.AX. */
function symbolFor(ticker: string): string {
  return `${ticker.trim().toUpperCase()}.AX`;
}

function unixSeconds(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 1000);
}

/**
 * Yahoo timestamps a daily bar at the session open in UTC. Shifting by the
 * exchange's own offset before reading the date parts is what keeps an ASX
 * session on the right calendar day -- a naive UTC read puts the morning of the
 * 18th in Sydney on the 17th.
 */
function exchangeDate(timestampSeconds: number, gmtOffsetSeconds: number): string {
  return new Date((timestampSeconds + gmtOffsetSeconds) * 1000)
    .toISOString()
    .slice(0, 10);
}

type ChartMeta = {
  currency?: unknown;
  gmtoffset?: unknown;
  regularMarketPrice?: unknown;
  regularMarketTime?: unknown;
};

function parseQuote(meta: ChartMeta): Quote | null {
  const price = meta.regularMarketPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return null;
  }

  const marketTime = meta.regularMarketTime;
  return {
    price,
    currency: typeof meta.currency === "string" ? meta.currency : null,
    // A missing market time means "as of now" rather than "unknown": the price
    // itself is current, Yahoo just didn't stamp it.
    asOf:
      typeof marketTime === "number" && Number.isFinite(marketTime)
        ? new Date(marketTime * 1000)
        : new Date(),
  };
}

function parseCloses(
  timestamps: unknown,
  closes: unknown,
  gmtOffset: number,
): DailyClose[] {
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return [];

  // Keyed by date, last write wins: an in-progress bar can share a date with an
  // earlier one, and a Map keeps the fresher value without the caller having to
  // dedupe before it hits a composite primary key.
  const byDate = new Map<string, number>();

  for (let i = 0; i < timestamps.length; i += 1) {
    const timestamp = timestamps[i];
    const close = closes[i];

    // Halted or pre-listing days come back as nulls in the parallel array.
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;

    byDate.set(exchangeDate(timestamp, gmtOffset), close);
  }

  return [...byDate].map(([date, close]) => ({ date, close }));
}

export const yahooProvider: MarketDataProvider = {
  name: "yahoo",

  async fetchHistory(ticker: string, from: string): Promise<PriceHistory> {
    const symbol = symbolFor(ticker);
    const url = new URL(`${CHART_ENDPOINT}/${encodeURIComponent(symbol)}`);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("period1", String(unixSeconds(from)));
    url.searchParams.set("period2", String(Math.floor(Date.now() / 1000)));

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    // 404 is Yahoo's answer for "no such symbol"; it also 422s on some
    // malformed symbols. Neither is worth retrying.
    if (response.status === 404 || response.status === 422) {
      throw new UnknownSymbolError(symbol);
    }
    if (!response.ok) {
      throw new Error(`Yahoo returned ${response.status} for ${symbol}`);
    }

    const payload = (await response.json()) as {
      chart?: { result?: unknown; error?: { description?: unknown } | null };
    };

    const result = payload.chart?.result;
    if (!Array.isArray(result) || result.length === 0) {
      const description = payload.chart?.error?.description;
      throw typeof description === "string"
        ? new Error(`Yahoo: ${description}`)
        : new UnknownSymbolError(symbol);
    }

    const first = result[0] as {
      meta?: ChartMeta;
      timestamp?: unknown;
      indicators?: { quote?: Array<{ close?: unknown }> };
    };

    const meta = first.meta ?? {};
    const gmtOffset =
      typeof meta.gmtoffset === "number" && Number.isFinite(meta.gmtoffset)
        ? meta.gmtoffset
        : 0;

    return {
      quote: parseQuote(meta),
      closes: parseCloses(
        first.timestamp,
        first.indicators?.quote?.[0]?.close,
        gmtOffset,
      ),
    };
  },
};
