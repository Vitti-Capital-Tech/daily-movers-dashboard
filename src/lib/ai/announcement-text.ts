import "server-only";

import { extractText } from "unpdf";

import { asxData } from "@/lib/asx";
import { AnnouncementUnavailableError, type Announcement } from "@/lib/asx";
import { CHAR_BUDGET, classifyAnnouncement } from "@/lib/asx/filings";

/**
 * Announcement PDFs, turned into text the model can read.
 *
 * Text extraction first, the same trick `lib/ai/anthropic.ts` already uses for
 * uploaded reports, and it matters far more here: a results pack is routinely
 * 36 pages and 2.6 MB. Twenty-five of those sent as `document` blocks would be
 * tens of megabytes of base64 against a 32 MB request ceiling, and would cost
 * roughly an order of magnitude more than the same content as text.
 *
 * The visual fallback is kept for the ones that need it — scanned signature
 * pages and a few image-only presentations extract to nothing.
 */

export type AnnouncementDocument = {
  announcement: Announcement;
  /** Extracted text, empty when the PDF is image-only. */
  text: string;
  /** Set when text extraction produced nothing usable and bytes are needed. */
  pdfBase64: string | null;
  /**
   * True when the text was cut at this filing's character budget.
   *
   * The budget depends on what kind of filing it is — an 89-page takeover deed
   * is read for its terms and not its schedules, while a results pack is read
   * in full. See `CHAR_BUDGET` in `lib/asx/filings.ts` for the measurement
   * behind those numbers. A head-truncation loses appendices and signature
   * blocks rather than the result.
   */
  truncated: boolean;
};

/**
 * Above this, the PDF is not worth fetching as bytes for the visual fallback:
 * base64 inflates by a third, and several such documents in one request would
 * approach the API's 32 MB limit on their own.
 */
const MAX_VISUAL_FALLBACK_BYTES = 6 * 1024 * 1024;

/** Text shorter than this means extraction effectively failed. */
const MIN_USEFUL_TEXT_CHARS = 200;

/**
 * Concurrent downloads. Four is enough to keep the pipeline from being
 * download-bound while staying obviously polite to the ASX's servers — this
 * runs against a public site on a schedule, not a paid API with a quota.
 */
const DOWNLOAD_CONCURRENCY = 4;

function cleanExtractedText(pages: string[]): string {
  return pages
    .map((page, index) => `--- page ${index + 1} ---\n${page.trim()}`)
    .filter((page) => page.trim().length > 20)
    .join("\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function loadOne(
  announcement: Announcement,
): Promise<AnnouncementDocument | null> {
  let bytes: Uint8Array;
  try {
    bytes = await asxData.fetchAnnouncementPdf(announcement.idsId);
  } catch (error) {
    // One unreadable filing out of twenty-five must not cost the day's report.
    // Withdrawn documents and the occasional 500 are normal here.
    if (error instanceof AnnouncementUnavailableError) {
      console.warn(`skipping announcement ${announcement.idsId}: ${error.message}`);
    } else {
      console.warn(`skipping announcement ${announcement.idsId}`, error);
    }
    return null;
  }

  let text = "";
  try {
    // A fresh view per call: unpdf transfers the buffer to its worker, which
    // detaches it, so reusing the same Uint8Array for a second call throws.
    const parsed = await extractText(new Uint8Array(bytes.slice()));
    text = Array.isArray(parsed.text)
      ? cleanExtractedText(parsed.text)
      : String(parsed.text ?? "").trim();
  } catch (error) {
    console.warn(`text extraction failed for ${announcement.idsId}`, error);
  }

  const usable = text.length >= MIN_USEFUL_TEXT_CHARS;
  /**
   * How much of this document is worth sending, by class. A supplementary
   * bidder's statement keeps its terms and loses its schedules; a resource
   * estimate keeps everything.
   */
  const budget = CHAR_BUDGET[classifyAnnouncement(announcement).filingClass];
  const truncated = usable && text.length > budget;

  return {
    announcement,
    text: usable ? text.slice(0, budget) : "",
    pdfBase64:
      !usable && bytes.length <= MAX_VISUAL_FALLBACK_BYTES
        ? Buffer.from(bytes).toString("base64")
        : null,
    truncated,
  };
}

/**
 * Downloads and reads a list of announcements, in list order.
 *
 * Announcements that can't be read at all — no text and too large for the
 * visual fallback — are dropped rather than returned empty, so a caller never
 * has to distinguish "read it and it said nothing" from "couldn't read it".
 */
export async function loadAnnouncementDocuments(
  announcements: Announcement[],
  onProgress?: (done: number, total: number) => void,
): Promise<AnnouncementDocument[]> {
  const results = new Array<AnnouncementDocument | null>(announcements.length);
  let next = 0;
  let completed = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(DOWNLOAD_CONCURRENCY, announcements.length) },
      async function worker() {
        while (next < announcements.length) {
          const index = next++;
          results[index] = await loadOne(announcements[index]);
          completed += 1;
          onProgress?.(completed, announcements.length);
        }
      },
    ),
  );

  return results.filter(
    (doc): doc is AnnouncementDocument =>
      doc !== null && (doc.text.length > 0 || doc.pdfBase64 !== null),
  );
}

/** One announcement rendered for a prompt, with its provenance attached. */
export function formatDocumentForPrompt(doc: AnnouncementDocument): string {
  const { announcement } = doc;
  const header =
    `[${announcement.idsId}] ${announcement.date}` +
    `${announcement.time ? ` ${announcement.time}` : ""} — ` +
    `${announcement.headline}` +
    `${announcement.isPriceSensitive ? " (PRICE SENSITIVE)" : ""}`;

  const body = doc.text
    ? doc.text
    : "[no extractable text — this document is attached as a PDF instead]";

  return `${header}\n${"=".repeat(Math.min(header.length, 100))}\n${body}${
    doc.truncated ? "\n\n[document truncated]" : ""
  }`;
}
