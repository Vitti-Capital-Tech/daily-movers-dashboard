import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { companies, companyQuotes, dailyMovers } from "@/db/schema";
import { marketData, UnknownSymbolError, type Quote } from "@/lib/market";

/**
 * Keeps stored prices current without anyone entering a number by hand.
 *
 * Refresh is pull-based: opening Daily Movers asks for it, and this module
 * decides whether anything is actually due. That means no cron to keep alive,
 * at the cost of the first visitor after a quiet spell paying for the fetch --
 * which is why the work happens after the page has already rendered from
 * whatever was last stored.
 *
 * Two kinds of price, on very different schedules:
 *
 *  1. **Current prices** for every due company -- one batched request, then one
 *     multi-row upsert. This is the part that runs every 30 minutes.
 *  2. **The anchor close** for a mover with no report price -- fetched once per
 *     mover, ever, because a past close does not change. Normally there is
 *     nothing to do here at all.
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
 * Ceiling on anchor lookups in one run, so importing a large archive doesn't
 * turn into a hundred sequential chart requests. The rest are picked up by the
 * next refresh, since the "still null" condition is what selects them.
 */
const MAX_ANCHORS_PER_RUN = 20;

/** Concurrent anchor requests. Enough to be quick, not enough to look hostile. */
const CONCURRENCY = 4;

/**
 * How far before the move date to ask for closes. The anchor is the last close
 * on or before that date, and a move date after a long weekend needs the
 * preceding week in the window to find one.
 */
const ANCHOR_LOOKBACK_DAYS = 10;

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
  attemptedAt: Date | null;
  hasError: boolean;
};

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

/** Only companies we've actually published research on are worth tracking. */
async function findCandidates(): Promise<Candidate[]> {
  const db = getDb();

  return db
    .selectDistinct({
      companyId: companies.id,
      ticker: companies.ticker,
      attemptedAt: companyQuotes.attemptedAt,
      hasError: sql<boolean>`${companyQuotes.error} is not null`,
    })
    .from(companies)
    .innerJoin(dailyMovers, eq(dailyMovers.companyId, companies.id))
    .leftJoin(companyQuotes, eq(companyQuotes.companyId, companies.id));
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
 * One batched request for every due company, then two statements.
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

type MissingAnchor = { moverId: number; ticker: string; moveDate: string };

/**
 * Movers that still need an anchor close: no report price was entered and we
 * haven't resolved the close on their date yet.
 *
 * Normally empty. It fills only when a new mover is added, which is why this is
 * a one-off lookup rather than anything the 30-minute refresh repeats.
 */
async function findMissingAnchors(): Promise<MissingAnchor[]> {
  const db = getDb();

  return db
    .select({
      moverId: dailyMovers.id,
      ticker: companies.ticker,
      moveDate: dailyMovers.moveDate,
    })
    .from(dailyMovers)
    .innerJoin(companies, eq(companies.id, dailyMovers.companyId))
    .where(
      and(isNull(dailyMovers.reportPrice), isNull(dailyMovers.moveDateClose)),
    );
}

/**
 * Resolves and stores the close on (or last before) each mover's date.
 *
 * Written once per mover and never revisited: a past close is settled. A mover
 * whose date the provider has no data for stays null and renders as "—", and is
 * retried on later refreshes -- one request, no writes.
 */
async function fillAnchors(missing: MissingAnchor[]): Promise<void> {
  const db = getDb();
  let next = 0;

  async function worker() {
    while (next < missing.length) {
      const mover = missing[next++];

      try {
        const closes = await marketData.fetchCloses(
          mover.ticker,
          isoDaysBefore(mover.moveDate, ANCHOR_LOOKBACK_DAYS),
        );

        // Last close at or before the move date. `<=` rather than `=` because a
        // move date can land on a day with no close of its own -- a halt, or a
        // date recorded slightly off -- and the previous close is the honest
        // answer there.
        const anchor = closes
          .filter((bar) => bar.date <= mover.moveDate)
          .at(-1);

        if (!anchor) continue;

        await db
          .update(dailyMovers)
          .set({ moveDateClose: anchor.close })
          .where(eq(dailyMovers.id, mover.moverId));
      } catch (error) {
        // Logged, not recorded against the company: its live quote may be fine,
        // and a missing historical close shouldn't put the price into backoff.
        const detail =
          error instanceof UnknownSymbolError ? error.message : error;
        console.error(
          `anchor close unavailable for ${mover.ticker} on ${mover.moveDate}`,
          detail,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker),
  );
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

  const missing = await findMissingAnchors();
  if (missing.length > 0) {
    await fillAnchors(
      options.force ? missing : missing.slice(0, MAX_ANCHORS_PER_RUN),
    );
  }

  return { due: due.length, refreshed, failed: due.length - refreshed };
}
