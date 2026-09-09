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
 * Defaults are conservative rather than clever. They live here, in the
 * client-safe module, so the form's default values and the server's fallback
 * are the same numbers and cannot drift.
 */
/**
 * The default screen, tuned toward companies a Daily Mover can say something
 * durable about.
 *
 * The floors were $500k turnover and $20m market cap, which is a liquidity
 * screen and nothing more — it kept out the +47%-on-$107k nano-caps and let
 * through plenty of $30m explorers whose move was one drill hole. Those produce
 * a report that is unfalsifiable on the day and worthless a month later, and the
 * desk kept passing over them at the selection stage anyway.
 *
 * $1m and $75m instead. On a normal session that still leaves both boards well
 * populated, and it shifts the shortlist toward companies with revenue, a
 * disclosure history and a reason to move that survives contact with the
 * accounts. An analyst who wants the speculative end can lower both in the
 * Studio — `SCREEN_LIMITS` still allows zero.
 */
export const DEFAULT_SCREEN: ScreenCriteria = {
  /** Session dollar turnover. Below this, the move isn't tradeable. */
  minTurnover: 1_000_000,
  /** Market capitalisation floor. */
  minMarketCap: 75_000_000,
  /** Ignore moves too small to be worth a report. */
  minAbsChangePct: 5,
  /** How many rows per side to keep after ranking. */
  perSide: 20,
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
  minMarketCap: { min: 0, max: 1_000_000_000, step: 10_000_000 },
  minAbsChangePct: { min: 1, max: 50, step: 1 },
  perSide: { min: 5, max: 50, step: 5 },
} as const;

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
