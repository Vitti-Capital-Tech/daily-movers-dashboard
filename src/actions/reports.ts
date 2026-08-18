"use server";

import { requireAdmin } from "@/lib/auth";
import {
  buildReportPath,
  MAX_REPORT_BYTES,
  REPORTS_BUCKET,
  formatBytes,
} from "@/lib/storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type UploadTicket =
  | { ok: true; path: string; token: string }
  | { ok: false; message: string };

/**
 * Issues a one-shot signed upload URL so the browser can PUT the PDF straight to
 * Supabase Storage.
 *
 * The file deliberately does NOT travel through this Server Action: Vercel caps
 * request bodies at 4.5 MB and Next caps Server Action bodies at 1 MB by
 * default, so a routine 5 MB report would work locally and fail in production.
 * Going direct also keeps a multi-MB upload off the serverless function's clock.
 *
 * The storage key is built server-side from the sanitised filename — the client
 * never chooses where its file lands.
 */
export async function createReportUploadUrl(input: {
  fileName: string;
  fileSize: number;
  fileType: string;
  ticker: string;
  moveDate: string;
}): Promise<UploadTicket> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, message: "Only admins can upload reports." };
  }

  if (!/\.pdf$/i.test(input.fileName) && input.fileType !== "application/pdf") {
    return { ok: false, message: "Only PDF files are accepted." };
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, message: "That file looks empty." };
  }
  if (input.fileSize > MAX_REPORT_BYTES) {
    return {
      ok: false,
      message: `That file is ${formatBytes(input.fileSize)}. The limit is ${formatBytes(MAX_REPORT_BYTES)}.`,
    };
  }

  const path = buildReportPath({
    ticker: input.ticker,
    moveDate: input.moveDate,
    fileName: input.fileName,
    random: crypto.randomUUID().slice(0, 8),
  });

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.storage
      .from(REPORTS_BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data?.token) {
      console.error("createSignedUploadUrl failed", error);
      const missingBucket = /bucket/i.test(error?.message ?? "");
      return {
        ok: false,
        message: missingBucket
          ? `Storage bucket "${REPORTS_BUCKET}" doesn't exist. Run: npm run storage:setup`
          : "Could not start the upload. Check the server logs.",
      };
    }

    return { ok: true, path: data.path, token: data.token };
  } catch (error) {
    console.error("createReportUploadUrl failed", error);
    return {
      ok: false,
      message:
        error instanceof Error && error.message.includes("SERVICE_ROLE")
          ? error.message
          : "Could not start the upload. Check the server logs.",
    };
  }
}
