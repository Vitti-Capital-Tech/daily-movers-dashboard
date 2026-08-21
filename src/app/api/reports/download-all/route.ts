import { NextResponse, type NextRequest } from "next/server";
import JSZip from "jszip";

import { getDb } from "@/db";
import { dailyMovers, companies } from "@/db/schema";
import { eq, or, isNotNull, desc, asc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { REPORTS_BUCKET } from "@/lib/storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Maximum execution time limit (30s) for batch downloads
export const maxDuration = 60;

const CONCURRENCY_LIMIT = 8;

async function runInPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.canWrite) {
    return new NextResponse("Forbidden: Admin access required", { status: 403 });
  }

  try {
    const db = getDb();
    const records = await db
      .select({
        id: dailyMovers.id,
        moveDate: dailyMovers.moveDate,
        reportStoragePath: dailyMovers.reportStoragePath,
        reportUrl: dailyMovers.reportUrl,
        ticker: companies.ticker,
        companyName: companies.name,
      })
      .from(dailyMovers)
      .innerJoin(companies, eq(dailyMovers.companyId, companies.id))
      .where(
        or(
          isNotNull(dailyMovers.reportStoragePath),
          isNotNull(dailyMovers.reportUrl),
        ),
      )
      .orderBy(desc(dailyMovers.moveDate), asc(companies.ticker));

    if (records.length === 0) {
      return new NextResponse("No reports found to download", { status: 404 });
    }

    const supabase = createSupabaseAdminClient();
    const zip = new JSZip();

    await runInPool(records, CONCURRENCY_LIMIT, async (mover) => {
      const dateStr =
        typeof mover.moveDate === "string"
          ? mover.moveDate
          : new Date(mover.moveDate).toISOString().slice(0, 10);

      const ticker = mover.ticker;
      const cleanName = mover.companyName
        .replace(/[^a-zA-Z0-9]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 35);

      const fileName = `${dateStr}_${ticker}_${cleanName}.pdf`;

      if (mover.reportStoragePath) {
        try {
          const { data, error } = await supabase.storage
            .from(REPORTS_BUCKET)
            .download(mover.reportStoragePath);

          if (!error && data) {
            const buffer = Buffer.from(await data.arrayBuffer());
            zip.file(fileName, buffer);
          }
        } catch (e) {
          console.error(`Failed to download report for ${ticker}:`, e);
        }
      } else if (mover.reportUrl) {
        try {
          const res = await fetch(mover.reportUrl, {
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            zip.file(fileName, buf);
          }
        } catch (e) {
          console.error(`Failed to fetch external report for ${ticker}:`, e);
        }
      }
    });

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const today = new Date().toISOString().slice(0, 10);
    const filename = `daily-movers-reports-${today}.zip`;

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": zipBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("Failed to generate zip archive:", error);
    return new NextResponse("Failed to generate zip archive", { status: 500 });
  }
}
