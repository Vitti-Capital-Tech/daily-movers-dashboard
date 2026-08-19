/**
 * The shape the rest of the app knows about market data.
 *
 * Everything above this line deals in `DailyClose`/`Quote`, never in a
 * provider's response format, so swapping Yahoo for a licensed feed (or an
 * internal Vitti Hub endpoint) means writing one more module that satisfies
 * `MarketDataProvider` and changing the export in `./index`.
 */

/** One trading day's close, dated in the exchange's own timezone. */
export type DailyClose = {
  /** YYYY-MM-DD, ASX local date. */
  date: string;
  close: number;
};

export type Quote = {
  price: number;
  currency: string | null;
  /** When the provider says this price was current. */
  asOf: Date;
};

export type PriceHistory = {
  /** Null when the provider returned bars but no live price. */
  quote: Quote | null;
  /** Ascending by date, gaps (non-trading days, halts) simply absent. */
  closes: DailyClose[];
};

export interface MarketDataProvider {
  /** Recorded on every row we store, so mixed-source data stays traceable. */
  readonly name: string;

  /**
   * Daily closes from `from` (YYYY-MM-DD) to today, plus the latest price.
   *
   * Throws `UnknownSymbolError` when the ticker isn't recognised -- the caller
   * treats that differently from a network blip, since retrying won't help.
   */
  fetchHistory(ticker: string, from: string): Promise<PriceHistory>;
}

/** The ticker isn't on the exchange (delisted, renamed, or a typo). */
export class UnknownSymbolError extends Error {
  constructor(symbol: string) {
    super(`No market data for ${symbol}`);
    this.name = "UnknownSymbolError";
  }
}
