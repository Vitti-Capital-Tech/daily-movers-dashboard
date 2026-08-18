"use server";

import { asc, eq, ilike } from "drizzle-orm";
import { getDb } from "@/db";
import { analysts, catalysts, companies } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { extractMoverFromPdfBuffer, type ExtractedMoverData } from "@/lib/ai/anthropic";
import { MAX_REPORT_BYTES, formatBytes } from "@/lib/storage";

export type ExtractionResponse =
  | {
      ok: true;
      data: ExtractedMoverData;
      companyId: number;
      catalystId: number;
      analystId: number | null;
      createdCompany?: { id: number; ticker: string; name: string };
      createdAnalyst?: { id: number; name: string };
    }
  | {
      ok: false;
      message: string;
    };

export async function extractReportAction(
  formData: FormData,
): Promise<ExtractionResponse> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, message: "Only admins can perform automated extraction." };
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return { ok: false, message: "No PDF file was provided for extraction." };
  }

  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    return { ok: false, message: "Only PDF files can be extracted." };
  }

  if (file.size > MAX_REPORT_BYTES) {
    return {
      ok: false,
      message: `File size (${formatBytes(file.size)}) exceeds the ${formatBytes(MAX_REPORT_BYTES)} limit.`,
    };
  }

  let buffer: Buffer;
  try {
    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("Failed to read PDF buffer", error);
    return { ok: false, message: "Could not read the uploaded PDF file." };
  }

  let extracted: ExtractedMoverData;
  try {
    extracted = await extractMoverFromPdfBuffer(buffer);
  } catch (error) {
    console.error("extractMoverFromPdfBuffer failed", error);
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Claude could not extract metadata from this PDF. Check the server logs.",
    };
  }

  const db = getDb();

  try {
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

    // 2. Resolve Catalyst ID from Slug
    const [catalyst] = await db
      .select({ id: catalysts.id })
      .from(catalysts)
      .where(eq(catalysts.slug, extracted.catalystSlug));

    let catalystId = catalyst?.id;
    if (!catalystId) {
      // Fallback to the first catalyst or "other"
      const [fallback] = await db
        .select({ id: catalysts.id })
        .from(catalysts)
        .orderBy(asc(catalysts.sortOrder))
        .limit(1);
      catalystId = fallback?.id ?? 1;
    }

    // 3. Resolve or Auto-Create Analyst
    let analystId: number | null = null;
    let createdAnalyst: { id: number; name: string } | undefined;

    if (extracted.analystName) {
      const [existingAnalyst] = await db
        .select({ id: analysts.id, name: analysts.name })
        .from(analysts)
        .where(ilike(analysts.name, extracted.analystName));

      if (existingAnalyst) {
        analystId = existingAnalyst.id;
      } else {
        const [newAnalyst] = await db
          .insert(analysts)
          .values({ name: extracted.analystName, active: true })
          .onConflictDoNothing({ target: analysts.name })
          .returning({ id: analysts.id, name: analysts.name });

        if (newAnalyst) {
          analystId = newAnalyst.id;
          createdAnalyst = newAnalyst;
        }
      }
    }

    return {
      ok: true,
      data: extracted,
      companyId,
      catalystId,
      analystId,
      createdCompany,
      createdAnalyst,
    };
  } catch (error) {
    console.error("Database resolution failed during extraction", error);
    return {
      ok: false,
      message: "Extracted data from PDF, but failed to link records in the database.",
    };
  }
}
