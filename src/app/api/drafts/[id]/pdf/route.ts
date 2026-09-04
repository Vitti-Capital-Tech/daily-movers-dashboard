import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getDraftStoragePath } from "@/lib/drafts/queries";
import { REPORTS_BUCKET } from "@/lib/storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The only way to read a draft PDF.
 *
 * Same shape as `/api/reports/[id]` — private bucket, short-lived signed URL,
 * redirect — with one difference that matters: this one is **admin only**,
 * where the archive route admits any session. An unreviewed AI-written note is
 * not Vitti research yet, and it must not be readable, forwardable or
 * link-shareable by a viewer until an analyst has approved it.
 */

const SIGNED_URL_TTL_SECONDS = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user.canWrite) {
    return new NextResponse("Draft reports are visible to admins only", {
      status: 403,
    });
  }

  const { id } = await params;
  const draftId = Number(id);
  if (!Number.isInteger(draftId) || draftId <= 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  let path: string | null;
  try {
    path = await getDraftStoragePath(draftId);
  } catch (error) {
    console.error("draft lookup failed", error);
    return new NextResponse("Could not reach the database", { status: 503 });
  }

  if (!path) {
    // Either the draft has no PDF yet, or it was approved — in which case the
    // file now lives under the archive's key and belongs to a `daily_movers`
    // row, so the archive route is the one to ask.
    return new NextResponse(
      "No draft PDF for this record. If it was approved, open it from the archive.",
      { status: 404 },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.storage
      .from(REPORTS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      console.error("createSignedUrl failed for draft", error);
      return new NextResponse("Draft file is unavailable", { status: 502 });
    }

    return NextResponse.redirect(data.signedUrl);
  } catch (error) {
    console.error("draft signed url failed", error);
    return new NextResponse("Storage is not configured", { status: 503 });
  }
}
