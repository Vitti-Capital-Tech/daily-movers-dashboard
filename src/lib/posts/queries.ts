import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  catalysts,
  companies,
  companyQuotes,
  dailyMovers,
  linkedinPosts,
} from "@/db/schema";
import { pctChange } from "@/lib/movers";

import { daysBetween, type PostRow, type PostStatus, type TrackRecordRow } from "./types";

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
 * Every published mover with its performance since publication.
 *
 * Not paginated. The whole point of the page is the track record as one view,
 * the archive is in the dozens rather than the thousands, and the sort the page
 * wants — by how far the price has moved since — cannot be done in SQL without
 * repeating the return expression in the ORDER BY. It is derived once here in
 * `pctChange`, which is also what the table view uses, so the two can't drift.
 */
export async function listTrackRecord(): Promise<TrackRecordRow[]> {
  const db = getDb();

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
    /**
     * Only the newest post per mover. A lateral join rather than a plain left
     * join, because a mover regenerated three times would otherwise multiply
     * into three track-record rows.
     */
    .leftJoin(
      linkedinPosts,
      sql`${linkedinPosts.id} = (
        select lp.id from ${linkedinPosts} lp
        where lp.mover_id = ${dailyMovers.id}
        order by lp.created_at desc
        limit 1
      )`,
    )
    .orderBy(desc(dailyMovers.moveDate), desc(dailyMovers.id));

  return rows.map((row): TrackRecordRow => {
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
