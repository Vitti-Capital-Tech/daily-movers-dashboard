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

/**
 * One trading day's close *and* volume.
 *
 * Separate from `DailyClose` rather than an extra nullable field on it, because
 * the two are wanted by different callers for different reasons and the price
 * cache has no column for volume. `DailyClose` backfills `daily_movers`
 * post-event returns; this answers "was today's turnover unusual for this
 * company", which needs the history a single session's figure cannot give.
 */
export type DailyBar = {
  /** YYYY-MM-DD, ASX local date. */
  date: string;
  close: number;
  /** Shares traded. Null when the provider reported the bar without one. */
  volume: number | null;
};

export type Quote = {
  price: number;
  currency: string | null;
  /** When the provider says this price was current. */
  asOf: Date;
};

/**
 * One ticker's move for the current (or most recent) session.
 *
 * Separate from `Quote` because it answers a different question and carries the
 * fields a mover screen needs but a price cache has no use for. `Quote` is
 * stored per company and overwritten in place; this is read, ranked, and thrown
 * away.
 */
export type SessionMove = {
  /** Signed percentage move for the session: +20.6, -11.5. */
  changePct: number;
  price: number;
  /** Shares traded this session. */
  volume: number | null;
  /**
   * Dollar turnover, i.e. `price * volume`. Derived rather than reported —
   * providers give volume in shares, and a liquidity screen has to be in
   * dollars or a 500-million-share move in a half-cent stock passes it.
   */
  turnover: number | null;
  marketCap: number | null;
  currency: string | null;
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
   * Session moves for many tickers, in as few upstream calls as the provider
   * allows.
   *
   * A third call rather than fields bolted onto `fetchQuotes` for the same
   * reason the first two are separate: this one is aimed at ~1,200 tickers once
   * a day to rank a board, while `fetchQuotes` is aimed at the ~50 companies the
   * archive covers and writes what it finds to the price cache. Same upstream,
   * different shape of work.
   *
   * Keyed by the ticker as passed in, with unrecognised tickers *absent* rather
   * than an error — same contract as `fetchQuotes`.
   */
  fetchSessionMoves(tickers: string[]): Promise<Map<string, SessionMove>>;

  /**
   * Daily closes from `from` (YYYY-MM-DD) to today, ascending, with gaps
   * (weekends, halts) simply absent.
   *
   * Throws `UnknownSymbolError` when the ticker isn't recognised -- the caller
   * treats that differently from a network blip, since retrying won't help.
   */
  fetchCloses(ticker: string, from: string): Promise<DailyClose[]>;

  /**
   * Daily closes *and* volumes for one ticker, ascending, gaps absent.
   *
   * One ticker rather than many on purpose: this is called once per draft, for
   * the company that was already chosen, to work out whether the session's
   * turnover was unusual for it. Batching would mean a history request for all
   * ~1,200 screened tickers to answer a question about one of them.
   *
   * Throws `UnknownSymbolError` on an unrecognised ticker, same as
   * `fetchCloses`.
   */
  fetchDailyBars(ticker: string, from: string): Promise<DailyBar[]>;
}

/** The ticker isn't on the exchange (delisted, renamed, or a typo). */
export class UnknownSymbolError extends Error {
  constructor(symbol: string) {
    super(`No market data for ${symbol}`);
    this.name = "UnknownSymbolError";
  }
}
