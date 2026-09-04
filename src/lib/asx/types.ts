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
export const DEFAULT_SCREEN: ScreenCriteria = {
  /** Session dollar turnover. Below this, the move isn't tradeable. */
  minTurnover: 500_000,
  /** Market capitalisation floor. */
  minMarketCap: 20_000_000,
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

/** How many price-sensitive announcements the pipeline aims to read. */
export const ANNOUNCEMENTS_TARGET = 25;

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
