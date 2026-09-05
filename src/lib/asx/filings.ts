import type { Announcement } from "./provider";

/**
 * Classifying ASX filings by how much analysis is actually in them.
 *
 * The price-sensitive flag is a good filter and not a sufficient one. Measured
 * on a real corpus — Forrestania's 25 most recent price-sensitive announcements,
 * 608,000 characters, ~236,000 billed tokens — **16 of the 25 documents and 55%
 * of the tokens were takeover procedure**: six sequential "Extension of Offer
 * Period" notices, five Takeovers Panel receipt-and-orders notices, and an
 * 89-page Takeover Implementation Deed plus a 56-page Supplementary Bidder's
 * Statement, both of which are legal instruments whose substance is stated in a
 * one-page announcement elsewhere in the same set.
 *
 * That is more than half the cost of a draft spent on documents the report does
 * not draw a single number from.
 *
 * The correction is deliberately surgical rather than a deny-list, because a
 * blanket filter gets it wrong in an expensive direction. In that same corpus
 * "TOV: ZNC - Declaration of Unacceptable Circumstances" looks like procedure
 * and was in fact material: the published report's takeaway turned on it
 * ("the unresolved Takeovers Panel proceedings... a declaration of unacceptable
 * circumstances stands"). So nothing is dropped for being procedural. Instead:
 *
 * 1. A **sequential series** collapses to its latest member. The sixth extension
 *    of an offer period tells you everything the third did; five receipt notices
 *    for the same Panel application are one fact.
 * 2. A **legal instrument** keeps its front matter and loses its annexures, via
 *    a much smaller character budget rather than exclusion. The offer terms are
 *    in the first pages; the remaining eighty are schedules.
 *
 * Everything else is read in full.
 */

/**
 * Filings that are one step in an ongoing process, where only the most recent
 * step carries information. Grouped by the `series` key so members of the same
 * process collapse together and two unrelated processes do not.
 */
const SERIES_PATTERNS: { series: string; pattern: RegExp }[] = [
  // Takeover mechanics: each notice supersedes the last.
  { series: "offer-period", pattern: /extension of offer period/i },
  { series: "offer-conditions", pattern: /notice of status of conditions/i },
  { series: "offer-progress", pattern: /takeover bid update|offer update/i },
  // Takeovers Panel: "receives application", "receives review application".
  // The declarations and orders are NOT here — they change the legal position.
  { series: "panel-receipts", pattern: /panel receives/i },
  // Buy-back and capital housekeeping, filed daily during a programme.
  { series: "buyback", pattern: /notification of buy-?back|daily share buy-?back/i },
  { series: "quotation", pattern: /application for quotation|notification regarding unquoted/i },
  { series: "cessation", pattern: /notification of cessation of securities/i },
];

/**
 * Long legal instruments. Read for their terms, not their schedules.
 *
 * These are the documents that blow the budget: in the measured corpus the two
 * largest were 89 and 56 pages, and both hit the per-document character cap on
 * their own.
 */
const LEGAL_INSTRUMENT_PATTERNS: RegExp[] = [
  /supplementary (bidder|target)'?s statement/i,
  /^(bidder|target)'?s statement/i,
  /takeover implementation deed/i,
  /scheme (booklet|implementation deed)/i,
  /notice of (annual general |general )?meeting/i,
  /explanatory (memorandum|statement)/i,
  /prospectus/i,
  /constitution/i,
];

/**
 * Filings the desk reads even when the ASX did not flag them price-sensitive.
 *
 * The price-sensitive flag answers "did this move the stock", which is the right
 * filter for *today's* announcement and the wrong one for the company's
 * background. Instruction 2 puts annual reports, half-year reports, quarterlies
 * and investor presentations near the top of the source hierarchy, and on the
 * ASX those routinely arrive unflagged: the market already knows the result from
 * the Appendix 4E lodged minutes earlier, so the full report that follows it —
 * the document with the segment note, the cash flow statement and the debt
 * maturity table — carries no asterisk.
 *
 * Reading only flagged filings therefore left the report writing about a
 * business from its announcements rather than its accounts. These headline
 * patterns bring the accounts back in without opening the gate to the daily
 * Appendix 3Y and change-of-address notices.
 */
const BACKGROUND_PATTERNS: RegExp[] = [
  /annual report/i,
  /half[- ]?year(ly)? (report|accounts|results)/i,
  /(interim|full[- ]?year|preliminary final) (report|results)/i,
  /appendix 4[cde]/i,
  /appendix 5b/i,
  /quarterly (activities|cash ?flow|report|update)/i,
  /(investor|results|company|corporate|market|analyst) (presentation|briefing|day|update)/i,
  /(fy|hy|1h|2h|h1|h2)\s?\d{2,4}\s+(results|report|presentation)/i,
  /operational update/i,
  /annual general meeting.*(presentation|address)/i,
  /(chair(man)?'?s|ceo'?s|managing director'?s) address/i,
];

/**
 * Whether an unflagged filing is worth reading for background.
 *
 * Applied only to announcements that are *not* price-sensitive — the flagged
 * ones are already in. Legal instruments and series members are excluded here
 * rather than admitted and then budgeted down: an unflagged notice of meeting is
 * background the report has never used, and the point of this pass is to add
 * accounts, not volume.
 */
export function isBackgroundFiling(announcement: Announcement): boolean {
  if (announcement.isPriceSensitive) return false;
  const headline = announcement.headline;
  if (LEGAL_INSTRUMENT_PATTERNS.some((pattern) => pattern.test(headline))) {
    return false;
  }
  if (SERIES_PATTERNS.some(({ pattern }) => pattern.test(headline))) {
    return false;
  }
  return BACKGROUND_PATTERNS.some((pattern) => pattern.test(headline));
}

export type FilingClass =
  | "substantive"
  | "series"
  | "legal-instrument"
  | "background";

export type ClassifiedAnnouncement = Announcement & {
  filingClass: FilingClass;
  /** Set for `series`; members sharing a key collapse to the newest. */
  seriesKey: string | null;
};

export function classifyAnnouncement(
  announcement: Announcement,
): ClassifiedAnnouncement {
  const headline = announcement.headline;

  for (const { series, pattern } of SERIES_PATTERNS) {
    if (pattern.test(headline)) {
      return { ...announcement, filingClass: "series", seriesKey: series };
    }
  }

  if (LEGAL_INSTRUMENT_PATTERNS.some((pattern) => pattern.test(headline))) {
    return {
      ...announcement,
      filingClass: "legal-instrument",
      seriesKey: null,
    };
  }

  if (isBackgroundFiling(announcement)) {
    return { ...announcement, filingClass: "background", seriesKey: null };
  }

  return { ...announcement, filingClass: "substantive", seriesKey: null };
}

/**
 * Character budget for one document's extracted text, by class.
 *
 * `substantive` is the original cap: a results pack or a resource estimate
 * earns its length. `legal-instrument` gets roughly the front matter — enough
 * for the terms, consideration and conditions, without eighty pages of
 * annexures. `series` members that survive collapsing are short anyway.
 */
export const CHAR_BUDGET: Record<FilingClass, number> = {
  substantive: 90_000,
  series: 12_000,
  "legal-instrument": 14_000,
  /**
   * Background filings are read for context, on a deliberately tight budget.
   *
   * An annual report is the largest document a listed company files, and it is
   * in the corpus for its front matter: the operating and financial review, the
   * segment note, the cash flow statement and the debt disclosures all sit ahead
   * of the auditor's report, the remuneration tables and the notes on
   * share-based payments. 25k characters is roughly the first 15 pages, which
   * reaches all of it in the standard ASX layout — and 25k rather than the 45k
   * this started at because the extra 20k was buying the back half of the
   * document, which is where the parts a Daily Mover never cites live.
   */
  background: 25_000,
};

export type PrioritiseResult = {
  /** What to read, newest first. */
  keep: ClassifiedAnnouncement[];
  /** Superseded series members, for the draft's audit trail. */
  collapsed: ClassifiedAnnouncement[];
};

/**
 * Chooses which of a company's price-sensitive filings to read.
 *
 * `target` counts the documents kept, so collapsing a series makes room for
 * another substantive filing rather than simply shortening the corpus — the
 * saving is spent on better evidence, not only on a smaller bill.
 *
 * `seriesKeep` is 1 by default: the newest member of a series. Two would keep
 * a sense of direction ("extended again"), which the report has never needed.
 */
export function prioritiseAnnouncements(
  announcements: Announcement[],
  options: { target: number; seriesKeep?: number },
): PrioritiseResult {
  const seriesKeep = options.seriesKeep ?? 1;

  const classified = announcements.map(classifyAnnouncement);
  const seenPerSeries = new Map<string, number>();

  const keep: ClassifiedAnnouncement[] = [];
  const collapsed: ClassifiedAnnouncement[] = [];

  // Input is newest-first, so the first member of a series encountered is the
  // one that supersedes the rest.
  for (const item of classified) {
    if (item.seriesKey) {
      const seen = seenPerSeries.get(item.seriesKey) ?? 0;
      if (seen >= seriesKeep) {
        collapsed.push(item);
        continue;
      }
      seenPerSeries.set(item.seriesKey, seen + 1);
    }

    if (keep.length >= options.target) {
      collapsed.push(item);
      continue;
    }
    keep.push(item);
  }

  return { keep, collapsed };
}
