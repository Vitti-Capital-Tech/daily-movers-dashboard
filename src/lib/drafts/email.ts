import "server-only";

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { moverDrafts } from "@/db/schema";
import { sendEmail, type EmailAttachment } from "@/lib/email/resend";
import { formatMoveDate, formatPct } from "@/lib/format";
import { REPORTS_BUCKET } from "@/lib/storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import {
  buildSourcesZip,
  readDraftSources,
  sourcesZipFilename,
  type DraftSourceLists,
  type SourceEntry,
} from "./sources-zip";

/**
 * Emails a finished scheduled draft — its PDF and a ZIP of every filing it was
 * written from — to the addresses in `DRAFT_EMAIL_TO`.
 *
 * Two callers: the cron draft route hands off here as soon as a draft lands,
 * and a pg_cron sweep (`drizzle/cron-setup.sql`) picks up anything that hand-off
 * missed. `emailed_at` is the claim that keeps them from both sending.
 *
 * Scheduled drafts only. A manual draft was started by an analyst sitting at
 * the Studio, who does not need it mailed to them.
 */

/**
 * Resend caps a whole message at 40MB *after* base64, which inflates by a
 * third. 20MB of ZIP leaves room for that and for the report PDF; a bigger
 * corpus goes out as links instead, which the body always carries anyway.
 */
const MAX_ZIP_BYTES = 20 * 1024 * 1024;

/** How far back the sweep looks, so a long outage does not mail out last week. */
const SWEEP_LOOKBACK_DAYS = 2;

export type EmailConfig = { from: string; to: string[] };

/** Null when any of the three variables is missing — the feature is then off. */
export function draftEmailConfig(): EmailConfig | null {
  const from = process.env.DRAFT_EMAIL_FROM?.trim();
  const to = (process.env.DRAFT_EMAIL_TO ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);

  if (!process.env.RESEND_API_KEY?.trim() || !from || to.length === 0) {
    return null;
  }
  return { from, to };
}

export type EmailOutcome =
  | { ok: true; draftId: number; messageId: string; zipAttached: boolean }
  | { ok: false; draftId: number; reason: string };

/** Scheduled drafts still waiting for their email, oldest first. */
export async function draftsAwaitingEmail(): Promise<number[]> {
  const rows = await getDb()
    .select({ id: moverDrafts.id })
    .from(moverDrafts)
    .where(
      and(
        eq(moverDrafts.trigger, "cron"),
        eq(moverDrafts.status, "pending"),
        isNull(moverDrafts.emailedAt),
        isNotNull(moverDrafts.draftStoragePath),
        sql`${moverDrafts.createdAt} > now() - make_interval(days => ${SWEEP_LOOKBACK_DAYS})`,
      ),
    )
    .orderBy(moverDrafts.createdAt);

  return rows.map((row) => row.id);
}

export async function emailDraft(
  draftId: number,
  config: EmailConfig,
  appOrigin: string,
): Promise<EmailOutcome> {
  const db = getDb();

  /**
   * Claim first, in one statement: whoever flips `emailed_at` from null owns
   * the send. A draft that was approved or rejected in the meantime no longer
   * matches, and nor does a manual one.
   */
  const [draft] = await db
    .update(moverDrafts)
    .set({ emailedAt: sql`now()`, emailError: null })
    .where(
      and(
        eq(moverDrafts.id, draftId),
        eq(moverDrafts.trigger, "cron"),
        eq(moverDrafts.status, "pending"),
        isNull(moverDrafts.emailedAt),
        isNotNull(moverDrafts.draftStoragePath),
      ),
    )
    .returning({
      ticker: moverDrafts.ticker,
      companyName: moverDrafts.companyName,
      moveDate: moverDrafts.moveDate,
      movePct: moverDrafts.movePct,
      moveWindowLabel: moverDrafts.moveWindowLabel,
      reasonForMove: moverDrafts.reasonForMove,
      mainTakeaway: moverDrafts.mainTakeaway,
      sources: moverDrafts.sources,
      report: moverDrafts.report,
      draftStoragePath: moverDrafts.draftStoragePath,
    });

  if (!draft) {
    return {
      ok: false,
      draftId,
      reason: "not a pending scheduled draft, or already emailed",
    };
  }

  try {
    const moveDate = String(draft.moveDate);
    const lists = readDraftSources(draft.sources, draft.report);

    const pdf = await downloadDraftPdf(draft.draftStoragePath!);
    const attachments: EmailAttachment[] = [
      { filename: `${draft.ticker ?? "draft"}-${moveDate}-draft.pdf`, content: pdf },
    ];

    let zipNote: string | null = null;
    if (lists.today.length + lists.history.length > 0) {
      const zip = await buildSourcesZip({
        draftId,
        ticker: draft.ticker,
        moveDate,
        lists,
      });
      if (zip.bytes.byteLength <= MAX_ZIP_BYTES) {
        attachments.push({
          filename: sourcesZipFilename(draft.ticker, moveDate),
          content: zip.bytes,
        });
        if (zip.failures.length > 0) {
          zipNote = `${zip.failures.length} filing(s) could not be downloaded; see sources.txt in the ZIP.`;
        }
      } else {
        zipNote = `The source filings came to ${(zip.bytes.byteLength / 1024 / 1024).toFixed(1)} MB, too large to attach; use the links below.`;
      }
    }

    const message = composeEmail({
      draftId,
      ticker: draft.ticker,
      companyName: draft.companyName,
      moveDate,
      movePct: draft.movePct,
      moveWindowLabel: draft.moveWindowLabel,
      reasonForMove: draft.reasonForMove,
      mainTakeaway: draft.mainTakeaway,
      lists,
      zipAttached: attachments.length > 1,
      zipNote,
      studioUrl: `${appOrigin}/mover-studio`,
    });

    const messageId = await sendEmail({
      from: config.from,
      to: config.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments,
    });

    return {
      ok: true,
      draftId,
      messageId,
      zipAttached: attachments.length > 1,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Sending the draft email failed.";
    console.error(`draft ${draftId} email failed`, error);

    // Release the claim so the next sweep tries again, and say why.
    try {
      await db
        .update(moverDrafts)
        .set({ emailedAt: null, emailError: reason })
        .where(eq(moverDrafts.id, draftId));
    } catch (updateError) {
      console.error(`could not record email failure for ${draftId}`, updateError);
    }

    return { ok: false, draftId, reason };
  }
}

async function downloadDraftPdf(path: string): Promise<Uint8Array> {
  const { data, error } = await createSupabaseAdminClient()
    .storage.from(REPORTS_BUCKET)
    .download(path);

  if (error || !data) {
    throw new Error(`Could not download the draft PDF: ${error?.message ?? "no data"}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function composeEmail(input: {
  draftId: number;
  ticker: string | null;
  companyName: string | null;
  moveDate: string;
  movePct: number | null;
  moveWindowLabel: string | null;
  reasonForMove: string | null;
  mainTakeaway: string | null;
  lists: DraftSourceLists;
  zipAttached: boolean;
  zipNote: string | null;
  studioUrl: string;
}): { subject: string; html: string; text: string } {
  const ticker = input.ticker ?? "—";
  const move = input.movePct === null ? "" : ` ${formatPct(input.movePct)}`;
  const date = formatMoveDate(input.moveDate);
  const subject = `Daily Mover draft: ${ticker}${move} (${date})`;

  const company = input.companyName ? `${input.companyName} (ASX:${ticker})` : ticker;
  const moveLine = `${move.trim() || "—"}${input.moveWindowLabel ? ` — ${input.moveWindowLabel}` : ""}`;
  const { today, history, cited } = input.lists;
  const attached = input.zipAttached
    ? "Attached: the draft PDF and a ZIP of the source filings."
    : "Attached: the draft PDF.";

  const textList = (entries: SourceEntry[]) =>
    entries.map(
      (entry) =>
        `  ${cited.has(String(entry.idsId)) ? "*" : "-"} ${entry.date}  ${entry.headline}` +
        (entry.sourceUrl ? `\n    ${entry.sourceUrl}` : ""),
    );

  const text = [
    `Today's scheduled Daily Mover draft is ready for review. It is unreviewed and not for distribution.`,
    "",
    `Company: ${company}`,
    `Move: ${moveLine}`,
    `Date: ${date}`,
    "",
    ...(input.reasonForMove ? ["Reason for move:", input.reasonForMove, ""] : []),
    ...(input.mainTakeaway ? ["Main takeaway:", input.mainTakeaway, ""] : []),
    `Review it in Mover Studio: ${input.studioUrl}`,
    "",
    attached,
    ...(input.zipNote ? [input.zipNote] : []),
    "",
    "Sources (* = cited in the report)",
    "Today:",
    ...textList(today),
    "History:",
    ...textList(history),
    "",
    `Draft #${input.draftId}`,
  ].join("\n");

  const htmlList = (entries: SourceEntry[]) =>
    entries.length === 0
      ? "<p style=\"margin:4px 0;color:#666\">None</p>"
      : `<ul style="margin:4px 0;padding-left:20px">${entries
          .map((entry) => {
            const headline = escapeHtml(entry.headline);
            const linked = entry.sourceUrl
              ? `<a href="${escapeHtml(entry.sourceUrl)}">${headline}</a>`
              : headline;
            const mark = cited.has(String(entry.idsId)) ? " <strong>*</strong>" : "";
            return `<li>${escapeHtml(entry.date)} — ${linked}${mark}</li>`;
          })
          .join("")}</ul>`;

  const paragraph = (label: string, value: string | null) =>
    value
      ? `<p style="margin:12px 0 4px"><strong>${label}</strong></p><p style="margin:0">${escapeHtml(value)}</p>`
      : "";

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;max-width:640px">
<p>Today's scheduled Daily Mover draft is ready for review. <em>It is unreviewed and not for distribution.</em></p>
<table style="border-collapse:collapse">
<tr><td style="padding:2px 12px 2px 0;color:#666">Company</td><td>${escapeHtml(company)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Move</td><td>${escapeHtml(moveLine)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Date</td><td>${escapeHtml(date)}</td></tr>
</table>
${paragraph("Reason for move", input.reasonForMove)}
${paragraph("Main takeaway", input.mainTakeaway)}
<p style="margin:16px 0"><a href="${escapeHtml(input.studioUrl)}">Review it in Mover Studio</a></p>
<p style="margin:0">${attached}</p>
${input.zipNote ? `<p style="margin:4px 0;color:#a15c00">${escapeHtml(input.zipNote)}</p>` : ""}
<p style="margin:16px 0 4px"><strong>Sources</strong> (* = cited in the report)</p>
<p style="margin:8px 0 0">Today</p>
${htmlList(today)}
<p style="margin:8px 0 0">History</p>
${htmlList(history)}
<p style="margin-top:16px;color:#888;font-size:12px">Draft #${input.draftId}</p>
</div>`;

  return { subject, html, text };
}
