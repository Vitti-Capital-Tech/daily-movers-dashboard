import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db";
import { moverDrafts } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  buildSourcesZip,
  readDraftSources,
  sourcesZipFilename,
} from "@/lib/drafts/sources-zip";

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

  const lists = readDraftSources(draft.sources, draft.report);

  if (lists.today.length === 0 && lists.history.length === 0) {
    return new NextResponse(
      "This draft has no recorded sources — it did not get past selection.",
      { status: 404 },
    );
  }

  const moveDate = String(draft.moveDate);
  const { bytes: body } = await buildSourcesZip({
    draftId,
    ticker: draft.ticker,
    moveDate,
    lists,
  });

  const filename = sourcesZipFilename(draft.ticker, moveDate);

  return new NextResponse(body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
