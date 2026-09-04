"use server";

import { asc, eq, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { getDb } from "@/db";
import { catalysts, companies, dailyMovers, moverDrafts } from "@/db/schema";
import {
  NotAuthenticatedError,
  NotAuthorisedError,
  requireAdmin,
  type SessionUser,
} from "@/lib/auth";
import { DEFAULT_SCREEN, type ScreenCriteria } from "@/lib/asx";
import { SCREEN_LIMITS } from "@/lib/asx/types";
import {
  generateDraft,
  reapStaleGenerating,
  runDraftPipeline,
} from "@/lib/drafts/generate";
import { getDraftStoragePath } from "@/lib/drafts/queries";
import { exchangeDate } from "@/lib/drafts/trading-day";
import { buildReportPath, REPORTS_BUCKET } from "@/lib/storage";
import { draftFileName } from "@/lib/report/render";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Server Actions for the Mover Studio.
 *
 * Every one of them opens with `requireAdmin()`. The Studio tab is hidden from
 * viewers and its page redirects them away, but neither is a permission check —
 * a Server Action is a public HTTP endpoint that anyone can call directly, which
 * is the same reasoning already written down for `saveMover`.
 */

export type DraftActionState = {
  ok: boolean;
  message?: string;
  draftId?: number;
} | null;

/** Turns an auth failure into a message instead of a stack trace. */
function authMessage(error: unknown): string | null {
  if (error instanceof NotAuthenticatedError) {
    return "Your session expired. Reload the page and unlock admin mode again.";
  }
  if (error instanceof NotAuthorisedError) {
    return "Only admins can draft or approve Daily Movers.";
  }
  return null;
}

function revalidateStudio(): void {
  revalidatePath("/mover-studio");
}

async function revalidateArchive(companyId: number): Promise<void> {
  revalidatePath("/daily-movers");
  revalidatePath("/companies");

  const db = getDb();
  const [company] = await db
    .select({ ticker: companies.ticker })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (company) revalidatePath(`/companies/${company.ticker}`);
}

/** Clamps a numeric form field into the range the UI advertises. */
function readCriterion(
  formData: FormData,
  field: keyof ScreenCriteria,
): number {
  const limits = SCREEN_LIMITS[field];
  const raw = Number(formData.get(field));
  if (!Number.isFinite(raw)) return DEFAULT_SCREEN[field];
  return Math.min(Math.max(raw, limits.min), limits.max);
}

/**
 * Starts a manual draft and returns as soon as the row exists.
 *
 * The pipeline itself is handed to `after`, so the action doesn't hold the
 * request open for the several minutes it takes to read twenty-five filings.
 * The client polls the row it gets back — which also means a reload mid-run
 * rejoins the same draft instead of starting a second one.
 */
export async function startDraftAction(
  _prev: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  let actor: SessionUser;
  try {
    actor = await requireAdmin();
  } catch (error) {
    const message = authMessage(error);
    if (message) return { ok: false, message };
    throw error;
  }

  const criteria: ScreenCriteria = {
    minTurnover: readCriterion(formData, "minTurnover"),
    minMarketCap: readCriterion(formData, "minMarketCap"),
    minAbsChangePct: readCriterion(formData, "minAbsChangePct"),
    perSide: readCriterion(formData, "perSide"),
  };

  const rawDate = formData.get("moveDate");
  const moveDate =
    typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : exchangeDate();

  /**
   * `generateDraft` inserts the row and then runs the pipeline, so it cannot be
   * awaited here without waiting for the whole thing. Running it entirely in
   * `after` means the action returns before the row's id is known — hence the
   * two-step: create the row inline, run the rest in the background.
   */
  const db = getDb();
  let draftId: number;
  try {
    const [created] = await db
      .insert(moverDrafts)
      .values({
        status: "generating",
        moveDate,
        trigger: "manual",
        createdBy: actor.email,
        progress: "Queued",
      })
      .returning({ id: moverDrafts.id });
    draftId = created.id;
  } catch (error) {
    console.error("startDraftAction: insert failed", error);
    return { ok: false, message: "Could not start the draft. Check the logs." };
  }

  after(async () => {
    // The row already exists, so the pipeline runs against it rather than
    // creating another. `runDraftPipeline` handles its own failure bookkeeping.
    await runDraftPipeline(draftId, moveDate, criteria);
  });

  revalidateStudio();
  return {
    ok: true,
    draftId,
    message: `Drafting started. This usually takes a few minutes.`,
  };
}

/**
 * Approves a draft: projects it into `daily_movers` and moves its PDF into the
 * archive's own key scheme.
 *
 * The storage move rather than a re-upload is what keeps everything downstream
 * ignorant of drafts — `/api/reports/[id]`, the ZIP export and the CLI
 * download script all keep working with no change, because an approved draft's
 * file is indistinguishable from a manually uploaded one.
 */
export async function approveDraftAction(
  _prev: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  let actor: SessionUser;
  try {
    actor = await requireAdmin();
  } catch (error) {
    const message = authMessage(error);
    if (message) return { ok: false, message };
    throw error;
  }

  const draftId = Number(formData.get("id"));
  if (!Number.isInteger(draftId) || draftId <= 0) {
    return { ok: false, message: "Invalid draft id." };
  }

  const db = getDb();

  const [draft] = await db
    .select()
    .from(moverDrafts)
    .where(eq(moverDrafts.id, draftId));

  if (!draft) return { ok: false, message: "That draft no longer exists." };
  if (draft.status === "approved") {
    return { ok: false, message: "That draft has already been approved." };
  }
  if (draft.status !== "pending" && draft.status !== "rejected") {
    return {
      ok: false,
      message: `A ${draft.status} draft can't be approved.`,
    };
  }

  /**
   * The reviewer's edits win over the model's output. An analyst who spots a
   * wrong percentage or a weak takeaway should be able to fix it and approve,
   * rather than reject and hope the next run gets it right — so the form posts
   * the current field values and they are what gets filed.
   */
  const edited = {
    movePct: Number(formData.get("movePct")),
    reasonForMove: String(formData.get("reasonForMove") ?? "").trim(),
    mainTakeaway: String(formData.get("mainTakeaway") ?? "").trim(),
    catalystSlug: String(formData.get("catalystSlug") ?? "").trim(),
    moveType: formData.get("moveType") === "closing" ? "closing" : "intraday",
    moveWindowLabel:
      String(formData.get("moveWindowLabel") ?? "").trim() || null,
  } as const;

  const movePct = Number.isFinite(edited.movePct)
    ? edited.movePct
    : draft.movePct;

  if (!draft.ticker || movePct === null || movePct === 0) {
    return {
      ok: false,
      message: "This draft is missing a ticker or a share-price move.",
    };
  }
  if (!edited.reasonForMove || !edited.mainTakeaway) {
    return {
      ok: false,
      message: "Reason for move and main takeaway are both required.",
    };
  }

  try {
    // 1. Resolve or create the company. Same logic as PDF extraction, and the
    //    reason the draft table holds a ticker string rather than an FK: a
    //    rejected draft must not leave a stub in the company directory.
    let companyId: number;
    const [existing] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(ilike(companies.ticker, draft.ticker));

    if (existing) {
      companyId = existing.id;
    } else {
      const [created] = await db
        .insert(companies)
        .values({
          ticker: draft.ticker,
          name: draft.companyName ?? draft.ticker,
          sector: draft.sector,
        })
        .onConflictDoUpdate({
          target: companies.ticker,
          set: {
            name: draft.companyName ?? draft.ticker,
            ...(draft.sector ? { sector: draft.sector } : {}),
          },
        })
        .returning({ id: companies.id });
      companyId = created.id;
    }

    // 2. Catalyst by slug, falling back to the first in sort order.
    const [catalyst] = await db
      .select({ id: catalysts.id })
      .from(catalysts)
      .where(eq(catalysts.slug, edited.catalystSlug || draft.catalystSlug || "other"));

    let catalystId = catalyst?.id;
    if (!catalystId) {
      const [fallback] = await db
        .select({ id: catalysts.id })
        .from(catalysts)
        .orderBy(asc(catalysts.sortOrder))
        .limit(1);
      catalystId = fallback?.id;
    }
    if (!catalystId) {
      return {
        ok: false,
        message: "No catalysts exist yet. Run: npm run db:seed",
      };
    }

    // 3. Move the PDF into the archive's key scheme.
    let reportStoragePath: string | null = null;
    const draftPath = await getDraftStoragePath(draftId);

    if (draftPath) {
      const targetPath = buildReportPath({
        ticker: draft.ticker,
        moveDate: draft.moveDate,
        fileName: draftFileName(draft.ticker, draft.moveDate),
        random: crypto.randomUUID().slice(0, 8),
      });

      const supabase = createSupabaseAdminClient();
      const { error } = await supabase.storage
        .from(REPORTS_BUCKET)
        .move(draftPath, targetPath);

      if (error) {
        console.error("draft PDF move failed", error);
        return {
          ok: false,
          message: `Could not move the draft PDF into the archive: ${error.message}`,
        };
      }
      reportStoragePath = targetPath;
    }

    // 4. File it.
    const [mover] = await db
      .insert(dailyMovers)
      .values({
        companyId,
        catalystId,
        analystId: draft.analystId,
        moveDate: draft.moveDate,
        movePct,
        moveType: edited.moveType,
        moveWindowLabel: edited.moveWindowLabel ?? draft.moveWindowLabel,
        reasonForMove: edited.reasonForMove,
        mainTakeaway: edited.mainTakeaway,
        reportPrice: draft.reportPrice,
        reportStoragePath,
        /**
         * The generated document and its audit trail, kept next to the saved
         * row for the same reason PDF extraction keeps its raw output: an
         * improved prompt can be re-run over the archive later and diffed
         * against what was actually published.
         */
        extraction: {
          source: "mover-studio",
          draftId,
          model: draft.model,
          selection: draft.selection,
          sources: draft.sources,
          report: draft.report,
        },
        createdBy: actor.email,
      })
      .returning({ id: dailyMovers.id });

    await db
      .update(moverDrafts)
      .set({
        status: "approved",
        companyId,
        movePct,
        moveType: edited.moveType,
        moveWindowLabel: edited.moveWindowLabel ?? draft.moveWindowLabel,
        catalystSlug: edited.catalystSlug || draft.catalystSlug,
        reasonForMove: edited.reasonForMove,
        mainTakeaway: edited.mainTakeaway,
        // Cleared because the file now lives under the archive's key.
        draftStoragePath: null,
        approvedMoverId: mover.id,
        reviewedBy: actor.email,
        reviewedAt: new Date(),
      })
      .where(eq(moverDrafts.id, draftId));

    await revalidateArchive(companyId);
    revalidateStudio();

    return {
      ok: true,
      draftId,
      message: `${draft.ticker} published to the archive.`,
    };
  } catch (error) {
    console.error("approveDraftAction failed", error);
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Could not approve: ${error.message}`
          : "Could not approve the draft. Check the logs.",
    };
  }
}

/**
 * Rejects a draft, with the reason recorded.
 *
 * The PDF is deliberately left in the `drafts/` prefix rather than deleted: a
 * rejection is the most useful evidence there is about where the pipeline goes
 * wrong, and being able to open the note that was rejected is the whole point of
 * keeping the note.
 */
export async function rejectDraftAction(
  _prev: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  let actor: SessionUser;
  try {
    actor = await requireAdmin();
  } catch (error) {
    const message = authMessage(error);
    if (message) return { ok: false, message };
    throw error;
  }

  const draftId = Number(formData.get("id"));
  if (!Number.isInteger(draftId) || draftId <= 0) {
    return { ok: false, message: "Invalid draft id." };
  }

  const note = String(formData.get("reviewNote") ?? "").trim();

  const db = getDb();
  try {
    const updated = await db
      .update(moverDrafts)
      .set({
        status: "rejected",
        reviewedBy: actor.email,
        reviewedAt: new Date(),
        reviewNote: note || null,
      })
      .where(eq(moverDrafts.id, draftId))
      .returning({ id: moverDrafts.id });

    if (updated.length === 0) {
      return { ok: false, message: "That draft no longer exists." };
    }

    revalidateStudio();
    return { ok: true, draftId, message: "Draft rejected." };
  } catch (error) {
    console.error("rejectDraftAction failed", error);
    return { ok: false, message: "Could not reject the draft. Check the logs." };
  }
}

/** Clears interrupted `generating` rows so a dead invocation isn't permanent. */
export async function reapDraftsAction(): Promise<DraftActionState> {
  try {
    await requireAdmin();
  } catch (error) {
    const message = authMessage(error);
    if (message) return { ok: false, message };
    throw error;
  }

  const reaped = await reapStaleGenerating();
  revalidateStudio();
  return {
    ok: true,
    message:
      reaped === 0
        ? "No interrupted drafts to clear."
        : `Cleared ${reaped} interrupted draft${reaped === 1 ? "" : "s"}.`,
  };
}

/** Re-exported so the cron route has one import for the whole feature. */
export { generateDraft };
