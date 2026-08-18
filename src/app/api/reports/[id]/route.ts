import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db";
import { dailyMovers } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { REPORTS_BUCKET } from "@/lib/storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Signed download URLs are deliberately short-lived. */
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * The only way to read a report PDF.
 *
 * The bucket is private, so nothing is reachable by guessing a storage key. This
 * route checks the session first, then mints a signed URL valid for a minute and
 * redirects to it — so a URL copied out of the address bar or a browser history
 * stops working almost immediately.
 *
 * Falls back to `report_url` for movers whose report lives somewhere else.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    // A PDF request from an expired session should land on the login page, not
    // download an error document.
    return NextResponse.redirect(
      new URL("/login?error=expired", request.nextUrl.origin),
    );
  }

  const { id } = await params;
  const moverId = Number(id);
  if (!Number.isInteger(moverId) || moverId <= 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  let row:
    | { reportStoragePath: string | null; reportUrl: string | null }
    | undefined;

  try {
    const db = getDb();
    [row] = await db
      .select({
        reportStoragePath: dailyMovers.reportStoragePath,
        reportUrl: dailyMovers.reportUrl,
      })
      .from(dailyMovers)
      .where(eq(dailyMovers.id, moverId));
  } catch (error) {
    console.error("report lookup failed", error);
    return new NextResponse("Could not reach the database", { status: 503 });
  }

  if (!row) return new NextResponse("Not found", { status: 404 });

  // An uploaded file wins over an external link.
  if (row.reportStoragePath) {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.storage
        .from(REPORTS_BUCKET)
        .createSignedUrl(row.reportStoragePath, SIGNED_URL_TTL_SECONDS);

      if (error || !data?.signedUrl) {
        console.error("createSignedUrl failed", error);
        return new NextResponse("Report file is unavailable", { status: 502 });
      }
      return NextResponse.redirect(data.signedUrl);
    } catch (error) {
      console.error("signed url failed", error);
      return new NextResponse("Storage is not configured", { status: 503 });
    }
  }

  if (row.reportUrl) return NextResponse.redirect(row.reportUrl);

  return new NextResponse("No report attached to this Daily Mover", {
    status: 404,
  });
}
