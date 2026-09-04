import {
  AnnouncementUnavailableError,
  SourceShapeChangedError,
  type Announcement,
} from "./provider";

/**
 * Company announcements from the ASX's own statistics pages.
 *
 * Three sources were tried; this is the only one that answers the question the
 * pipeline actually asks ("the last 20-30 *price sensitive* releases"):
 *
 * - `asx.api.markitdigital.com/.../announcements` returns clean JSON with an
 *   `isPriceSensitive` flag, and is what the modern ASX site calls. It is
 *   **hard-capped at 5 items** — `count`, `page` and `itemsPerPage` are all
 *   accepted and all ignored. Fine for a "latest announcements" widget, useless
 *   for a history.
 * - Market Index's per-company announcements list renders client-side from their
 *   licensed quote feed, so reading it means borrowing their paid licence.
 * - This one: the legacy `announcements.do` servlet, which serves a whole year
 *   per request with the price-sensitive asterisk in the markup.
 *
 * See `NOTICE` at the bottom of this file for the licensing caveat that comes
 * with it.
 */

const LIST_URL = "https://www.asx.com.au/asx/v2/statistics/announcements.do";
const PDF_GATE_URL =
  "https://www.asx.com.au/asx/v2/statistics/displayAnnouncement.do";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
};

/**
 * A year page is a fixed historical fact once the year is over, and this year's
 * changes only when the company files something. Ten minutes is short enough to
 * pick up a filing made during the run-up to a draft and long enough that
 * retrying a draft costs the ASX nothing.
 */
const LIST_REVALIDATE_SECONDS = 600;

/** How far back to walk before giving up on reaching the target count. */
const DEFAULT_MAX_YEARS_BACK = 6;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** "14.3KB" / "1.3MB" / "220.0KB" → bytes. */
function parseSize(text: string): number | null {
  const match = /([\d.]+)\s*(KB|MB|B)\b/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toUpperCase();
  if (unit === "MB") return Math.round(value * 1024 * 1024);
  if (unit === "KB") return Math.round(value * 1024);
  return Math.round(value);
}

/**
 * "8:16 am" / "12:49 pm" -> minutes since midnight, for sorting.
 *
 * Needed because the printed time cannot be compared as a string: "9:00 am"
 * sorts *after* "10:00 am" lexically, and "8:16 am" after "12:49 pm". Getting
 * this wrong reverses the order of a company's same-day filings, which is
 * exactly the day that matters — the results announcement and the market's
 * reaction to it are both on it.
 */
function parseAsxTimeMinutes(text: string | null): number {
  if (!text) return -1;
  const match = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(text);
  if (!match) return -1;

  const [, hourText, minuteText, meridiem] = match;
  let hour = Number(hourText) % 12;
  if (meridiem.toLowerCase() === "pm") hour += 12;
  return hour * 60 + Number(minuteText);
}

/** The page prints DD/MM/YYYY; everything downstream wants YYYY-MM-DD. */
function parseAsxDate(text: string): string | null {
  const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

/**
 * Parses one year page.
 *
 * The price-sensitive flag is the `<img title="price sensitive">` the ASX puts
 * in the second cell. Both the title attribute and the icon filename are
 * checked, and a non-empty cell counts as sensitive as a last resort — getting
 * this wrong in the *lenient* direction only means reading an extra filing,
 * while getting it wrong in the strict direction would silently drop the results
 * announcement the whole report is about.
 */
function parseYearPage(html: string, ticker: string, year: number): Announcement[] {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const found: Announcement[] = [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 3) continue;

    const idsId = /idsId=(\d+)/.exec(cells[2])?.[1];
    if (!idsId) continue;

    const date = parseAsxDate(cells[0]);
    if (!date) continue;

    const time =
      /<span class="dates-time">([\s\S]*?)<\/span>/.exec(cells[0])?.[1];

    const sensitiveCell = cells[1];
    const isPriceSensitive =
      /title="price sensitive"/i.test(sensitiveCell) ||
      /icon-price-sensitive/i.test(sensitiveCell) ||
      stripTags(sensitiveCell) !== "";

    const linkCell = cells[2];
    // The anchor holds the headline, then a PDF icon, then the page count and
    // file size in their own spans. Pulling those spans out first leaves the
    // headline as the only text remaining.
    const pageText = /<span class="page">([\s\S]*?)<\/span>/.exec(linkCell)?.[1];
    const sizeText = /<span class="filesize">([\s\S]*?)<\/span>/.exec(linkCell)?.[1];

    const headline = stripTags(
      linkCell
        .replace(/<span class="page">[\s\S]*?<\/span>/g, "")
        .replace(/<span class="filesize">[\s\S]*?<\/span>/g, ""),
    );
    if (!headline) continue;

    const pages = pageText ? Number(/(\d+)/.exec(pageText)?.[1] ?? "") : NaN;

    found.push({
      idsId,
      date,
      time: time ? stripTags(time) : null,
      headline,
      isPriceSensitive,
      pageCount: Number.isFinite(pages) ? pages : null,
      sizeBytes: sizeText ? parseSize(stripTags(sizeText)) : null,
      sourceUrl: `${PDF_GATE_URL}?display=pdf&idsId=${idsId}`,
    });
  }

  if (found.length === 0 && !/no announcements|didn't find/i.test(html)) {
    throw new SourceShapeChangedError(
      `${LIST_URL} (${ticker} ${year})`,
      "page loaded but no announcement rows parsed",
    );
  }

  return found;
}

async function fetchYear(ticker: string, year: number): Promise<Announcement[]> {
  const url =
    `${LIST_URL}?by=asxCode&asxCode=${encodeURIComponent(ticker)}` +
    `&timeframe=Y&year=${year}`;

  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    next: { revalidate: LIST_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`ASX announcements returned ${response.status} for ${url}`);
  }

  return parseYearPage(await response.text(), ticker, year);
}

/**
 * Walks back a year at a time until the target number of price-sensitive
 * releases is in hand.
 *
 * Sequential rather than parallel on purpose: most companies reach 25
 * price-sensitive releases within two or three years, so firing six requests up
 * front would usually waste four of them.
 */
export async function fetchAsxAnnouncements(
  ticker: string,
  options: { minPriceSensitive: number; maxYearsBack?: number },
): Promise<Announcement[]> {
  const maxYearsBack = options.maxYearsBack ?? DEFAULT_MAX_YEARS_BACK;
  // The ASX's own calendar, not the server's: a run just after midnight UTC is
  // still the same Sydney year, and asking for next year returns an empty page.
  const currentYear = Number(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      year: "numeric",
    }).format(new Date()),
  );

  const collected: Announcement[] = [];
  const seen = new Set<string>();
  let sensitiveCount = 0;

  for (let offset = 0; offset < maxYearsBack; offset += 1) {
    const year = currentYear - offset;

    let batch: Announcement[];
    try {
      batch = await fetchYear(ticker, year);
    } catch (error) {
      // One unreachable year should not discard the years already collected —
      // a report built on 18 announcements beats no report at all.
      console.warn(`ASX announcements: ${ticker} ${year} failed`, error);
      break;
    }

    for (const announcement of batch) {
      if (seen.has(announcement.idsId)) continue;
      seen.add(announcement.idsId);
      collected.push(announcement);
      if (announcement.isPriceSensitive) sensitiveCount += 1;
    }

    if (sensitiveCount >= options.minPriceSensitive) break;
  }

  // Newest first. The year pages already arrive in that order, but they are
  // concatenated across requests, and time-of-day matters for same-day releases.
  collected.sort((a, b) =>
    a.date === b.date
      ? parseAsxTimeMinutes(b.time) - parseAsxTimeMinutes(a.time)
      : b.date.localeCompare(a.date),
  );

  return collected;
}

/**
 * The announcement PDF's bytes.
 *
 * Two hops, because the ASX puts a terms-of-access interstitial in front of
 * every PDF. That page is not a redirect and not a cookie wall — it is a form
 * whose hidden `pdfURL` field carries the real, directly-fetchable document URL
 * on `announcements.asx.com.au`. Reading that field is what the "Agree and
 * proceed" button does.
 */
export async function fetchAsxAnnouncementPdf(
  idsId: string,
): Promise<Uint8Array> {
  if (!/^\d+$/.test(idsId)) {
    throw new AnnouncementUnavailableError(idsId, "not a valid ASX document id");
  }

  const gateResponse = await fetch(
    `${PDF_GATE_URL}?display=pdf&idsId=${idsId}`,
    { headers: BROWSER_HEADERS, cache: "no-store" },
  );

  if (!gateResponse.ok) {
    throw new AnnouncementUnavailableError(
      idsId,
      `gate page returned ${gateResponse.status}`,
    );
  }

  const gateHtml = await gateResponse.text();
  const pdfUrl = /name="pdfURL"\s+value="([^"]+)"/.exec(gateHtml)?.[1];

  if (!pdfUrl) {
    // Either the interstitial changed, or the document has been withdrawn and
    // the servlet rendered an error page instead.
    throw new AnnouncementUnavailableError(
      idsId,
      "no pdfURL field on the access page",
    );
  }

  const pdfResponse = await fetch(decodeEntities(pdfUrl), {
    headers: BROWSER_HEADERS,
    cache: "no-store",
  });

  if (!pdfResponse.ok) {
    throw new AnnouncementUnavailableError(
      idsId,
      `document fetch returned ${pdfResponse.status}`,
    );
  }

  const bytes = new Uint8Array(await pdfResponse.arrayBuffer());

  // A gate page served with a 200 and an HTML body would otherwise reach the
  // PDF parser and fail there with something unrecognisable.
  const isPdf =
    bytes.length > 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46; //  F
  if (!isPdf) {
    throw new AnnouncementUnavailableError(
      idsId,
      "response was not a PDF (got HTML — the access gate may have changed)",
    );
  }

  return bytes;
}

/**
 * NOTICE — terms of access
 *
 * The ASX's interstitial states that company announcements are free for
 * "investors' private and personal use", and that use "for a 'commercial' as
 * opposed to 'private or personal' purpose" requires "the express written
 * authority of ASX". Its examples of professional or commercial use explicitly
 * include being "engaged in the business of accessing or aggregating
 * information and redistributing" it.
 *
 * Vitti Capital is a commercial user, so that authority — or a licensed
 * announcements feed — is a prerequisite for running this in production, and
 * Market Index's own terms raise the same question for `./marketindex.ts`.
 *
 * This is a compliance decision, not a technical one, which is why it is a
 * comment rather than a runtime check. `./provider.ts` is the seam that makes
 * swapping to a licensed feed a one-module change if the answer is no.
 */
