/**
 * Types and constants shared between server and client components.
 *
 * Kept separate from the modules that fetch, for the same reason
 * `lib/movers.ts` is separate from `lib/queries.ts`: those modules reach
 * upstream and (via the market provider) pull in a chain of Node-only
 * dependencies, so a client component importing a runtime value from them drags
 * all of it into the browser bundle. Anything the Studio UI needs at runtime
 * belongs here.
 */

export type MoverSide = "gainers" | "losers";

/** One row of the computed top-movers board. */
export type ScreenerRow = {
  /** ASX code, uppercase, no `.AX` suffix. */
  ticker: string;
  companyName: string;
  /** Last traded price in AUD. */
  last: number | null;
  /** Signed percentage move for the session: +20.6, -11.5. */
  changePct: number;
  /** Dollar turnover for the session — what the liquidity screen runs on. */
  turnover: number | null;
  /** Shares traded. Kept alongside turnover because thin-but-real moves show up here. */
  volume: number | null;
  marketCap: number | null;
  sector: string | null;
};

export type ScreenCriteria = {
  minTurnover: number;
  minMarketCap: number;
  minAbsChangePct: number;
  perSide: number;
};

/**
 * The liquidity screen applied before Claude ever sees the board.
 *
 * This is not a nicety. On a representative day the raw top-20 gainers were
 * almost entirely nano-caps: +47% on $107k of turnover, +27% on **$2,451** of
 * turnover. A Daily Mover on a stock that traded two thousand dollars is not
 * research, and no amount of prompting fixes a shortlist made of those — the
 * filter has to happen before the model is asked to choose.
 *
 * The defaults live here, in the client-safe module, so the form's default
 * values and the server's fallback are the same numbers and cannot drift.
 */
/**
 * The default screen. Wide, because the run now happens early.
 *
 * The history matters here, because these numbers have moved twice in opposite
 * directions. They began at $500k turnover / $20m market cap — a pure liquidity
 * filter, which kept out the +47%-on-$107k nano-caps but let through $30m
 * explorers whose whole move was one drill hole. They were then raised to $1m /
 * $75m to push the shortlist toward companies with revenue and a disclosure
 * history, on the reasoning that a single-catalyst explorer makes a report that
 * is unfalsifiable on the day and worthless a month later.
 *
 * **A turnover floor stopped being affordable when the schedule moved.** The
 * draft used to be screened at 11:15 Sydney, an hour and a quarter into the
 * session; it is now screened at 10:30, thirty minutes in. Turnover is
 * cumulative from the open, so the same stock has roughly a quarter of the
 * dollars against its name at 10:30 that it had at 11:15. A $1m floor applied
 * half an hour into trading does not select for liquidity — it selects for
 * whatever happened to trade first, and on a quiet morning it empties the board
 * entirely. Hence zero: the turnover *figure* is still computed, printed on
 * every candidate, and weighed by the selection prompt as a share of market
 * capitalisation. It is simply no longer a gate.
 *
 * That leaves `minMarketCap` carrying the whole nano-cap defence on its own, so
 * it is set at $5m rather than removed — low enough to admit the speculative end
 * the desk asked for, high enough to exclude the shells. The +27%-on-$2,451 rows
 * that motivated the original screen are $2-3m companies and still fall outside
 * it.
 *
 * Note that `passesScreen` rejects a *null* turnover regardless of this floor:
 * an unknown figure is not evidence of a liquid stock, and zero here means
 * "don't gate on the number", not "accept rows that have no number".
 *
 * An analyst who wants the old behaviour can raise both in the Studio. Beware
 * that `SCREEN_LIMITS.minTurnover` has a step of 100,000, so the smallest
 * non-zero floor the form will accept is $100k.
 */
export const DEFAULT_SCREEN: ScreenCriteria = {
  /** Not a gate. See above: at 10:30 a dollar floor selects for luck, not size. */
  minTurnover: 0,
  /** Market capitalisation floor — the only structural filter left. */
  minMarketCap: 5_000_000,
  /** Ignore moves too small to be worth a report. */
  minAbsChangePct: 5,
  /**
   * How many rows per side to keep after ranking. Kept in step with
   * `CANDIDATE_LOOKUP_LIMIT` in `lib/drafts/generate.ts`, which truncates the
   * interleaved board: at a cap of 40 anything above 20 a side is discarded
   * before it is ever looked up.
   */
  perSide: 25,
};

export type ScreenedBoard = {
  side: MoverSide;
  /** Rows that passed the screen, largest move first. */
  rows: ScreenerRow[];
  /** Listings in the universe before any filtering. */
  universeSize: number;
  /** How many of them returned a usable quote. */
  quotedCount: number;
};

export type ScreenResult = {
  criteria: ScreenCriteria;
  boards: ScreenedBoard[];
  /** Which providers produced this, recorded on the draft for traceability. */
  source: string;
  /** The most recent upstream timestamp across the board, ISO. */
  fetchedAt: string;
};

/**
 * Bounds for the screen controls in the UI.
 *
 * The floors exist because a screen of zero is the same as no screen, and the
 * whole point of the liquidity filter is that an unfiltered gainers board is
 * made of stocks that traded a few thousand dollars.
 */
export const SCREEN_LIMITS = {
  minTurnover: { min: 0, max: 50_000_000, step: 100_000 },
  /**
   * 5 million, not 10.
   *
   * `step` on a number input is not a spinner increment — it defines which
   * values are *valid*, counted from `min`. At a step of 10 million the default
   * of 75 million was not a multiple of it, so the field was permanently
   * invalid; and because the screen panel is collapsed with `hidden`, the
   * browser could not focus the field to complain. The result was a submit
   * button that did nothing at all, silently, with only a console warning
   * ("An invalid form control with name='minMarketCap' is not focusable") to
   * say why.
   *
   * Every default must sit on its field's step. The check below enforces it.
   */
  minMarketCap: { min: 0, max: 1_000_000_000, step: 5_000_000 },
  minAbsChangePct: { min: 1, max: 50, step: 1 },
  perSide: { min: 5, max: 50, step: 5 },
} as const;

/**
 * Every default has to be a valid value for its own input.
 *
 * A development-time warning rather than a throw: a mismatch breaks a form in
 * the browser, which is worth shouting about, but it is not worth taking the
 * server down for. The condition is the same one the browser applies.
 */
if (process.env.NODE_ENV !== "production") {
  for (const [field, limits] of Object.entries(SCREEN_LIMITS)) {
    const value = DEFAULT_SCREEN[field as keyof ScreenCriteria];
    const offStep = (value - limits.min) % limits.step !== 0;
    if (offStep || value < limits.min || value > limits.max) {
      console.warn(
        `SCREEN_LIMITS.${field}: the default ${value} is not a valid value ` +
          `(min ${limits.min}, max ${limits.max}, step ${limits.step}). ` +
          `The browser will block the form and say nothing.`,
      );
    }
  }
}

/**
 * How many of a company's earlier price-sensitive announcements to read.
 *
 * 15, down from 25, on measurement rather than taste. The corpus is by far the
 * largest cost in a draft, and 25 filings was buying repetition: the shipped
 * report on a real 26-filing corpus cited 12 of them, while 16 of the 25 were
 * takeover procedure (see `./filings.ts`). Measured on that company's full
 * 91-filing history, with series collapsed and legal instruments capped:
 *
 *   25 filings -> ~200k tokens -> $0.60 of corpus
 *   15 filings -> ~109k tokens -> $0.33
 *   12 filings -> ~83k  tokens -> $0.25
 *
 * 15 keeps two to three years of results and resource updates for a typical
 * ASX small-cap — enough for the business description, the segment detail and
 * the history pages — while halving the bill. Raise it if reports start
 * reading thin; the cost is roughly linear in this number.
 */
export const ANNOUNCEMENTS_TARGET = 15;

/**
 * Compact "$1.2M" / "$840k" for the dense board table. Deliberately not
 * `Intl.NumberFormat` with `notation: "compact"`, which renders AUD figures as
 * "A$1.2M" and would sit oddly beside the rest of the terminal's numbers.
 */
export function formatMoneyCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}
