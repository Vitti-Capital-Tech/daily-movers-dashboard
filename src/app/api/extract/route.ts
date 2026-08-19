import { NextRequest, NextResponse } from "next/server";
import { asc, eq, ilike } from "drizzle-orm";

import { getDb } from "@/db";
import { analysts, catalysts, companies } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { extractMoverFromPdfBuffer, type ExtractedMoverData } from "@/lib/ai/anthropic";
import { MAX_REPORT_BYTES, formatBytes } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user.canWrite) {
      return NextResponse.json(
        { ok: false, message: "Admin unlock required for automated PDF extraction." },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, message: "No PDF file was provided." },
        { status: 400 },
      );
    }

    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      return NextResponse.json(
        { ok: false, message: "Only PDF files can be extracted." },
        { status: 400 },
      );
    }

    if (file.size > MAX_REPORT_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          message: `File size (${formatBytes(file.size)}) exceeds the ${formatBytes(MAX_REPORT_BYTES)} limit.`,
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let extracted: ExtractedMoverData;
    try {
      extracted = await extractMoverFromPdfBuffer(buffer);
    } catch (extractErr) {
      console.error("AI PDF extraction failed:", extractErr);
      return NextResponse.json(
        {
          ok: false,
          message:
            extractErr instanceof Error
              ? extractErr.message
              : "Failed to extract metadata from PDF.",
        },
        { status: 422 },
      );
    }

    const db = getDb();

    // 1. Resolve or Auto-Create Company
    let companyId: number;
    let createdCompany: { id: number; ticker: string; name: string } | undefined;

    const [existingCompany] = await db
      .select({ id: companies.id, ticker: companies.ticker, name: companies.name })
      .from(companies)
      .where(ilike(companies.ticker, extracted.ticker));

    if (existingCompany) {
      companyId = existingCompany.id;
    } else {
      const [newCompany] = await db
        .insert(companies)
        .values({
          ticker: extracted.ticker,
          name: extracted.companyName,
          sector: extracted.sector,
        })
        .onConflictDoUpdate({
          target: companies.ticker,
          set: {
            name: extracted.companyName,
            ...(extracted.sector ? { sector: extracted.sector } : {}),
          },
        })
        .returning({ id: companies.id, ticker: companies.ticker, name: companies.name });

      companyId = newCompany.id;
      createdCompany = newCompany;
    }

    // 2. Resolve Catalyst
    let catalystId: number;
    const [matchedCatalyst] = await db
      .select({ id: catalysts.id })
      .from(catalysts)
      .where(eq(catalysts.slug, extracted.catalystSlug));

    if (matchedCatalyst) {
      catalystId = matchedCatalyst.id;
    } else {
      const [defaultCatalyst] = await db
        .select({ id: catalysts.id })
        .from(catalysts)
        .orderBy(asc(catalysts.sortOrder))
        .limit(1);
      catalystId = defaultCatalyst ? defaultCatalyst.id : 1;
    }

    // 3. Resolve or Auto-Create Analyst
    let analystId: number | null = null;
    let createdAnalyst: { id: number; name: string } | undefined;

    if (extracted.analystName) {
      const cleanAnalystName = extracted.analystName.trim();
      const [existingAnalyst] = await db
        .select({ id: analysts.id, name: analysts.name })
        .from(analysts)
        .where(ilike(analysts.name, cleanAnalystName));

      if (existingAnalyst) {
        analystId = existingAnalyst.id;
      } else {
        const [newAnalyst] = await db
          .insert(analysts)
          .values({
            name: cleanAnalystName,
            active: true,
          })
          .onConflictDoUpdate({
            target: analysts.name,
            set: { active: true },
          })
          .returning({ id: analysts.id, name: analysts.name });

        analystId = newAnalyst.id;
        createdAnalyst = newAnalyst;
      }
    }

    return NextResponse.json({
      ok: true,
      data: extracted,
      companyId,
      catalystId,
      analystId,
      createdCompany,
      createdAnalyst,
    });
  } catch (error) {
    console.error("API /api/extract unhandled error:", error);
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Internal server error during extraction.",
      },
      { status: 500 },
    );
  }
}
