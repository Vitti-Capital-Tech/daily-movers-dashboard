import "server-only";

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  catalysts,
  companies,
  companyQuotes,
  dailyMovers,
  linkedinPosts,
} from "@/db/schema";
import { pctChange } from "@/lib/movers";
import { resolvePaging, type Paged } from "@/lib/table";

import {
  daysBetween,
  type PostRow,
  type PostStatus,
  type PostVerdict,
  type TrackRecordFilters,
  type TrackRecordRow,
} from "./types";

/**
 * Reads for Post Studio: the track record, and the posts drafted from it.
 *
 * `server-only`, like the other query modules — it imports the Postgres driver.
 */

/**
 * The same anchor the archive uses: the report price if one was entered,
 * otherwise the ASX close on the move date. Duplicated from `lib/queries.ts`
 * rather than exported from it, because exporting a `sql` fragment couples two
 * modules' column lists together for the sake of three lines.
 */
const anchorPriceSql = sql<number | null>`coalesce(
  ${dailyMovers.reportPrice}::float8,
  ${dailyMovers.moveDateClose}::float8
)`;

/**
 * Only the newest post per mover.
 *
 * A correlated subquery rather than a plain join, because a mover assessed
 * three times would otherwise multiply into three track-record rows — and with
 * pagination that would also make the row count wrong, not just the display.
 */
const newestPostSql = sql`${linkedinPosts.id} = (
  select lp.id from ${linkedinPosts} lp
  where lp.mover_id = ${dailyMovers.id}
  order by lp.created_at desc
  limit 1
)`;

/**
 * Filtering happens in SQL, not in the browser — the same rule the archive's
 * own list follows. Client-side filtering looks fine on 56 rows and quietly
 * dies at a few thousand, and it would make the pagination count a lie.
 */
function buildTrackRecordWhere(filters: TrackRecordFilters) {
  const conditions = [];

  if (filters.q) {
    const term = `%${filters.q}%`;
    conditions.push(
      or(ilike(companies.ticker, term), ilike(companies.name, term)),
    );
  }

  /**
   * `assessed` asks whether this mover has *any* post, not whether the newest
   * one survives the join — so it is an EXISTS rather than a null check on the
   * joined row.
   */
  if (filters.assessed === "assessed") {
    conditions.push(
      sql`exists (select 1 from ${linkedinPosts} lp where lp.mover_id = ${dailyMovers.id})`,
    );
  }
  if (filters.assessed === "unassessed") {
    conditions.push(
      sql`not exists (select 1 from ${linkedinPosts} lp where lp.mover_id = ${dailyMovers.id})`,
    );
  }

  return conditions.length ? and(...conditions) : undefined;
}

/**
 * Published movers with their performance since publication, filtered and
 * paginated.
 *
 * Ordered by publication date, newest first — deliberately not by return. A
 * leaderboard of biggest gains would push everything that went the other way
 * onto the last page, which is the exact framing that turns a track record into
 * a misleading one.
 *
 * The post-event return is derived here in `pctChange` rather than in SQL, so
 * there is one copy of that arithmetic shared with the archive's table. The cost
 * is that the return cannot be an ORDER BY key; the benefit is that the two
 * views can never disagree about a number.
 */
export async function listTrackRecord(
  filters: TrackRecordFilters = {},
): Promise<Paged<TrackRecordRow>> {
  const db = getDb();

  const where = buildTrackRecordWhere(filters);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(dailyMovers)
    .innerJoin(companies, eq(dailyMovers.companyId, companies.id))
    .where(where);

  const { page, perPage, pageCount, offset } = resolvePaging(filters, total);

  const rows = await db
    .select({
      moverId: dailyMovers.id,
      moveDate: dailyMovers.moveDate,
      ticker: companies.ticker,
      companyName: companies.name,
      catalystLabel: catalysts.label,
      movePct: dailyMovers.movePct,
      mainTakeaway: dailyMovers.mainTakeaway,
      reasonForMove: dailyMovers.reasonForMove,
      anchorPrice: anchorPriceSql,
      currentPrice: companyQuotes.price,
      currentPriceAt: companyQuotes.asOf,

      postId: linkedinPosts.id,
      postStatus: linkedinPosts.status,
      postVerdict: linkedinPosts.verdict,
      postVariants: linkedinPosts.posts,
      postCreatedAt: linkedinPosts.createdAt,
    })
    .from(dailyMovers)
    .innerJoin(companies, eq(dailyMovers.companyId, companies.id))
    .innerJoin(catalysts, eq(dailyMovers.catalystId, catalysts.id))
    .leftJoin(companyQuotes, eq(companyQuotes.companyId, dailyMovers.companyId))
    .leftJoin(linkedinPosts, newestPostSql)
    .where(where)
    // id as a tiebreaker so same-day rows keep a stable order across pages.
    .orderBy(desc(dailyMovers.moveDate), desc(dailyMovers.id))
    .limit(perPage)
    .offset(offset);

  const mapped = rows.map((row): TrackRecordRow => {
    const postEventReturn = pctChange(row.anchorPrice, row.currentPrice);

    return {
      moverId: row.moverId,
      moveDate: row.moveDate,
      ticker: row.ticker,
      companyName: row.companyName,
      catalystLabel: row.catalystLabel,
      movePct: row.movePct,
      mainTakeaway: row.mainTakeaway,
      reasonForMove: row.reasonForMove,
      anchorPrice: row.anchorPrice,
      currentPrice: row.currentPrice,
      currentPriceAt: row.currentPriceAt,
      postEventReturn,
      daysSince: daysBetween(row.moveDate),
      /**
       * Whether the price kept going the way it went on the day. Reported as a
       * fact, never as a verdict: 31 of the archive's 56 movers reversed, and
       * some of those reversals are exactly what the note predicted. The
       * judgement is `verdict`, and only the model reading the takeaway makes it.
       */
      continued:
        postEventReturn === null
          ? null
          : Math.sign(postEventReturn) === Math.sign(row.movePct),
      post: row.postId
        ? {
            id: row.postId,
            status: row.postStatus as PostStatus,
            verdict: row.postVerdict!,
            variantCount: Array.isArray(row.postVariants)
              ? row.postVariants.length
              : 0,
            createdAt: row.postCreatedAt!,
          }
        : null,
    };
  });

  return { rows: mapped, total, page, perPage, pageCount };
}

export async function getPostById(id: number): Promise<PostRow | null> {
  const db = getDb();

  const [row] = await db
    .select({
      id: linkedinPosts.id,
      moverId: linkedinPosts.moverId,
      status: linkedinPosts.status,
      verdict: linkedinPosts.verdict,
      verdictReason: linkedinPosts.verdictReason,
      evidenceQuote: linkedinPosts.evidenceQuote,
      variants: linkedinPosts.posts,
      snapshot: linkedinPosts.snapshot,
      ticker: companies.ticker,
      companyName: companies.name,
      moveDate: dailyMovers.moveDate,
      movePct: dailyMovers.movePct,
      mainTakeaway: dailyMovers.mainTakeaway,
      model: linkedinPosts.model,
      inputTokens: linkedinPosts.inputTokens,
      cacheWriteTokens: linkedinPosts.cacheWriteTokens,
      cacheReadTokens: linkedinPosts.cacheReadTokens,
      outputTokens: linkedinPosts.outputTokens,
      createdBy: linkedinPosts.createdBy,
      createdAt: linkedinPosts.createdAt,
      postedAt: linkedinPosts.postedAt,
    })
    .from(linkedinPosts)
    .innerJoin(dailyMovers, eq(linkedinPosts.moverId, dailyMovers.id))
    .innerJoin(companies, eq(dailyMovers.companyId, companies.id))
    .where(eq(linkedinPosts.id, id));

  if (!row) return null;

  return {
    ...row,
    variants: Array.isArray(row.variants) ? row.variants : [],
  } as PostRow;
}

/**
 * Every assessment ever made of one mover, newest first.
 *
 * The point of keeping them rather than overwriting: a verdict is a judgement
 * about a moment. "Too early to say" three weeks after publication is the right
 * answer then and the wrong one three months later, and the history is what
 * shows a reviewer that the call was re-examined rather than shopped until it
 * came out favourably.
 */
export async function listAssessmentsForMover(moverId: number): Promise<
  {
    id: number;
    verdict: PostVerdict;
    status: PostStatus;
    variantCount: number;
    /** The return the assessment was made against, from its snapshot. */
    snapshotReturn: number | null;
    createdAt: Date;
  }[]
> {
  const db = getDb();

  const rows = await db
    .select({
      id: linkedinPosts.id,
      verdict: linkedinPosts.verdict,
      status: linkedinPosts.status,
      variants: linkedinPosts.posts,
      snapshot: linkedinPosts.snapshot,
      createdAt: linkedinPosts.createdAt,
    })
    .from(linkedinPosts)
    .where(eq(linkedinPosts.moverId, moverId))
    .orderBy(desc(linkedinPosts.createdAt));

  return rows.map((row) => ({
    id: row.id,
    verdict: row.verdict,
    status: row.status,
    variantCount: Array.isArray(row.variants) ? row.variants.length : 0,
    snapshotReturn:
      row.snapshot && typeof row.snapshot === "object"
        ? ((row.snapshot as { postEventReturn?: number }).postEventReturn ?? null)
        : null,
    createdAt: row.createdAt,
  }));
}

/** Counts per status, for the page's summary line. */
export async function getPostCounts(): Promise<Record<PostStatus, number>> {
  const db = getDb();

  const rows = await db
    .select({ status: linkedinPosts.status, total: sql<number>`count(*)::int` })
    .from(linkedinPosts)
    .groupBy(linkedinPosts.status);

  const counts: Record<PostStatus, number> = {
    draft: 0,
    posted: 0,
    discarded: 0,
  };
  for (const row of rows) counts[row.status] = row.total;
  return counts;
}

/** The mover's fields the generator needs, plus its live performance. */
export async function getMoverForPost(moverId: number) {
  const db = getDb();

  const [row] = await db
    .select({
      moverId: dailyMovers.id,
      moveDate: dailyMovers.moveDate,
      ticker: companies.ticker,
      companyName: companies.name,
      sector: companies.sector,
      catalystLabel: catalysts.label,
      movePct: dailyMovers.movePct,
      moveType: dailyMovers.moveType,
      moveWindowLabel: dailyMovers.moveWindowLabel,
      reasonForMove: dailyMovers.reasonForMove,
      mainTakeaway: dailyMovers.mainTakeaway,
      anchorPrice: anchorPriceSql,
      currentPrice: companyQuotes.price,
      currentPriceAt: companyQuotes.asOf,
    })
    .from(dailyMovers)
    .innerJoin(companies, eq(dailyMovers.companyId, companies.id))
    .innerJoin(catalysts, eq(dailyMovers.catalystId, catalysts.id))
    .leftJoin(companyQuotes, eq(companyQuotes.companyId, dailyMovers.companyId))
    .where(eq(dailyMovers.id, moverId));

  return row ?? null;
}
