/**
 * Report PDF storage constants and path rules.
 *
 * Client-safe: no server-only imports, because the upload widget needs these
 * too.
 */

export const REPORTS_BUCKET = "daily-mover-reports";

/** Supabase's own per-file ceiling for this bucket. */
export const MAX_REPORT_BYTES = 25 * 1024 * 1024; // 25 MB
export const ALLOWED_REPORT_TYPES = ["application/pdf"] as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Strips anything that could escape the intended folder or upset the storage
 * API, then caps the length. Storage keys come from user-supplied filenames, so
 * this runs on the server before a signed URL is issued — never trusted from the
 * client.
 */
export function safeFileSlug(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[Pp][Dd][Ff]$/, "");
  const slug = withoutExtension
    .normalize("NFKD")
    // Drop anything that isn't a word char, whitespace, dot or dash. Removes
    // slashes and backslashes, so the slug can never span a folder.
    .replace(/[^\w\s.-]/g, "")
    // Dots become dashes BEFORE dashes are collapsed. Removing slashes alone
    // leaves runs like ".." behind ("report/../x" -> "report....x"), which can't
    // traverse but which some storage backends normalise. Nothing legitimate
    // needs a dot here — the extension was already stripped.
    .replace(/\.+/g, "-")
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60)
    // The slice can leave a trailing dash.
    .replace(/-+$/g, "");
  return slug || "report";
}

/**
 * `<ticker>/<date>-<slug>-<random>.pdf`
 *
 * Ticker-first so the bucket browses the way the app does. The random suffix
 * avoids collisions when the same report is re-uploaded, and means a guessed key
 * isn't a valid one.
 */
export function buildReportPath(input: {
  ticker: string;
  moveDate: string;
  fileName: string;
  random: string;
}): string {
  const ticker = input.ticker.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "UNKNOWN";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.moveDate)
    ? input.moveDate
    : "undated";
  return `${ticker}/${date}-${safeFileSlug(input.fileName)}-${input.random}.pdf`;
}

export function isPdf(file: { type: string; name: string }): boolean {
  return (
    (ALLOWED_REPORT_TYPES as readonly string[]).includes(file.type) ||
    /\.pdf$/i.test(file.name)
  );
}
