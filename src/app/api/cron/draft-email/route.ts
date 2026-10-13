import { after, type NextRequest } from "next/server";

import { isDbConfigured } from "@/db";
import { isAuthorisedCron } from "@/lib/cron-auth";
import {
  draftEmailConfig,
  draftsAwaitingEmail,
  emailDraft,
} from "@/lib/drafts/email";

/**
 * Emails scheduled drafts out via Resend: the PDF plus a ZIP of its sources.
 *
 * - `?id=<draftId>` is the hand-off from `/api/cron/daily-mover`, made the
 *   moment a scheduled draft lands.
 * - With no id it is the sweep: every recent pending scheduled draft that has
 *   not been emailed yet. pg_cron calls it once a day as the safety net for a
 *   hand-off that never arrived or a send that failed (`drizzle/cron-setup.sql`).
 *
 * Either way the reply is immediate and the work runs in `after()`, so the
 * caller — a draft invocation near its own time limit, or pg_net with a 30s
 * timeout — is never held open while sixty filings download from the ASX.
 *
 * Off unless `RESEND_API_KEY`, `DRAFT_EMAIL_FROM` and `DRAFT_EMAIL_TO` are all
 * set, so a deployment without them carries on drafting exactly as before.
 */

export const dynamic = "force-dynamic";

/** The platform ceiling, for the ASX downloads behind the sources ZIP. */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorisedCron(request)) {
    return Response.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }

  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: "DATABASE_URL is not set" }, { status: 503 });
  }

  const config = draftEmailConfig();
  if (!config) {
    return Response.json({
      ok: true,
      sent: false,
      skipped: "RESEND_API_KEY, DRAFT_EMAIL_FROM and DRAFT_EMAIL_TO are not all set",
    });
  }

  const rawId = request.nextUrl.searchParams.get("id");
  let draftIds: number[];
  if (rawId !== null) {
    const draftId = Number(rawId);
    if (!Number.isInteger(draftId) || draftId <= 0) {
      return Response.json({ ok: false, error: "bad id" }, { status: 400 });
    }
    draftIds = [draftId];
  } else {
    draftIds = await draftsAwaitingEmail();
  }

  if (draftIds.length === 0) {
    return Response.json({ ok: true, sent: false, skipped: "nothing to email" });
  }

  const origin = request.nextUrl.origin;

  after(async () => {
    // One at a time: each is dozens of ASX downloads, and there is rarely more
    // than one.
    for (const draftId of draftIds) {
      const outcome = await emailDraft(draftId, config, origin);
      if (outcome.ok) {
        console.log(
          `draft ${draftId} emailed (${outcome.messageId}, zip ${outcome.zipAttached ? "attached" : "linked"})`,
        );
      } else {
        console.error(`draft ${draftId} not emailed: ${outcome.reason}`);
      }
    }
  });

  return Response.json({ ok: true, queued: draftIds });
}
