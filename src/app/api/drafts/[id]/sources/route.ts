import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db";
import { moverDrafts } from "@/db/schema";
import { asxData, AnnouncementUnavailableError } from "@/lib/asx";
import { getSessionUser } from "@/lib/auth";

/**
 * Every announcement a draft was written from, as one ZIP.
 *
 * The review card already lists them and links each one out to the ASX, which
 * is enough to check a single figure and useless for the thing an analyst
 * actually does: read the corpus the report was built on. Twenty tabs, twenty
 * interstitials, twenty downloads named `displayAnnouncement.pdf`. This is the
 * same audit trail as a file.
 *
 * Files are fetched from the ASX rather than from storage because the pipeline
 * never keeps them: it extracts each PDF to text, sends that, and throws the
 * bytes away — `mover_drafts.sources` holds the *list*, which is what makes
 * this route possible and why it has to re-download.
 *
 * Admin only, for the same reason as the draft PDF route: an unreviewed draft
 * and its evidence are not Vitti research yet.
 */

export const dynamic = "force-dynamic";

/**
 * 300 seconds, the platform ceiling. Twenty PDFs at four at a time is usually
 * well under a minute, but the ASX is a public site being asked for a hundred
 * megabytes and it is not always quick.
 */
export const maxDuration = 300;

/** Polite against a public site, and enough to not be download-bound. */
const CONCURRENCY = 4;

type SourceEntry = {
  idsId: string;
  headline: string;
  date: string;
  pageCount?: number | null;
  sourceUrl?: string;
  isPriceSensitive?: boolean;
};

/** A filename that survives Windows, macOS and a ZIP listing. */
function safeName(entry: SourceEntry): string {
  const headline = entry.headline
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return `${entry.date} ${headline} [${entry.idsId}].pdf`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user?.canWrite) {
    return new NextResponse("Draft sources are visible to admins only", {
      status: 403,
    });
  }

  const { id } = await params;
  const draftId = Number(id);
  if (!Number.isInteger(draftId) || draftId <= 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  const [draft] = await getDb()
    .select({
      ticker: moverDrafts.ticker,
      moveDate: moverDrafts.moveDate,
      sources: moverDrafts.sources,
      report: moverDrafts.report,
    })
    .from(moverDrafts)
    .where(eq(moverDrafts.id, draftId))
    .limit(1);

  if (!draft) return new NextResponse("Not found", { status: 404 });

  const sources = (draft.sources ?? {}) as {
    today?: SourceEntry[];
    history?: SourceEntry[];
  };
  const today = sources.today ?? [];
  const history = sources.history ?? [];

  if (today.length === 0 && history.length === 0) {
    return new NextResponse(
      "This draft has no recorded sources — it did not get past selection.",
      { status: 404 },
    );
  }

  const cited = new Set(
    ((draft.report as { citedIdsIds?: string[] } | null)?.citedIdsIds ?? []).map(
      String,
    ),
  );

  const zip = new JSZip();
  const queue = [
    ...today.map((entry) => ({ entry, folder: "today" })),
    ...history.map((entry) => ({ entry, folder: "history" })),
  ];

  /**
   * What could not be fetched is recorded rather than dropped.
   *
   * Withdrawn documents and the occasional ASX 500 are normal, and a zip that
   * is quietly missing two files is worse than one that says which two: the
   * whole point of this download is that it is the complete record.
   */
  const failures: string[] = [];

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (cursor < queue.length) {
        const { entry, folder } = queue[cursor++];
        try {
          const bytes = await asxData.fetchAnnouncementPdf(entry.idsId);
          zip.file(`${folder}/${safeName(entry)}`, bytes);
        } catch (error) {
          const reason =
            error instanceof AnnouncementUnavailableError
              ? error.message
              : error instanceof Error
                ? error.message
                : "unknown error";
          failures.push(`${entry.idsId} ${entry.headline} — ${reason}`);
        }
      }
    }),
  );

  const manifest = [
    `Daily Mover draft ${draftId} — ${draft.ticker} ${String(draft.moveDate).slice(0, 10)}`,
    "",
    "Every announcement this report was written from. A * marks one the report",
    "actually drew a figure or a fact from; the rest were read for context.",
    "",
    "TODAY (the filings that explain the move)",
    ...today.map(
      (entry) =>
        `  ${cited.has(String(entry.idsId)) ? "*" : " "} ${entry.date}  ${entry.headline}` +
        `${entry.pageCount ? ` (${entry.pageCount}pp)` : ""}\n      ${entry.sourceUrl ?? ""}`,
    ),
    "",
    "HISTORY (the company's earlier filings and accounts)",
    ...history.map(
      (entry) =>
        `  ${cited.has(String(entry.idsId)) ? "*" : " "} ${entry.date}  ${entry.headline}` +
        `${entry.pageCount ? ` (${entry.pageCount}pp)` : ""}\n      ${entry.sourceUrl ?? ""}`,
    ),
    ...(failures.length > 0
      ? ["", "COULD NOT BE DOWNLOADED", ...failures.map((line) => `  - ${line}`)]
      : []),
    "",
  ].join("\n");

  zip.file("sources.txt", manifest);

  const body = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const filename = `${draft.ticker ?? "draft"}-${String(draft.moveDate).slice(0, 10)}-sources.zip`;

  return new NextResponse(body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
