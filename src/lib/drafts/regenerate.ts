import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { analysts, moverDrafts } from "@/db/schema";
import { ZERO_USAGE } from "@/lib/ai/client";
import { loadAnnouncementDocuments } from "@/lib/ai/announcement-text";
import type { MoverSelection } from "@/lib/ai/mover-draft";
import { asxData, type Announcement, type ScreenerRow } from "@/lib/asx";
import { ANNOUNCEMENTS_TARGET } from "@/lib/asx/types";
import type { VolumeProfile } from "@/lib/market/volume";

import { finishDraft, type GenerateOutcome } from "./generate";

/**
 * Re-runs an existing draft through the current prompt and template.
 *
 * ## Why this exists
 *
 * The pipeline is built for *today*: it screens the live board, and there is no
 * way to ask the market provider for a past session's movers. So when the house
 * rules change — as they did on 11 September 2026, when the report went to five
 * pages, gained source lines and moved to Opus 5 — there was no way to see what
 * the new rules would have done with a note the desk had already reviewed. The
 * only honest comparison is the same evidence through the new prompt.
 *
 * That is what this does. The subject, the screen row, the rationale and the
 * exact announcement list are taken from the stored draft rather than derived
 * again, so the only thing that differs between the two drafts is the code that
 * wrote them. Everything from "the evidence is in hand" onward is `finishDraft`,
 * shared with the scheduled run — a regenerate that verified figures by
 * slightly different rules would not be a comparison at all.
 *
 * ## Why it can share a date with the draft it came from
 *
 * The partial unique index that stops the cron drafting the same day twice is
 * `(move_date) WHERE trigger = 'cron'`. A regenerate is written as `manual`, so
 * a second draft for 10 September is allowed to exist beside the scheduled one
 * — which is the point: both sit in the review queue and can be read against
 * each other.
 *
 * The announcements are re-downloaded rather than stored as text. A corpus of
 * twenty filings is tens of megabytes of extracted text, `mover_drafts` is not
 * a document store, and the ASX still serves them.
 */
/** What `runRegeneration` needs: the row it created, and the evidence to feed it. */
export type RegenerationPlan = {
  draftId: number;
  sourceDraftId: number;
  moveDate: string;
  ticker: string;
  row: ScreenerRow;
  selection: MoverSelection;
  analyst: { id: number | null; name: string };
  today: Announcement[];
  history: Announcement[];
  volumeProfile: VolumeProfile | null;
};

/**
 * Both halves at once, for the CLI.
 *
 * The Server Action cannot use this: it has to return the new draft id to the
 * browser before the pipeline runs, so it calls `planRegeneration` inline and
 * hands `runRegeneration` to `after`. Same split, and the same reason, as
 * `generateDraft` against `runDraftPipeline`.
 */
export async function regenerateDraft(options: {
  sourceDraftId: number;
  actorEmail: string | null;
}): Promise<GenerateOutcome> {
  const planned = await planRegeneration(options);
  if (!planned.ok) return planned;
  return runRegeneration(planned.plan);
}

/**
 * Reads the source draft, creates the new row, and returns what the run needs.
 *
 * Everything slow — downloading twenty filings, three model calls, the render —
 * happens in `runRegeneration`. This half only touches the database, so a
 * caller can await it and still answer a click in milliseconds.
 */
export async function planRegeneration(options: {
  sourceDraftId: number;
  actorEmail: string | null;
}): Promise<
  | { ok: true; plan: RegenerationPlan }
  | { ok: false; draftId: null; reason: string }
> {
  const db = getDb();

  const [source] = await db
    .select({
      moveDate: moverDrafts.moveDate,
      ticker: moverDrafts.ticker,
      companyName: moverDrafts.companyName,
      sector: moverDrafts.sector,
      analystId: moverDrafts.analystId,
      screen: moverDrafts.screen,
      selection: moverDrafts.selection,
      sources: moverDrafts.sources,
    })
    .from(moverDrafts)
    .where(eq(moverDrafts.id, options.sourceDraftId))
    .limit(1);

  if (!source) {
    return {
      ok: false,
      draftId: null,
      reason: `Draft ${options.sourceDraftId} does not exist.`,
    };
  }

  const sources = (source.sources ?? {}) as {
    today?: Announcement[];
    history?: Announcement[];
    volumeProfile?: VolumeProfile | null;
  };
  const selection = source.selection as MoverSelection | null;
  const ticker = source.ticker;

  /**
   * A draft that never reached the reading stage has nothing to reuse.
   *
   * Failed rows are the common case here — they stop at screening or selection,
   * so `sources` is empty and re-running would mean screening today's board for
   * a past date, which is exactly what this function exists not to do.
   */
  if (!ticker || !selection || !sources.today || !sources.history) {
    return {
      ok: false,
      draftId: null,
      reason:
        `Draft ${options.sourceDraftId} has no stored evidence to re-run — ` +
        `it did not get past selection.`,
    };
  }

  const row = findScreenRow(source.screen, ticker);
  if (!row) {
    return {
      ok: false,
      draftId: null,
      reason: `Draft ${options.sourceDraftId} has no screen row for ${ticker}.`,
    };
  }

  const moveDate = source.moveDate as unknown as string;
  const analyst = await resolveAnalyst(source.analystId);

  const [created] = await db
    .insert(moverDrafts)
    .values({
      status: "generating",
      moveDate,
      trigger: "manual",
      createdBy: options.actorEmail,
      ticker,
      companyName: source.companyName,
      sector: source.sector,
      analystId: analyst.id,
      screen: source.screen,
      selection: source.selection,
      sources: source.sources,
      progress: `Re-running draft ${options.sourceDraftId} under the current prompt`,
    })
    .returning({ id: moverDrafts.id });

  return {
    ok: true,
    plan: {
      draftId: created.id,
      sourceDraftId: options.sourceDraftId,
      moveDate,
      ticker,
      row,
      selection,
      analyst,
      today: sources.today,
      history: sources.history,
      volumeProfile: sources.volumeProfile ?? null,
    },
  };
}

/**
 * Runs a planned regeneration against the row `planRegeneration` created.
 *
 * Owns its own failure bookkeeping, like `runDraftPipeline`: whatever goes
 * wrong, the row ends up `failed` carrying the reason rather than stuck on
 * `generating` with nothing to explain it.
 */
export async function runRegeneration(
  plan: RegenerationPlan,
): Promise<GenerateOutcome> {
  const db = getDb();
  const { draftId, moveDate, ticker } = plan;
  const startedAt = Date.now();

  try {
    const todayDocuments = await loadAnnouncementDocuments(plan.today);
    const historyDocuments = await loadAnnouncementDocuments(plan.history);

    if (todayDocuments.length === 0 && historyDocuments.length === 0) {
      throw new Error(
        "none of the stored announcements could be downloaded again",
      );
    }

    const { ticker: writtenTicker } = await finishDraft({
      draftId,
      moveDate,
      row: plan.row,
      selection: plan.selection,
      analyst: plan.analyst,
      todayDocuments,
      historyDocuments,
      volumeProfile: plan.volumeProfile,
      filingTimeline: await buildFilingTimeline(ticker, moveDate),
      startedAt,
      usage: ZERO_USAGE,
    });

    return { ok: true, draftId, ticker: writtenTicker };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Regeneration failed.";
    console.error(`regenerated draft ${draftId} failed`, error);

    try {
      await db
        .update(moverDrafts)
        .set({ status: "failed", error: reason, progress: null })
        .where(eq(moverDrafts.id, draftId));
    } catch (updateError) {
      console.error(`could not mark draft ${draftId} failed`, updateError);
    }

    return { ok: false, draftId, reason };
  }
}

/** The stored board row for this ticker, from either side of the screen. */
function findScreenRow(screen: unknown, ticker: string): ScreenerRow | null {
  const boards = (screen as { boards?: { rows?: ScreenerRow[] }[] } | null)
    ?.boards;
  if (!Array.isArray(boards)) return null;

  for (const board of boards) {
    const match = board.rows?.find((candidate) => candidate.ticker === ticker);
    if (match) return match;
  }
  return null;
}

/**
 * The by-line. The source draft's analyst first, so a regenerate is filed under
 * the same name as the draft it is being compared with.
 */
async function resolveAnalyst(
  analystId: number | null,
): Promise<{ id: number | null; name: string }> {
  try {
    const db = getDb();
    const rows = analystId
      ? await db
          .select({ id: analysts.id, name: analysts.name })
          .from(analysts)
          .where(eq(analysts.id, analystId))
          .limit(1)
      : await db
          .select({ id: analysts.id, name: analysts.name })
          .from(analysts)
          .where(eq(analysts.active, true))
          .orderBy(analysts.id)
          .limit(1);

    const [analyst] = rows;
    if (analyst) return { id: analyst.id, name: analyst.name };
  } catch (error) {
    console.warn("could not resolve an analyst for the by-line", error);
  }
  return { id: null, name: "Vitti Capital Research" };
}

/**
 * The date-and-headline index, as the original run had it.
 *
 * Refetched rather than reconstructed from the stored lists, because the stored
 * lists are only what was *read* — the index is every filing in the window, and
 * it is what the prompt uses for management changes and event sequence. Filings
 * lodged after the move date are dropped: the report is written as of that
 * session, and a regenerate that could see next week's announcements would
 * flatter itself.
 */
async function buildFilingTimeline(
  ticker: string,
  moveDate: string,
): Promise<{ date: string; isPriceSensitive: boolean; headline: string }[]> {
  try {
    const announcements = await asxData.fetchAnnouncements(ticker, {
      minPriceSensitive: ANNOUNCEMENTS_TARGET,
    });
    return announcements
      .filter((item) => item.date <= moveDate)
      .map((item) => ({
        date: item.date,
        isPriceSensitive: item.isPriceSensitive,
        headline: item.headline,
      }));
  } catch (error) {
    console.warn(`could not refetch the filing timeline for ${ticker}`, error);
    return [];
  }
}
