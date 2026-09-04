import "server-only";

import { desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { analysts, moverDrafts } from "@/db/schema";

import type { DraftListItem, DraftRow, DraftStatus } from "./types";

/**
 * Reads for the Mover Studio review queue.
 *
 * `server-only`, like `lib/queries.ts`, and for the same reason: it imports the
 * Postgres driver.
 */

const LIST_SELECTION = {
  id: moverDrafts.id,
  status: moverDrafts.status,
  moveDate: moverDrafts.moveDate,
  trigger: moverDrafts.trigger,
  ticker: moverDrafts.ticker,
  companyName: moverDrafts.companyName,
  movePct: moverDrafts.movePct,
  progress: moverDrafts.progress,
  error: moverDrafts.error,
  createdAt: moverDrafts.createdAt,
  approvedMoverId: moverDrafts.approvedMoverId,
};

/**
 * The review queue.
 *
 * Ordered by creation rather than move date so a re-draft of an older session
 * appears where the reviewer just made it, not buried among that day's rows.
 */
export async function listDrafts(options?: {
  statuses?: DraftStatus[];
  limit?: number;
}): Promise<DraftListItem[]> {
  const db = getDb();
  const limit = options?.limit ?? 30;

  const rows = await (options?.statuses?.length
    ? db
        .select(LIST_SELECTION)
        .from(moverDrafts)
        .where(inArray(moverDrafts.status, options.statuses))
        .orderBy(desc(moverDrafts.createdAt))
        .limit(limit)
    : db
        .select(LIST_SELECTION)
        .from(moverDrafts)
        .orderBy(desc(moverDrafts.createdAt))
        .limit(limit));

  return rows as DraftListItem[];
}

export async function getDraftById(id: number): Promise<DraftRow | null> {
  const db = getDb();

  const [row] = await db
    .select({
      id: moverDrafts.id,
      status: moverDrafts.status,
      moveDate: moverDrafts.moveDate,
      trigger: moverDrafts.trigger,
      ticker: moverDrafts.ticker,
      companyName: moverDrafts.companyName,
      sector: moverDrafts.sector,
      movePct: moverDrafts.movePct,
      moveType: moverDrafts.moveType,
      moveWindowLabel: moverDrafts.moveWindowLabel,
      catalystSlug: moverDrafts.catalystSlug,
      reasonForMove: moverDrafts.reasonForMove,
      mainTakeaway: moverDrafts.mainTakeaway,
      reportPrice: moverDrafts.reportPrice,
      analystName: analysts.name,
      draftStoragePath: moverDrafts.draftStoragePath,
      selection: moverDrafts.selection,
      sources: moverDrafts.sources,
      report: moverDrafts.report,
      screen: moverDrafts.screen,
      model: moverDrafts.model,
      inputTokens: moverDrafts.inputTokens,
      cacheWriteTokens: moverDrafts.cacheWriteTokens,
      cacheReadTokens: moverDrafts.cacheReadTokens,
      outputTokens: moverDrafts.outputTokens,
      progress: moverDrafts.progress,
      error: moverDrafts.error,
      createdBy: moverDrafts.createdBy,
      createdAt: moverDrafts.createdAt,
      reviewedBy: moverDrafts.reviewedBy,
      reviewedAt: moverDrafts.reviewedAt,
      reviewNote: moverDrafts.reviewNote,
      approvedMoverId: moverDrafts.approvedMoverId,
    })
    .from(moverDrafts)
    .leftJoin(analysts, eq(moverDrafts.analystId, analysts.id))
    .where(eq(moverDrafts.id, id));

  if (!row) return null;

  const { draftStoragePath, ...rest } = row;

  return {
    ...rest,
    // The storage key itself never reaches the client: the PDF is served
    // through `/api/drafts/[id]/pdf`, which mints a short-lived signed URL the
    // same way the archive's own download route does.
    hasPdf: Boolean(draftStoragePath),
  } as DraftRow;
}

/** The storage key, for the download route and the approve action only. */
export async function getDraftStoragePath(id: number): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ path: moverDrafts.draftStoragePath })
    .from(moverDrafts)
    .where(eq(moverDrafts.id, id));
  return row?.path ?? null;
}

/** Counts per status, for the nav badge and the queue's filter chips. */
export async function getDraftCounts(): Promise<Record<DraftStatus, number>> {
  const db = getDb();

  const rows = await db
    .select({
      status: moverDrafts.status,
      total: sql<number>`count(*)::int`,
    })
    .from(moverDrafts)
    .groupBy(moverDrafts.status);

  const counts: Record<DraftStatus, number> = {
    generating: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    failed: 0,
  };
  for (const row of rows) counts[row.status] = row.total;
  return counts;
}

/**
 * The draft the Studio opens on: whatever most needs a decision.
 *
 * A run in progress outranks a finished one — the reviewer wants to watch it —
 * and a pending draft outranks a rejected or approved one. Falls back to the
 * newest row of any status so the page is never empty when history exists.
 */
export async function getFocusDraftId(): Promise<number | null> {
  const db = getDb();

  const [row] = await db
    .select({ id: moverDrafts.id })
    .from(moverDrafts)
    .orderBy(
      sql`case ${moverDrafts.status}
            when 'generating' then 0
            when 'pending' then 1
            when 'failed' then 2
            else 3
          end`,
      desc(moverDrafts.createdAt),
    )
    .limit(1);

  return row?.id ?? null;
}
