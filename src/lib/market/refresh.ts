import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { companies, companyPrices, companyQuotes, dailyMovers } from "@/db/schema";
import { marketData, type DailyClose, type Quote } from "@/lib/market";

/**
 * Keeps stored prices current without anyone entering a number by hand.
 *
 * Refresh is pull-based: opening Daily Movers asks for it, and this module
 * decides whether anything is actually due. That means no cron to keep alive,
 * at the cost of the first visitor after a quiet spell paying for the fetch --
 * which is why the work happens after the page has already rendered from
 * whatever was last stored.
 *
 * Two phases, because the two kinds of data have very different costs:
 *
 *  1. **Quotes** -- every due company in a single batched request, then one
 *     upsert each. This is the part that runs every 30 minutes.
 *  2. **Closes** -- only for companies actually missing history, and only for
 *     the dates they're missing. Most refreshes skip this phase entirely, which
 *     is what keeps steady-state database writes to a handful of rows a day
 *     rather than re-writing a rolling window on every sweep.
 */

/** How long a quote is considered current. Roughly the provider's own delay. */
const QUOTE_TTL_MS = 30 * 60 * 1000;

/**
 * A ticker whose quote failed waits this long before being tried again. Without
 * it a delisted or misspelled ticker is re-requested on every page load, and the
 * failure is usually permanent.
 */
const FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;

/**
 * Ceiling on history fetches in one run, so a first load against a large archive
 * doesn't turn into a hundred sequential chart requests. Whatever is left over is
 * picked up by the next request -- the staleness check makes runs resumable by
 * nature. Quotes have no such ceiling: they're one batched call regardless.
 */
const MAX_BACKFILLS_PER_RUN = 20;

/** Concurrent history requests. Enough to be quick, not enough to look hostile. */
const CONCURRENCY = 4;

/**
 * Days of slack before the earliest mover when first backfilling a company.
 * The anchor price falls back to the close on the move date, and a move date on
 * a Monday after a holiday needs the preceding week to be present.
 */
const BACKFILL_LEAD_DAYS = 10;

/**
 * How far back a top-up re-reads. Today's bar is provisional while the market is
 * open, so the next day's top-up has to overlap far enough to overwrite it with
 * the settled close.
 */
const TOPUP_OVERLAP_DAYS = 3;

export type RefreshSummary = {
  /** Companies that were due a refresh. */
  due: number;
  /** Companies whose price was updated. */
  refreshed: number;
  /** Companies we couldn't price; their stored prices are untouched. */
  failed: number;
};

const NOTHING_TO_DO: RefreshSummary = { due: 0, refreshed: 0, failed: 0 };

export type RefreshOptions = {
  /**
   * Refresh every tracked company regardless of TTL or failure backoff, and
   * ignore the per-run ceiling. This is what the manual button does: someone
   * asking for prices *now* should get all of them, not a fifth of them.
   */
  force?: boolean;
};

type Candidate = {
  companyId: number;
  ticker: string;
  earliestMoveDate: string;
  earliestStored: string | null;
  latestStored: string | null;
  attemptedAt: Date | null;
  hasError: boolean;
};

/**
 * Today on the ASX. Stored closes are dated in exchange-local time, so asking
 * "is our history current?" in any other timezone is off by up to a day.
 */
const ASX_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function asxToday(): string {
  return ASX_DATE_FORMAT.format(new Date());
}

function isoDaysBefore(isoDate: string, days: number): string {
  const shifted = new Date(`${isoDate}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() - days);
  return shifted.toISOString().slice(0, 10);
}

/** Never fetched, past its TTL, or past the longer backoff after a failure. */
function isDue(candidate: Candidate, now: number): boolean {
  if (!candidate.attemptedAt) return true;
  const age = now - candidate.attemptedAt.getTime();
  return age > (candidate.hasError ? FAILURE_BACKOFF_MS : QUOTE_TTL_MS);
}

/**
 * Which dates of history a company is missing, or null when it needs none.
 *
 * `backfill` means we can't price the anchor yet: there is no close at or before
 * its earliest move date. `topup` means only recent days are missing. Returning
 * null -- the common case once a company is established and already has today --
 * is what lets most refreshes touch `company_prices` not at all.
 */
function closesNeededFrom(candidate: Candidate): string | null {
  const backfillFrom = isoDaysBefore(
    candidate.earliestMoveDate,
    BACKFILL_LEAD_DAYS,
  );

  /**
   * Satisfied once there is a close at or before the earliest move date, which
   * is exactly what the anchor lookup needs -- NOT once history reaches
   * `backfillFrom`.
   *
   * The distinction matters: the lead days widen the *request* so a move date
   * after a long weekend still has a preceding close, but the first trading day
   * Yahoo returns is usually a day or two after the date asked for. Comparing
   * against the requested date therefore never matched, and 16 companies
   * re-fetched and re-upserted their whole history on every refresh -- ~700
   * wasted row writes a time.
   */
  if (
    !candidate.earliestStored ||
    !candidate.latestStored ||
    candidate.earliestStored > candidate.earliestMoveDate
  ) {
    return backfillFrom;
  }

  if (candidate.latestStored < asxToday()) {
    return isoDaysBefore(candidate.latestStored, TOPUP_OVERLAP_DAYS);
  }

  return null;
}

/** Only companies we've actually published research on are worth tracking. */
async function findCandidates(): Promise<Candidate[]> {
  const db = getDb();

  return db
    .select({
      companyId: companies.id,
      ticker: companies.ticker,
      earliestMoveDate: sql<string>`min(${dailyMovers.moveDate})`,
      earliestStored: sql<string | null>`(
        select min(p.price_date)
        from ${companyPrices} p
        where p.company_id = ${companies.id}
      )`,
      latestStored: sql<string | null>`(
        select max(p.price_date)
        from ${companyPrices} p
        where p.company_id = ${companies.id}
      )`,
      attemptedAt: companyQuotes.attemptedAt,
      hasError: sql<boolean>`${companyQuotes.error} is not null`,
    })
    .from(companies)
    .innerJoin(dailyMovers, eq(dailyMovers.companyId, companies.id))
    .leftJoin(companyQuotes, eq(companyQuotes.companyId, companies.id))
    .groupBy(
      companies.id,
      companies.ticker,
      companyQuotes.attemptedAt,
      companyQuotes.error,
    );
}

async function storeCloses(
  companyId: number,
  closes: DailyClose[],
): Promise<void> {
  if (closes.length === 0) return;

  const db = getDb();
  await db
    .insert(companyPrices)
    .values(
      closes.map((bar) => ({
        companyId,
        priceDate: bar.date,
        close: bar.close,
        source: marketData.name,
      })),
    )
    // Today's bar is provisional until the close, so a re-fetch has to be able
    // to correct a date it already wrote.
    .onConflictDoUpdate({
      target: [companyPrices.companyId, companyPrices.priceDate],
      set: {
        close: sql`excluded.close`,
        source: sql`excluded.source`,
        fetchedAt: sql`now()`,
      },
    });
}

/**
 * Every priced company in one statement.
 *
 * One round trip rather than one per company: the database is in Tokyo and a
 * refresh of the whole board was spending most of its time waiting on ~47
 * sequential upserts, not on the provider.
 */
async function recordQuotes(
  priced: { companyId: number; quote: Quote }[],
): Promise<void> {
  if (priced.length === 0) return;

  const db = getDb();
  const now = new Date();

  await db
    .insert(companyQuotes)
    .values(
      priced.map(({ companyId, quote }) => ({
        companyId,
        price: quote.price,
        currency: quote.currency,
        asOf: quote.asOf,
        source: marketData.name,
        refreshedAt: now,
        attemptedAt: now,
        error: null,
      })),
    )
    // `excluded` is the row we just proposed, so one statement can carry a
    // different price for every company.
    .onConflictDoUpdate({
      target: companyQuotes.companyId,
      set: {
        price: sql`excluded.price`,
        currency: sql`excluded.currency`,
        asOf: sql`excluded.as_of`,
        source: sql`excluded.source`,
        refreshedAt: sql`excluded.refreshed_at`,
        attemptedAt: sql`excluded.attempted_at`,
        error: null,
      },
    });
}

/**
 * Records the attempt and the reason for companies we couldn't price, keeping
 * the last good price in place -- a stale price with a visible timestamp beats a
 * blank column. Also one statement, for the same reason as above.
 */
async function recordFailures(
  failures: { companyId: number; reason: string }[],
): Promise<void> {
  if (failures.length === 0) return;

  const db = getDb();
  const now = new Date();

  await db
    .insert(companyQuotes)
    .values(
      failures.map(({ companyId, reason }) => ({
        companyId,
        attemptedAt: now,
        error: reason,
      })),
    )
    .onConflictDoUpdate({
      target: companyQuotes.companyId,
      // Deliberately leaves `price` and `refreshed_at` alone.
      set: { attemptedAt: sql`excluded.attempted_at`, error: sql`excluded.error` },
    });
}

/**
 * Phase 1: one batched request for every due company, then one row each.
 *
 * A ticker absent from the response is recorded as a failure so it backs off,
 * which is how a delisted holding stops being asked for every half hour.
 */
async function refreshQuotes(due: Candidate[]): Promise<number> {
  const quotes = await marketData.fetchQuotes(due.map((c) => c.ticker));

  const priced: { companyId: number; quote: Quote }[] = [];
  const failures: { companyId: number; reason: string }[] = [];

  for (const candidate of due) {
    const quote = quotes.get(candidate.ticker);
    if (quote) {
      priced.push({ companyId: candidate.companyId, quote });
    } else {
      failures.push({
        companyId: candidate.companyId,
        reason: `No price returned for ${candidate.ticker} (delisted, or not an ASX ticker?)`,
      });
    }
  }

  await Promise.all([recordQuotes(priced), recordFailures(failures)]);
  return priced.length;
}

/**
 * Phase 2: history, only where it's missing.
 *
 * Failures here are logged and counted but deliberately do NOT mark the company
 * as failed: its quote may have succeeded, and writing an error would put the
 * price itself into a six-hour backoff over a missing close. `closesNeededFrom`
 * stays true, so the next sweep simply tries again.
 */
async function refreshCloses(candidates: Candidate[]): Promise<number> {
  let failures = 0;
  let next = 0;

  async function worker() {
    while (next < candidates.length) {
      const candidate = candidates[next++];
      const from = closesNeededFrom(candidate);
      if (!from) continue;

      try {
        const closes = await marketData.fetchCloses(candidate.ticker, from);
        await storeCloses(candidate.companyId, closes);
      } catch (error) {
        failures += 1;
        console.error(`history fetch failed for ${candidate.ticker}`, error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker),
  );

  return failures;
}

/**
 * Coalesces concurrent callers. Several tabs opening at once (or React running
 * an effect twice in development) would otherwise each start a full sweep and
 * fight over the same rows.
 *
 * Keyed by mode: a forced run must not be answered by an automatic sweep that
 * happens to be in flight, since that sweep skips everything inside its TTL and
 * the person who clicked would be told "up to date" about prices it never
 * fetched. Two forced clicks *do* share one run.
 */
const inFlight = new Map<"auto" | "force", Promise<RefreshSummary>>();

export function refreshStalePrices(
  options: RefreshOptions = {},
): Promise<RefreshSummary> {
  const key = options.force ? "force" : "auto";

  let run = inFlight.get(key);
  if (!run) {
    run = sweep(options).finally(() => inFlight.delete(key));
    inFlight.set(key, run);
  }
  return run;
}

async function sweep(options: RefreshOptions): Promise<RefreshSummary> {
  const candidates = await findCandidates();
  const now = Date.now();

  const due = options.force
    ? candidates
    : candidates.filter((candidate) => isDue(candidate, now));
  if (due.length === 0) return NOTHING_TO_DO;

  let refreshed: number;
  try {
    refreshed = await refreshQuotes(due);
  } catch (error) {
    // The batch itself failed, so nothing was learned about any ticker. Advance
    // every attempt so a provider outage backs off instead of being retried on
    // every page load.
    console.error("batch quote request failed", error);
    const reason =
      error instanceof Error ? error.message : "Price provider unreachable";
    await recordFailures(
      due.map((candidate) => ({ companyId: candidate.companyId, reason })),
    ).catch((writeError) => console.error("recording outage failed", writeError));
    return { due: due.length, refreshed: 0, failed: due.length };
  }

  // Oldest attempt first, so a run that hits the history ceiling still makes
  // progress on the most out-of-date companies rather than the same ones.
  const needHistory = due
    .filter((candidate) => closesNeededFrom(candidate) !== null)
    .sort(
      (a, b) =>
        (a.attemptedAt?.getTime() ?? 0) - (b.attemptedAt?.getTime() ?? 0),
    );

  const historyQueue = options.force
    ? needHistory
    : needHistory.slice(0, MAX_BACKFILLS_PER_RUN);

  if (historyQueue.length > 0) await refreshCloses(historyQueue);

  return { due: due.length, refreshed, failed: due.length - refreshed };
}
