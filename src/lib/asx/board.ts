import { marketData } from "@/lib/market";

import { asxData } from "./source";

import { DEFAULT_SCREEN } from "./types";

import type {
  MoverSide,
  ScreenCriteria,
  ScreenResult,
  ScreenedBoard,
  ScreenerRow,
} from "./types";

/**
 * The top gainers / losers board, computed rather than scraped.
 *
 * The obvious approach — read a published leaderboard such as Market Index's
 * `/scans/top-gainers` — was built first and abandoned. That page is
 * server-rendered and parses cleanly, but it sits behind Cloudflare bot
 * protection that fingerprints TLS, not headers: the identical request succeeds
 * from `curl` and returns **403 from Node**, with every browser header set
 * present. Nothing short of a TLS-impersonating HTTP client gets past it, and a
 * datacenter IP on Vercel would be the next hurdle after that.
 *
 * So the board is derived instead: the ASX's own company directory gives the
 * universe and a coarse market cap, and the market-data provider the app
 * already trusts for prices gives each ticker's session move. That turns out to
 * be the better design regardless of the block:
 *
 * - No bot-detection surface, and it reuses a provider that is already proven
 *   to work from Vercel.
 * - Turnover is computed in dollars from price x volume, so the liquidity
 *   screen is exact rather than inherited from someone else's rounding.
 * - The screen runs on the full universe, so the shortlist is not limited to
 *   whatever a third party chose to put on page one.
 *
 * The cost is ~25 batched quote requests per run, which is why the market-cap
 * pre-filter happens *before* quoting: it takes ~1,830 listings down to ~1,200.
 */

/**
 * Listings whose directory market cap already disqualifies them are dropped
 * before quoting, but the directory figure is a stale daily snapshot — so the
 * pre-filter uses a fraction of the real floor and lets the live figure make
 * the actual decision. A company that has run 40% since the snapshot should not
 * be screened out by yesterday's number.
 */
const PREFILTER_MARGIN = 0.7;

function isEligibleForQuoting(
  marketCap: number | null,
  criteria: ScreenCriteria,
): boolean {
  // Unknown market cap still gets quoted: the live quote usually knows, and the
  // directory omits the figure for ~70 listings including recent admissions.
  if (marketCap === null) return true;
  return marketCap >= criteria.minMarketCap * PREFILTER_MARGIN;
}

function passesScreen(row: ScreenerRow, criteria: ScreenCriteria): boolean {
  if (Math.abs(row.changePct) < criteria.minAbsChangePct) return false;
  // A missing figure fails the screen rather than passing it: an unknown
  // turnover is not evidence of a liquid stock.
  if (row.turnover === null || row.turnover < criteria.minTurnover) return false;
  if (row.marketCap === null || row.marketCap < criteria.minMarketCap) {
    return false;
  }
  return true;
}

/**
 * Fetches the universe, quotes what could plausibly qualify, and ranks both
 * sides of the board.
 */
export async function screenBoards(
  criteria: ScreenCriteria = DEFAULT_SCREEN,
): Promise<ScreenResult> {
  const universe = await asxData.fetchUniverse();

  const candidates = universe.filter((company) =>
    isEligibleForQuoting(company.marketCap, criteria),
  );

  const moves = await marketData.fetchSessionMoves(
    candidates.map((company) => company.ticker),
  );

  const rows: ScreenerRow[] = [];
  let asOf: Date | null = null;

  for (const company of candidates) {
    const move = moves.get(company.ticker);
    if (!move) continue;

    const row: ScreenerRow = {
      ticker: company.ticker,
      companyName: company.name,
      last: move.price,
      changePct: move.changePct,
      turnover: move.turnover,
      // The live figure wins over the directory's daily snapshot; the snapshot
      // is only the fallback for tickers the quote endpoint doesn't size.
      marketCap: move.marketCap ?? company.marketCap,
      sector: company.sector,
      volume: move.volume,
    };

    if (!passesScreen(row, criteria)) continue;
    rows.push(row);

    if (!asOf || move.asOf > asOf) asOf = move.asOf;
  }

  const gainers = rows
    .filter((row) => row.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, criteria.perSide);

  const losers = rows
    .filter((row) => row.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, criteria.perSide);

  const boards: ScreenedBoard[] = (
    [
      ["gainers", gainers],
      ["losers", losers],
    ] as [MoverSide, ScreenerRow[]][]
  ).map(([side, sideRows]) => ({
    side,
    rows: sideRows,
    /**
     * How many listings the screen considered, so a thin board reads as "the
     * market was quiet" rather than "the fetch half-failed".
     */
    universeSize: universe.length,
    quotedCount: moves.size,
  }));

  return {
    criteria,
    boards,
    source: `${asxData.name}+${marketData.name}`,
    fetchedAt: (asOf ?? new Date()).toISOString(),
  };
}
