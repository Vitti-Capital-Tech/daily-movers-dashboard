import "server-only";

import JSZip from "jszip";

import { asxData, AnnouncementUnavailableError } from "@/lib/asx";

/**
 * Every announcement a draft was written from, as one ZIP — shared by the
 * admin download route and the draft email.
 *
 * Files are fetched from the ASX rather than from storage because the pipeline
 * never keeps them: it extracts each PDF to text, sends that, and throws the
 * bytes away — `mover_drafts.sources` holds the *list*, which is what makes
 * this possible and why it has to re-download.
 */

/** Polite against a public site, and enough to not be download-bound. */
const CONCURRENCY = 4;

export type SourceEntry = {
  idsId: string;
  headline: string;
  date: string;
  pageCount?: number | null;
  sourceUrl?: string;
  isPriceSensitive?: boolean;
};

export type DraftSourceLists = {
  today: SourceEntry[];
  history: SourceEntry[];
  /** `idsId`s the report actually drew a figure or fact from. */
  cited: Set<string>;
};

/** Reads the two lists and the cited set off a draft row's jsonb columns. */
export function readDraftSources(
  sources: unknown,
  report: unknown,
): DraftSourceLists {
  const lists = (sources ?? {}) as {
    today?: SourceEntry[];
    history?: SourceEntry[];
  };
  return {
    today: lists.today ?? [],
    history: lists.history ?? [],
    cited: new Set(
      ((report as { citedIdsIds?: string[] } | null)?.citedIdsIds ?? []).map(
        String,
      ),
    ),
  };
}

/** A filename that survives Windows, macOS and a ZIP listing. */
function safeName(entry: SourceEntry): string {
  const headline = entry.headline
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return `${entry.date} ${headline} [${entry.idsId}].pdf`;
}

export function sourcesZipFilename(
  ticker: string | null,
  moveDate: string,
): string {
  return `${ticker ?? "draft"}-${moveDate.slice(0, 10)}-sources.zip`;
}

export async function buildSourcesZip(input: {
  draftId: number;
  ticker: string | null;
  moveDate: string;
  lists: DraftSourceLists;
}): Promise<{ bytes: Uint8Array; failures: string[] }> {
  const { draftId, ticker, moveDate } = input;
  const { today, history, cited } = input.lists;

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
    `Daily Mover draft ${draftId} — ${ticker} ${moveDate.slice(0, 10)}`,
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

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return { bytes, failures };
}
