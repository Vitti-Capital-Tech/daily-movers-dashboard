import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { companies, companyPrices, companyQuotes, dailyMovers } from "@/db/schema";
import { marketData, UnknownSymbolError } from "@/lib/market";

/**
 * Keeps stored prices current without anyone entering a number by hand.
 *
 * Refresh is pull-based: opening Daily Movers asks for it, and this module
 * decides whether anything is actually due. That means no cron to keep alive,
 * at the cost of the first visitor after a quiet spell paying for the fetch --
 * which is why the work happens after the page has already rendered from
 * whatever was last stored.
 */

/** How long a quote is considered current. Roughly the provider's own delay. */
const QUOTE_TTL_MS = 30 * 60 * 1000;

/**
 * A ticker that failed waits this long before being tried again. Without it a
 * delisted or misspelled ticker is re-fetched on every single page load, and
 * the failure is usually permanent.
 */
const FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;

/**
 * Ceiling on one run, so a first load against a large archive doesn't turn into
 * a hundred sequential upstream calls. Whatever is left over is simply picked up
 * by the next request -- the staleness check makes runs resumable by nature.
 */
const MAX_COMPANIES_PER_RUN = 20;

/** Concurrent upstream requests. Enough to be quick, not enough to look hostile. */
const CONCURRENCY = 4;

/**
 * Days of slack before the earliest mover when first backfilling a company.
 * The anchor price falls back to the close on the move date, and a move date on
 * a Monday after a holiday needs the preceding week to be present.
 */
const BACKFILL_LEAD_DAYS = 10;

/**
 * Top-up window once a company's history is already stored. Wide enough to
 * cover the 1-month return of a mover published today plus a margin for closes
 * that were provisional when first read.
 */
const TOPUP_DAYS = 45;

export type RefreshSummary = {
  /** Companies that were due a refresh. */
  due: number;
  /** Companies whose prices were updated. */
  refreshed: number;
  /** Companies whose fetch failed; their stored prices are untouched. */
  failed: number;
};

const NOTHING_TO_DO: RefreshSummary = { due: 0, refreshed: 0, failed: 0 };

type Candidate = {
  companyId: number;
  ticker: string;
  earliestMoveDate: string;
  earliestStored: string | null;
  attemptedAt: Date | null;
  hasError: boolean;
};

function isoDaysBefore(isoDate: string, days: number): string {
  const shifted = new Date(`${isoDate}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() - days);
  return shifted.toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const shifted = new Date();
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
 * The whole history for a company we have nothing (or not enough) for,
 * otherwise just the recent tail. Cheap enough either way, but a company
 * covered for years shouldn't re-download years of bars every half hour.
 */
function fetchFrom(candidate: Candidate): string {
  const needed = isoDaysBefore(candidate.earliestMoveDate, BACKFILL_LEAD_DAYS);
  if (!candidate.earliestStored || candidate.earliestStored > needed) {
    return needed;
  }
  return isoDaysAgo(TOPUP_DAYS);
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
  closes: { date: string; close: number }[],
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

async function recordSuccess(
  companyId: number,
  quote: { price: number; currency: string | null; asOf: Date } | null,
): Promise<void> {
  const db = getDb();
  const now = new Date();

  await db
    .insert(companyQuotes)
    .values({
      companyId,
      price: quote?.price ?? null,
      currency: quote?.currency ?? null,
      asOf: quote?.asOf ?? null,
      source: marketData.name,
      refreshedAt: now,
      attemptedAt: now,
      error: null,
    })
    .onConflictDoUpdate({
      target: companyQuotes.companyId,
      set: {
        price: quote?.price ?? null,
        currency: quote?.currency ?? null,
        asOf: quote?.asOf ?? null,
        source: marketData.name,
        refreshedAt: now,
        attemptedAt: now,
        error: null,
      },
    });
}

/**
 * Records the attempt and the reason, keeping the last good price in place --
 * a stale price with a visible timestamp beats a blank column.
 */
async function recordFailure(companyId: number, reason: string): Promise<void> {
  const db = getDb();
  const now = new Date();

  await db
    .insert(companyQuotes)
    .values({ companyId, attemptedAt: now, error: reason })
    .onConflictDoUpdate({
      target: companyQuotes.companyId,
      set: { attemptedAt: now, error: reason },
    });
}

async function refreshOne(candidate: Candidate): Promise<boolean> {
  try {
    const history = await marketData.fetchHistory(
      candidate.ticker,
      fetchFrom(candidate),
    );

    await storeCloses(candidate.companyId, history.closes);
    await recordSuccess(candidate.companyId, history.quote);
    return true;
  } catch (error) {
    const reason =
      error instanceof UnknownSymbolError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Price fetch failed";

    // Logged rather than thrown: one bad ticker must not stop the others.
    console.error(`price refresh failed for ${candidate.ticker}`, error);
    await recordFailure(candidate.companyId, reason).catch((writeError) => {
      console.error("could not record price failure", writeError);
    });
    return false;
  }
}

/** Fixed-size worker pool over the queue -- no batching stalls on one slow ticker. */
async function runPool(queue: Candidate[]): Promise<number> {
  let refreshed = 0;
  let next = 0;

  async function worker() {
    while (next < queue.length) {
      const candidate = queue[next++];
      if (await refreshOne(candidate)) refreshed += 1;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
  );

  return refreshed;
}

/**
 * Coalesces concurrent callers. Several tabs opening at once (or React running
 * an effect twice in development) would otherwise each start a full sweep and
 * fight over the same rows.
 */
let inFlight: Promise<RefreshSummary> | null = null;

export function refreshStalePrices(): Promise<RefreshSummary> {
  inFlight ??= sweep().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function sweep(): Promise<RefreshSummary> {
  const candidates = await findCandidates();
  const now = Date.now();

  const due = candidates.filter((candidate) => isDue(candidate, now));
  if (due.length === 0) return NOTHING_TO_DO;

  // Oldest attempt first, so a run that hits the ceiling still makes progress
  // on the most out-of-date companies rather than the same ones each time.
  due.sort((a, b) => {
    const left = a.attemptedAt?.getTime() ?? 0;
    const right = b.attemptedAt?.getTime() ?? 0;
    return left - right;
  });

  const queue = due.slice(0, MAX_COMPANIES_PER_RUN);
  const refreshed = await runPool(queue);

  return { due: due.length, refreshed, failed: queue.length - refreshed };
}
