/**
 * The shape the rest of the app knows about market data.
 *
 * Everything above this line deals in `DailyClose`/`Quote`, never in a
 * provider's response format, so swapping feeds means writing one more module
 * that satisfies `MarketDataProvider` and changing the export in `./index`.
 *
 * The split into two calls is deliberate and mirrors what the work actually is:
 * current prices are wanted for every tracked company on a schedule and batch
 * cheaply, while daily closes are only needed for the few companies missing
 * history. Collapsing both into one per-ticker call (the earlier shape) meant
 * one upstream request per company per refresh even when nothing needed history.
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

export interface MarketDataProvider {
  /** Recorded on every row we store, so mixed-source data stays traceable. */
  readonly name: string;

  /**
   * Latest prices for many tickers, in as few upstream calls as the provider
   * allows.
   *
   * Keyed by the ticker as passed in. A ticker the provider doesn't recognise is
   * *absent from the map* rather than an error: one delisted holding must not
   * fail the batch for everyone else. Throwing is reserved for a genuine
   * transport failure, where nothing was learned about any ticker.
   */
  fetchQuotes(tickers: string[]): Promise<Map<string, Quote>>;

  /**
   * Daily closes from `from` (YYYY-MM-DD) to today, ascending, with gaps
   * (weekends, halts) simply absent.
   *
   * Throws `UnknownSymbolError` when the ticker isn't recognised -- the caller
   * treats that differently from a network blip, since retrying won't help.
   */
  fetchCloses(ticker: string, from: string): Promise<DailyClose[]>;
}

/** The ticker isn't on the exchange (delisted, renamed, or a typo). */
export class UnknownSymbolError extends Error {
  constructor(symbol: string) {
    super(`No market data for ${symbol}`);
    this.name = "UnknownSymbolError";
  }
}
