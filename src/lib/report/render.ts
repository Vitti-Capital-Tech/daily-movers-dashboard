import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";

import { DailyMoverReport } from "./template";
import { validateReportDoc, type ReportDoc } from "./types";

/**
 * Renders a report document to PDF bytes.
 *
 * Structure is validated first, so a malformed document fails here — with a
 * message naming what is wrong — rather than producing a plausible-looking PDF
 * that is missing its closing page. The pipeline treats that as a failed
 * generation, which is recoverable; a silently broken report reaching an
 * analyst's approve button is not.
 */
export async function renderReportPdf(doc: ReportDoc): Promise<Buffer> {
  const problems = validateReportDoc(doc);
  if (problems.length > 0) {
    throw new Error(`Report document is not renderable: ${problems.join("; ")}`);
  }

  const pdf = await renderToBuffer(DailyMoverReport({ doc }));
  await warnOnOverflow(pdf, doc);
  return pdf;
}

/**
 * Says so in the log when a page did not fit on its sheet.
 *
 * The length budget is meant to make this impossible, and for a week it looked
 * like it had: the SBM draft of 10 September 2026 rendered seven sheets from
 * five content pages, and nothing anywhere said why — the extra sheet carried
 * one line of caption and was simply there, in a document nobody counts the
 * pages of. This is the counter that would have caught it on the day.
 *
 * Deliberately a warning rather than a failure. An over-long report is
 * publishable and a reviewer can see it; refusing to render one would cost the
 * desk the day's draft over a layout defect.
 */
async function warnOnOverflow(pdf: Buffer, doc: ReportDoc): Promise<void> {
  const expected = doc.pages.length + 1;
  try {
    const { getDocumentProxy } = await import("unpdf");
    const rendered = (await getDocumentProxy(new Uint8Array(pdf))).numPages;
    if (rendered > expected) {
      console.warn(
        `draft ${doc.ticker}: ${doc.pages.length} content pages rendered ` +
          `${rendered} sheets, expected ${expected} — ${rendered - expected} page(s) ` +
          `overflowed. Check the longest page against REPORT_LIMITS.`,
      );
    }
  } catch (error) {
    // Counting the sheets is diagnostics; it must never cost the render.
    console.warn("could not count the rendered sheets", error);
  }
}

/**
 * `<TICKER>/<date>-daily-mover-<random>.pdf` under the drafts prefix.
 *
 * A separate prefix from approved reports on purpose: the bucket then shows at a
 * glance what has been published and what is still awaiting review, and an
 * `approve` is a storage move into the normal key scheme rather than a
 * re-upload. Nothing downstream — `/api/reports/[id]`, the ZIP export, the
 * download script — needs to know the file was ever a draft.
 */
export function buildDraftPath(input: {
  ticker: string;
  moveDate: string;
  random: string;
}): string {
  const ticker =
    input.ticker.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "UNKNOWN";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.moveDate)
    ? input.moveDate
    : "undated";
  return `drafts/${ticker}/${date}-daily-mover-${input.random}.pdf`;
}

/** The filename an approved draft lands under, fed to `buildReportPath`. */
export function draftFileName(ticker: string, moveDate: string): string {
  return `${moveDate} Daily Mover ${ticker.toUpperCase()}.pdf`;
}
