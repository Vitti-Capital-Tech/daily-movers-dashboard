"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { linkedinPosts } from "@/db/schema";
import { assessAndDraftPost } from "@/lib/ai/linkedin-post";
import { draftModel, ZERO_USAGE } from "@/lib/ai/client";
import {
  NotAuthenticatedError,
  NotAuthorisedError,
  requireAdmin,
  type SessionUser,
} from "@/lib/auth";
import { pctChange } from "@/lib/movers";
import { getMoverForPost } from "@/lib/posts/queries";
import { daysBetween, type PostSnapshot, type PostStatus } from "@/lib/posts/types";

/**
 * Server Actions for Post Studio.
 *
 * `requireAdmin()` at the top of each, for the reason already written down for
 * `saveMover`: a Server Action is a public HTTP endpoint, so hiding the tab is
 * not the control.
 */

export type PostActionState = {
  ok: boolean;
  message?: string;
  postId?: number;
} | null;

function authMessage(error: unknown): string | null {
  if (error instanceof NotAuthenticatedError) {
    return "Your session expired. Reload the page and unlock admin mode again.";
  }
  if (error instanceof NotAuthorisedError) {
    return "Only admins can draft posts.";
  }
  return null;
}

function revalidateStudio(): void {
  revalidatePath("/post-studio");
}

/**
 * Judges one published mover's outcome and, if the note's view held, drafts the
 * posts.
 *
 * Runs inline rather than in the background: one Claude call on a small prompt
 * takes seconds, unlike the drafting pipeline's twenty-five PDFs, so there is
 * nothing to poll and no state worth surviving a reload.
 */
export async function generatePostAction(
  _prev: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  let actor: SessionUser;
  try {
    actor = await requireAdmin();
  } catch (error) {
    const message = authMessage(error);
    if (message) return { ok: false, message };
    throw error;
  }

  const moverId = Number(formData.get("moverId"));
  if (!Number.isInteger(moverId) || moverId <= 0) {
    return { ok: false, message: "Invalid mover id." };
  }

  const mover = await getMoverForPost(moverId);
  if (!mover) return { ok: false, message: "That Daily Mover no longer exists." };

  const postEventReturn = pctChange(mover.anchorPrice, mover.currentPrice);

  if (
    mover.anchorPrice === null ||
    mover.currentPrice === null ||
    postEventReturn === null
  ) {
    return {
      ok: false,
      message:
        "No performance to write about yet — this mover has no publication price " +
        "or no current price. Refresh prices on the Daily Movers page first.",
    };
  }

  const snapshot: PostSnapshot = {
    anchorPrice: mover.anchorPrice,
    currentPrice: mover.currentPrice,
    postEventReturn,
    priceAsOf: mover.currentPriceAt?.toISOString() ?? null,
    daysSince: daysBetween(mover.moveDate),
  };

  let judgement: Awaited<ReturnType<typeof assessAndDraftPost>>;
  try {
    judgement = await assessAndDraftPost(
      {
        ticker: mover.ticker,
        companyName: mover.companyName,
        sector: mover.sector,
        moveDate: mover.moveDate,
        catalystLabel: mover.catalystLabel,
        movePct: mover.movePct,
        moveType: mover.moveType,
        moveWindowLabel: mover.moveWindowLabel,
        reasonForMove: mover.reasonForMove,
        mainTakeaway: mover.mainTakeaway,
        anchorPrice: snapshot.anchorPrice,
        currentPrice: snapshot.currentPrice,
        postEventReturn: snapshot.postEventReturn,
        priceAsOf: mover.currentPriceAt,
        daysSince: snapshot.daysSince,
      },
      ZERO_USAGE,
    );
  } catch (error) {
    console.error("assessAndDraftPost failed", error);
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not draft a post.",
    };
  }

  const { judgement: result, usage } = judgement;

  const db = getDb();
  try {
    const [created] = await db
      .insert(linkedinPosts)
      .values({
        moverId,
        status: "draft",
        verdict: result.verdict,
        verdictReason: result.verdictReason,
        evidenceQuote: result.evidenceQuote || null,
        posts: result.variants,
        snapshot,
        model: draftModel(),
        inputTokens: usage.inputTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        cacheReadTokens: usage.cacheReadTokens,
        outputTokens: usage.outputTokens,
        createdBy: actor.email,
      })
      .returning({ id: linkedinPosts.id });

    revalidateStudio();

    return {
      ok: true,
      postId: created.id,
      message:
        result.verdict === "validated"
          ? `${mover.ticker}: ${result.variants.length} draft${result.variants.length === 1 ? "" : "s"} ready.`
          : `${mover.ticker}: nothing to publish — see the assessment.`,
    };
  } catch (error) {
    console.error("generatePostAction: insert failed", error);
    return { ok: false, message: "Drafted the post but could not save it." };
  }
}

/**
 * Marks a post posted or discarded.
 *
 * `posted` is what stops the desk publishing about the same call twice — the
 * track-record table reads it back against each mover.
 */
export async function setPostStatusAction(
  _prev: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  try {
    await requireAdmin();
  } catch (error) {
    const message = authMessage(error);
    if (message) return { ok: false, message };
    throw error;
  }

  const postId = Number(formData.get("id"));
  const status = String(formData.get("status") ?? "");

  if (!Number.isInteger(postId) || postId <= 0) {
    return { ok: false, message: "Invalid post id." };
  }
  if (status !== "draft" && status !== "posted" && status !== "discarded") {
    return { ok: false, message: "Invalid status." };
  }

  const db = getDb();
  try {
    const updated = await db
      .update(linkedinPosts)
      .set({
        status: status as PostStatus,
        // Cleared when moving back to draft, so the timestamp never outlives
        // the claim that it was published.
        postedAt: status === "posted" ? new Date() : null,
      })
      .where(eq(linkedinPosts.id, postId))
      .returning({ id: linkedinPosts.id });

    if (updated.length === 0) {
      return { ok: false, message: "That post no longer exists." };
    }

    revalidateStudio();
    return {
      ok: true,
      postId,
      message:
        status === "posted"
          ? "Marked as posted."
          : status === "discarded"
            ? "Discarded."
            : "Moved back to draft.",
    };
  } catch (error) {
    console.error("setPostStatusAction failed", error);
    return { ok: false, message: "Could not update the post." };
  }
}
