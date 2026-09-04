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

  return renderToBuffer(DailyMoverReport({ doc }));
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
