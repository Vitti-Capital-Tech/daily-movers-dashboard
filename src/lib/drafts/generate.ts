import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { analysts, dailyMovers, moverDrafts } from "@/db/schema";
import {
  asxData,
  DEFAULT_SCREEN,
  screenBoards,
  type Announcement,
  type ScreenCriteria,
  type ScreenResult,
  type ScreenerRow,
} from "@/lib/asx";
import { ANNOUNCEMENTS_TARGET } from "@/lib/asx/types";
import { isBackgroundFiling, prioritiseAnnouncements } from "@/lib/asx/filings";
import { loadAnnouncementDocuments } from "@/lib/ai/announcement-text";
import {
  checkReport,
  selectMover,
  writeReport,
  type MoverCandidate,
  type MoverSelection,
} from "@/lib/ai/mover-draft";
import { draftModel, ZERO_USAGE, type TokenUsage } from "@/lib/ai/client";
import { buildDraftPath, renderReportPdf } from "@/lib/report/render";
import { REPORTS_BUCKET } from "@/lib/storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { exchangeDate, tradedOn } from "./trading-day";
import type { AccuracyReview } from "./types";

/**
 * The drafting pipeline: board -> pick -> read -> write -> PDF -> pending row.
 *
 * The `mover_drafts` row is created *first* and advanced in place, before any
 * of the slow work starts. That ordering is what makes the whole thing
 * survivable: reading twenty-five filings and writing a report takes minutes,
 * which is longer than a request should be held open, so the row is the state
 * and the client polls it. A reload mid-run shows progress instead of losing
 * the run, and a crash leaves a `failed` row with the reason on it rather than
 * silence.
 */

/** Progress strings, in the order they appear. Shown verbatim in the UI. */
const STAGES = {
  screening: "Screening today's movers",
  gatheringHeadlines: "Checking today's announcements",
  selecting: "Choosing the best subject",
  readingToday: "Reading today's announcements",
  readingHistory: "Reading announcement history",
  writing: "Writing the report",
  checking: "Checking every figure against the filings",
  revising: "Rewriting to fix what the check found",
  rendering: "Rendering the PDF",
  uploading: "Saving the draft",
} as const;

export type GenerateOptions = {
  /** Who asked. `null` for the scheduled run. */
  actorEmail: string | null;
  trigger: "cron" | "manual";
  criteria?: ScreenCriteria;
  /** Defaults to today's exchange-local date. */
  moveDate?: string;
};

export type GenerateOutcome =
  | { ok: true; draftId: number; ticker: string }
  | { ok: false; draftId: number | null; reason: string };

/** Why a scheduled run declined to do anything. Not an error. */
export type SkipReason =
  | { skip: true; because: string }
  | { skip: false };

/**
 * How many announcement histories to fetch while building the shortlist.
 *
 * Every candidate needs one request to find out whether it filed anything
 * price-sensitive today, and a candidate that filed nothing is unwritable — so
 * this is a hard filter, not just context for the model. Capped because a
 * volatile day can put forty names on the board and the answer rarely changes
 * after the first couple of dozen.
 */
const CANDIDATE_LOOKUP_LIMIT = 40;
const CANDIDATE_LOOKUP_CONCURRENCY = 6;

/**
 * How many unflagged background filings to add to the corpus.
 *
 * Three reaches the last annual report and the two most recent halves or
 * quarterlies for almost every company, which is the accounting history a Daily
 * Mover draws on. A fourth is usually the year-before-last's annual report —
 * the largest document on the list and the one the report is least likely to
 * cite. See `isBackgroundFiling` for why these are not simply in the main list.
 */
const BACKGROUND_TARGET = 3;

/**
 * Deadlines for the two optional stages, against the platform's 300-second
 * invocation ceiling.
 *
 * Both `maxDuration`s in this app are 300 — the Hobby plan's limit and every
 * plan's default, and a higher value fails the build rather than the run. That
 * ceiling is a hard stop with nothing after it: a killed invocation leaves a
 * `generating` row and no report at all, which is strictly worse than an
 * unchecked draft an analyst can read.
 *
 * So the Accuracy Gate and its rewrite are budgeted rather than assumed. With
 * the corpus served from cache the check runs in roughly 40-70 seconds and a
 * rewrite in 60-90; these thresholds leave room for the slow end of both plus
 * the render and upload, and skipping is recorded on the draft so a reviewer is
 * never shown a clean bill of health that was never issued.
 *
 * The order of preference when time is short is deliberate: skip the rewrite
 * before skipping the check. The check's findings are useful to a human on their
 * own; a rewrite without them is nothing.
 */
const CHECK_DEADLINE_MS = 200_000;
const REWRITE_DEADLINE_MS = 150_000;

async function setProgress(draftId: number, progress: string): Promise<void> {
  try {
    const db = getDb();
    await db
      .update(moverDrafts)
      .set({ progress })
      .where(eq(moverDrafts.id, draftId));
  } catch (error) {
    // Progress is a courtesy for the polling UI. Losing an update must not
    // abort a generation that is otherwise going fine.
    console.warn(`could not record progress for draft ${draftId}`, error);
  }
}

/**
 * Whether a scheduled run should go ahead.
 *
 * Three reasons not to, in increasing cost to discover:
 * 1. It isn't a weekday in Sydney.
 * 2. An analyst has already published a Daily Mover for today — the desk has
 *    its note, and a second AI draft is noise in the review queue.
 * 3. A scheduled draft for today already exists (a retried or double-fired
 *    invocation). The unique index would reject the insert anyway; checking
 *    first turns a constraint violation into a clean "already done".
 *
 * A fourth — the market being shut for a public holiday — can only be answered
 * from the market data, so it is checked inside `generateDraft` once the board
 * has been fetched. See `tradedOn`.
 */
export async function shouldRunScheduled(
  moveDate: string,
  weekday: number,
): Promise<SkipReason> {
  if (weekday < 1 || weekday > 5) {
    return { skip: true, because: `${moveDate} is not a weekday in Sydney` };
  }

  const db = getDb();

  const [published] = await db
    .select({ id: dailyMovers.id })
    .from(dailyMovers)
    .where(eq(dailyMovers.moveDate, moveDate))
    .limit(1);

  if (published) {
    return {
      skip: true,
      because: `a Daily Mover for ${moveDate} is already in the archive`,
    };
  }

  const [existing] = await db
    .select({ id: moverDrafts.id, status: moverDrafts.status })
    .from(moverDrafts)
    .where(
      and(eq(moverDrafts.moveDate, moveDate), eq(moverDrafts.trigger, "cron")),
    )
    .limit(1);

  if (existing) {
    return {
      skip: true,
      because: `a scheduled draft for ${moveDate} already exists (#${existing.id}, ${existing.status})`,
    };
  }

  return { skip: false };
}

/** The desk's by-line. Falls back to inserting nothing rather than guessing. */
async function resolveAnalyst(): Promise<{ id: number | null; name: string }> {
  try {
    const db = getDb();
    const [analyst] = await db
      .select({ id: analysts.id, name: analysts.name })
      .from(analysts)
      .where(eq(analysts.active, true))
      .orderBy(analysts.id)
      .limit(1);

    if (analyst) return { id: analyst.id, name: analyst.name };
  } catch (error) {
    console.warn("could not resolve an analyst for the by-line", error);
  }
  return { id: null, name: "Vitti Capital Research" };
}

/**
 * For each screened mover, the price-sensitive announcements it filed on the
 * move date — and only those that filed at least one.
 */
async function buildCandidates(
  screen: ScreenResult,
  moveDate: string,
): Promise<MoverCandidate[]> {
  const flat = screen.boards.flatMap((board) =>
    board.rows.map((row) => ({ row, side: board.side })),
  );

  // Interleave the two boards so the cap doesn't spend all its lookups on
  // gainers and leave the fallers unexamined on a day with a long rally.
  const gainers = flat.filter((entry) => entry.side === "gainers");
  const losers = flat.filter((entry) => entry.side === "losers");
  const interleaved: typeof flat = [];
  for (let i = 0; i < Math.max(gainers.length, losers.length); i += 1) {
    if (gainers[i]) interleaved.push(gainers[i]);
    if (losers[i]) interleaved.push(losers[i]);
  }

  const shortlist = interleaved.slice(0, CANDIDATE_LOOKUP_LIMIT);
  const candidates = new Array<MoverCandidate | null>(shortlist.length);
  let next = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(CANDIDATE_LOOKUP_CONCURRENCY, shortlist.length) },
      async function worker() {
        while (next < shortlist.length) {
          const index = next++;
          const { row, side } = shortlist[index];

          let announcements: Announcement[] = [];
          try {
            // One year page is enough to see today, and this runs once per
            // candidate — walking further back here would be forty times the
            // requests for information the pick doesn't use.
            announcements = await asxData.fetchAnnouncements(row.ticker, {
              minPriceSensitive: 1,
              maxYearsBack: 1,
            });
          } catch (error) {
            console.warn(`candidate lookup failed for ${row.ticker}`, error);
            candidates[index] = null;
            continue;
          }

          const today = announcements.filter(
            (item) => item.date === moveDate && item.isPriceSensitive,
          );

          // No price-sensitive filing today means the move is unexplainable
          // from the public record, and an unexplainable move is not a report.
          if (today.length === 0) {
            candidates[index] = null;
            continue;
          }

          candidates[index] = {
            row,
            side,
            todayHeadlines: today.map((item) => ({
              idsId: item.idsId,
              time: item.time,
              headline: item.headline,
            })),
          };
        }
      },
    ),
  );

  return candidates.filter((entry): entry is MoverCandidate => entry !== null);
}

async function uploadDraftPdf(
  pdf: Buffer,
  ticker: string,
  moveDate: string,
): Promise<string> {
  const path = buildDraftPath({
    ticker,
    moveDate,
    random: crypto.randomUUID().slice(0, 8),
  });

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage
    .from(REPORTS_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: false });

  if (error) {
    throw new Error(
      /bucket/i.test(error.message)
        ? `Storage bucket "${REPORTS_BUCKET}" doesn't exist. Run: npm run storage:setup`
        : `Could not save the draft PDF: ${error.message}`,
    );
  }

  return path;
}

/**
 * Runs the whole pipeline against an existing `generating` draft row.
 *
 * Separated from row creation so the row exists — and is visible to the review
 * queue as in-progress — before any upstream call is made.
 */
async function runPipeline(
  draftId: number,
  requestedDate: string,
  criteria: ScreenCriteria,
  options: { requireRequestedDate: boolean },
): Promise<{ ticker: string; moveDate: string }> {
  const db = getDb();
  let usage: TokenUsage = ZERO_USAGE;
  const startedAt = Date.now();

  await setProgress(draftId, STAGES.screening);
  const screen = await screenBoards(criteria);

  /**
   * The session the board's data actually belongs to.
   *
   * Derived from the feed rather than taken from the caller, because the screen
   * is inherently live — there is no way to ask it for a past day's board. The
   * newest quote timestamp across the whole market names the session those
   * prices came from, so it, not the clock, decides what date this draft covers.
   */
  const sessionDate = exchangeDate(new Date(screen.fetchedAt));

  /**
   * For the scheduled run the two must agree, and that disagreement is the
   * public-holiday check: on Anzac Day the feed's freshest print is from the
   * previous session, and drafting "today's mover" from it would file
   * yesterday's move under today's date.
   *
   * A manual run adopts the session date instead. An analyst clicking the button
   * on a Saturday morning wants Friday's mover, and refusing because the clock
   * says Saturday would be pedantry — the data is unambiguous about which
   * session it is.
   */
  if (options.requireRequestedDate) {
    if (!tradedOn(new Date(screen.fetchedAt), requestedDate)) {
      throw new Error(
        `The market does not appear to have traded on ${requestedDate} — the ` +
          `newest price in the feed is from ${sessionDate}. Probably a public ` +
          `holiday.`,
      );
    }
  } else if (sessionDate !== requestedDate) {
    await db
      .update(moverDrafts)
      .set({ moveDate: sessionDate })
      .where(eq(moverDrafts.id, draftId));
  }

  const moveDate = sessionDate;

  const totalRows = screen.boards.reduce(
    (sum, board) => sum + board.rows.length,
    0,
  );
  if (totalRows === 0) {
    throw new Error(
      `No mover passed the screen on ${moveDate} (minimum ${criteria.minAbsChangePct}% ` +
        `move on ${criteria.minTurnover.toLocaleString()} turnover). Widen the ` +
        `screen or accept that it was a quiet session.`,
    );
  }

  await db
    .update(moverDrafts)
    .set({ screen, progress: STAGES.gatheringHeadlines })
    .where(eq(moverDrafts.id, draftId));

  const candidates = await buildCandidates(screen, moveDate);
  if (candidates.length === 0) {
    throw new Error(
      `${totalRows} movers passed the screen on ${moveDate}, but none of them ` +
        `released a price-sensitive announcement today — so none of them can be ` +
        `explained from the public record.`,
    );
  }

  await setProgress(draftId, STAGES.selecting);
  const picked = await selectMover({ moveDate, candidates, screen }, usage);
  usage = picked.usage;
  const selection: MoverSelection = picked.selection;

  const candidate = candidates.find(
    (entry) => entry.row.ticker === selection.ticker,
  );
  if (!candidate) {
    // `selectMover` already constrains the pick to the candidate list, so this
    // is unreachable — kept so the narrowing is explicit rather than asserted.
    throw new Error(`Selected ticker ${selection.ticker} is not a candidate.`);
  }
  const row: ScreenerRow = candidate.row;

  const analyst = await resolveAnalyst();

  await db
    .update(moverDrafts)
    .set({
      ticker: row.ticker,
      companyName: row.companyName,
      sector: row.sector,
      analystId: analyst.id,
      selection,
      progress: STAGES.readingToday,
    })
    .where(eq(moverDrafts.id, draftId));

  const allAnnouncements = await asxData.fetchAnnouncements(row.ticker, {
    minPriceSensitive: ANNOUNCEMENTS_TARGET,
  });

  const todayAnnouncements = allAnnouncements.filter(
    (item) => item.date === moveDate && item.isPriceSensitive,
  );
  /**
   * Which of the company's earlier filings are worth reading.
   *
   * Not simply the newest N. Measured on a real corpus, 16 of 25
   * price-sensitive announcements and 55% of the tokens were takeover
   * procedure -- six sequential offer-period extensions, five Takeovers Panel
   * receipt notices, and an 89-page implementation deed. `prioritiseAnnouncements`
   * collapses each sequential series to its latest member and gives long legal
   * instruments a smaller reading budget, so the target count is spent on
   * evidence the report can actually cite. See `lib/asx/filings.ts`.
   */
  const priority = prioritiseAnnouncements(
    allAnnouncements.filter(
      (item) => item.isPriceSensitive && item.date !== moveDate,
    ),
    { target: ANNOUNCEMENTS_TARGET },
  );

  /**
   * The accounts, on top of the announcements.
   *
   * The price-sensitive flag is the right filter for the filing that caused the
   * move and the wrong one for the company's background: the Appendix 4E is
   * flagged, the annual report that follows it usually isn't, and the annual
   * report is where the segment note, the cash flow statement and the debt
   * maturities are. Instruction 2 ranks those sources second and third, above
   * anything else here, so a corpus of flagged announcements alone was writing
   * about the business without reading its accounts.
   *
   * Capped at `BACKGROUND_TARGET` and read on a smaller character budget (see
   * `CHAR_BUDGET.background`), because these are the longest documents a company
   * files and the report needs their front halves, not their appendices.
   */
  const backgroundAnnouncements = allAnnouncements
    .filter((item) => item.date !== moveDate && isBackgroundFiling(item))
    .slice(0, BACKGROUND_TARGET);

  const historyAnnouncements = [...priority.keep, ...backgroundAnnouncements]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const todayDocuments = await loadAnnouncementDocuments(todayAnnouncements);

  await setProgress(
    draftId,
    `${STAGES.readingHistory} (0/${historyAnnouncements.length})`,
  );
  const historyDocuments = await loadAnnouncementDocuments(
    historyAnnouncements,
    (done, total) => {
      // Fire-and-forget: the await would serialise the download workers behind
      // a database round trip each.
      if (done % 5 === 0 || done === total) {
        void setProgress(draftId, `${STAGES.readingHistory} (${done}/${total})`);
      }
    },
  );

  await db
    .update(moverDrafts)
    .set({
      sources: {
        today: todayAnnouncements,
        history: historyAnnouncements,
        readToday: todayDocuments.length,
        readHistory: historyDocuments.length,
        /**
         * Superseded series members and filings beyond the target, kept so the
         * audit trail says what was *not* read as well as what was.
         */
        skipped: priority.collapsed.map((item) => ({
          idsId: item.idsId,
          date: item.date,
          headline: item.headline,
          reason: item.seriesKey
            ? `superseded (${item.seriesKey})`
            : "beyond the reading target",
        })),
      },
      progress: STAGES.writing,
    })
    .where(eq(moverDrafts.id, draftId));

  const written = await writeReport(
    {
      moveDate,
      row,
      selection,
      analystName: analyst.name,
      todayDocuments,
      historyDocuments,
    },
    usage,
  );
  usage = written.usage;
  let report = written.report;

  /**
   * The Accuracy Gate (instructions 5 and 24), and one rewrite if it fails.
   *
   * The gate is advisory to the pipeline and mandatory for the reviewer: a
   * blocking finding triggers exactly one rewrite, and the findings are stored
   * on the draft either way. Deliberately not a hard failure — a draft with two
   * unverifiable figures and eight good pages is worth an analyst's ten minutes,
   * while a `failed` row with the reason "a figure could not be traced" throws
   * that away and leaves the desk with nothing to publish.
   *
   * The gate is skipped when there was nothing to check against. With no
   * readable filing the report already says so, and running a verifier over an
   * empty corpus produces a page of findings that all say the same thing.
   */
  let accuracy: AccuracyReview | null = null;
  const evidenceCount = todayDocuments.length + historyDocuments.length;
  const elapsedMs = () => Date.now() - startedAt;

  if (evidenceCount > 0 && elapsedMs() > CHECK_DEADLINE_MS) {
    accuracy = {
      verdict: "pass",
      summary:
        `Writing the report used ${Math.round(elapsedMs() / 1000)} seconds of the ` +
        `run's ${Math.round(CHECK_DEADLINE_MS / 1000)}-second budget, so the accuracy ` +
        `check was skipped to get the draft saved. No figure has been verified ` +
        `against the filings — check the numbers manually.`,
      findings: [],
    };
  } else if (evidenceCount > 0) {
    await setProgress(draftId, STAGES.checking);
    try {
      const checked = await checkReport(
        {
          moveDate,
          row,
          selection,
          doc: report.doc,
          todayDocuments,
          historyDocuments,
        },
        usage,
      );
      usage = checked.usage;
      accuracy = checked.review;

      if (accuracy.verdict === "revise" && elapsedMs() > REWRITE_DEADLINE_MS) {
        // Out of time for the rewrite, but the findings still reach the
        // reviewer — which is most of the value. Say so on the draft rather
        // than leaving `revised` unset and looking like a clean pass.
        accuracy = {
          ...accuracy,
          summary:
            `${accuracy.summary} (The automatic rewrite was skipped — the run ` +
            `had already used ${Math.round(elapsedMs() / 1000)} seconds. These ` +
            `findings are against the report as it stands.)`.trim(),
        };
      } else if (accuracy.verdict === "revise") {
        await setProgress(draftId, STAGES.revising);
        const rewritten = await writeReport(
          {
            moveDate,
            row,
            selection,
            analystName: analyst.name,
            todayDocuments,
            historyDocuments,
            corrections: { doc: report.doc, findings: accuracy.findings },
          },
          usage,
        );
        usage = rewritten.usage;
        report = rewritten.report;
        accuracy = { ...accuracy, revised: true };
      }
    } catch (error) {
      // A failed gate must not cost the day's report. The draft goes to review
      // unchecked, and the reviewer is told that is what happened rather than
      // being shown a clean bill of health that was never issued.
      console.warn(`accuracy gate failed for draft ${draftId}`, error);
      accuracy = {
        verdict: "pass",
        summary:
          "The accuracy check could not be completed, so no figure in this " +
          "draft has been verified against the filings. Check the numbers " +
          `manually. (${error instanceof Error ? error.message : "unknown error"})`,
        findings: [],
      };
    }
  }

  await setProgress(draftId, STAGES.rendering);
  const pdf = await renderReportPdf(report.doc);

  await setProgress(draftId, STAGES.uploading);
  const storagePath = await uploadDraftPdf(pdf, row.ticker, moveDate);

  await db
    .update(moverDrafts)
    .set({
      status: "pending",
      movePct: report.mover.movePct,
      moveType: report.mover.moveType,
      moveWindowLabel: report.mover.moveWindowLabel,
      catalystSlug: report.mover.catalystSlug,
      reasonForMove: report.mover.reasonForMove,
      mainTakeaway: report.mover.mainTakeaway,
      reportPrice: report.mover.reportPrice,
      sector: report.mover.sector,
      companyName: report.mover.companyName,
      report: { ...report.doc, citedIdsIds: report.citedIdsIds },
      accuracy,
      draftStoragePath: storagePath,
      model: draftModel(),
      inputTokens: usage.inputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      cacheReadTokens: usage.cacheReadTokens,
      outputTokens: usage.outputTokens,
      progress: null,
      error: null,
    })
    .where(eq(moverDrafts.id, draftId));

  return { ticker: row.ticker, moveDate };
}

/**
 * Creates the draft row and runs the pipeline.
 *
 * The caller decides whether to await this. The cron route hands it to `after`
 * so the HTTP response returns immediately, while the row it just created is
 * already visible in the review queue.
 */
/**
 * Runs the pipeline for a row that already exists, recording the outcome on it.
 *
 * This is what the background continuation calls: the Server Action inserts the
 * row so it can return an id immediately, then hands the slow part here via
 * `after`. All failure bookkeeping lives in one place so a crashed pipeline
 * always leaves a `failed` row carrying the reason, never a row stuck on
 * `generating` with nothing to explain it.
 */
export async function runDraftPipeline(
  draftId: number,
  moveDate: string,
  criteria: ScreenCriteria,
  options: { requireRequestedDate: boolean } = { requireRequestedDate: false },
): Promise<GenerateOutcome> {
  const db = getDb();

  try {
    const { ticker } = await runPipeline(draftId, moveDate, criteria, options);
    return { ok: true, draftId, ticker };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Draft generation failed.";
    console.error(`draft ${draftId} failed`, error);

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

export async function generateDraft(
  options: GenerateOptions,
): Promise<GenerateOutcome> {
  const db = getDb();
  const moveDate = options.moveDate ?? exchangeDate();
  const criteria = options.criteria ?? DEFAULT_SCREEN;

  let draftId: number;
  try {
    const [created] = await db
      .insert(moverDrafts)
      .values({
        status: "generating",
        moveDate,
        trigger: options.trigger,
        createdBy: options.actorEmail,
        progress: STAGES.screening,
      })
      .returning({ id: moverDrafts.id });
    draftId = created.id;
  } catch (error) {
    // The one expected failure is the partial unique index on scheduled drafts,
    // which is the cron's idempotency guard doing its job.
    const message =
      error instanceof Error && /mover_drafts_cron_day_key/.test(error.message)
        ? `A scheduled draft for ${moveDate} already exists.`
        : "Could not create the draft row.";
    console.error("generateDraft: insert failed", error);
    return { ok: false, draftId: null, reason: message };
  }

  return runDraftPipeline(draftId, moveDate, criteria, {
    // The scheduled run is drafting *today's* session by definition, so a
    // mismatch is a closed market rather than something to adopt.
    requireRequestedDate: options.trigger === "cron",
  });
}

/**
 * Clears a stale `generating` row.
 *
 * A serverless invocation that is killed mid-pipeline leaves a row that will
 * never advance, and — for a scheduled draft — the unique index then blocks
 * every later attempt for that day. Called before a scheduled run so a dead
 * invocation costs one day's draft rather than every subsequent one.
 */
export async function reapStaleGenerating(
  olderThanMinutes = 30,
): Promise<number> {
  const db = getDb();
  const reaped = await db
    .update(moverDrafts)
    .set({
      status: "failed",
      error: "Generation was interrupted and never completed.",
      progress: null,
    })
    .where(
      and(
        eq(moverDrafts.status, "generating"),
        sql`${moverDrafts.createdAt} < now() - make_interval(mins => ${olderThanMinutes})`,
      ),
    )
    .returning({ id: moverDrafts.id });

  return reaped.length;
}
