/**
 * The shape of a Daily Mover report.
 *
 * Reverse-engineered from the current house template (the SPZ and JBH reports of
 * 17-18 August 2026), which is a slide-style document rather than prose: an
 * eyebrow and running footer on every page, one idea per page, and dense KPI
 * cards carrying the numbers. The earlier Google Docs-era reports (14D, NEU)
 * were three pages of continuous text; this models the newer style, because that
 * is what the desk publishes now.
 *
 * Why a typed block union rather than "a string of markdown":
 *
 * - It is the model's output schema. Asking Claude for `ReportPage[]` through a
 *   tool definition produces a document with the same rhythm every day; asking
 *   for prose produces a wall of text that has to be re-typeset by hand.
 * - The renderer is a lookup from `kind` to a component, so adding a page style
 *   is additive and a malformed page fails loudly at one block instead of
 *   silently mangling the layout.
 * - It stores compactly in `mover_drafts.report` and can be diffed against a
 *   later prompt's output, which is the same reasoning behind
 *   `daily_movers.extraction`.
 *
 * Client-safe: no imports, because the review UI renders a preview of these
 * blocks alongside the PDF.
 */

/** One big-number card: the "~20.6% / SHARE MOVE (MORNING TRADE)" unit. */
export type ReportKpi = {
  /** The figure exactly as it should read: "$126.0M", "~20.6%", "9-10 MONTHS". */
  value: string;
  /** Rendered in letter-spaced caps, so keep it to a few words. */
  label: string;
  /** Optional one-line gloss under the label. */
  note?: string | null;
};

/** A letter-spaced small-caps sub-heading with a paragraph under it. */
export type ReportCallout = {
  label: string;
  text: string;
};

/** A named block: the per-country and per-acquisition entries on the SPZ pages. */
export type ReportEntity = {
  name: string;
  /** The dense stat line: "$8.8m rev (+19%) · EBITDA $4.1m · 46.7% margin". */
  stat: string;
  /** One line of interpretation. */
  comment?: string | null;
};

export type ReportPage =
  /**
   * Page 1. `kpis` is capped at two by the layout — the hero row is a pair of
   * cards, and a third would either shrink them or wrap.
   */
  | {
      kind: "cover";
      /** Full registered name, wrapped across lines by the renderer. */
      companyName: string;
      /** The "Shares Rise as Much as ~20.6% in Morning Trade After..." line. */
      headline: string;
      kpis: ReportKpi[];
    }
  /** Prose with an optional intro and small-caps callouts. */
  | {
      kind: "narrative";
      title: string;
      intro?: string | null;
      paragraphs: string[];
      callouts?: ReportCallout[];
    }
  /** A KPI grid with optional framing text above and notes below. */
  | {
      kind: "kpis";
      title: string;
      intro?: string | null;
      kpis: ReportKpi[];
      notes?: string[];
      callouts?: ReportCallout[];
    }
  /** Named blocks — segments, geographies, acquisitions. */
  | {
      kind: "entities";
      title: string;
      intro?: string | null;
      items: ReportEntity[];
    }
  /** "Risks & What to Watch": label plus explanation, no numbers. */
  | {
      kind: "risks";
      title: string;
      items: ReportCallout[];
    }
  /** "Where the Story Stands": a few standalone statements, then the by-line. */
  | {
      kind: "closing";
      title: string;
      statements: string[];
    };

export type ReportDoc = {
  /** ASX code, rendered letter-spaced as "A S X : S P Z". */
  ticker: string;
  /** Repeated in the footer of every page. */
  companyName: string;
  /** Move date, YYYY-MM-DD. Rendered as "18 August 2026" in the footer. */
  moveDate: string;
  /** Footer by-line and the signature on the closing page. */
  analystName: string;
  pages: ReportPage[];
};

/** Page kinds the model is allowed to emit. `disclaimer` is not one of them. */
export const REPORT_PAGE_KINDS = [
  "cover",
  "narrative",
  "kpis",
  "entities",
  "risks",
  "closing",
] as const;

/**
 * The compliance page, appended by the renderer and never model-generated.
 *
 * Verbatim from the current template. This is regulated text carrying an AFSL
 * number and a link to the FSG — a paraphrase is a compliance breach, and a
 * language model asked to "write the disclaimer" will paraphrase. Keeping it out
 * of the schema entirely means there is no path by which it can vary.
 */
export const DISCLAIMER_HEADING = "Disclaimer:";

export const DISCLAIMER_PARAGRAPHS: readonly string[] = [
  "This information is of a general nature only and has been prepared without taking into account your objectives, financial situation or needs. You should consider the appropriateness of the information, having regard to your circumstances, before making any investment decisions.",
  "This communication is not personal financial advice. Vitti Capital is a Corporate Authorised Representative of Point Capital Group Pty Ltd (AFSL 518031).",
  "If you have not previously received a copy of our Financial Services Guide (FSG), it is available free of charge from our website (https://vitti.capital/fsg/) or by contacting us. Vitti Capital and its representatives may hold or have exposure to securities mentioned. Any such interest is managed under our Conflicts of Interest Policy (https://vitti.capital/privacy-policy-2/).",
];

/** How many content pages a report should run to, matching the house style. */
export const REPORT_PAGE_TARGET = { min: 7, max: 11 } as const;

/** "2026-08-18" -> "18 August 2026", as the footer prints it. */
export function formatReportDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  const monthName = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][Number(month) - 1];
  return `${Number(day)} ${monthName ?? month} ${year}`;
}

/** "SPZ" -> "A S X : S P Z", the eyebrow on every page. */
export function formatEyebrow(ticker: string): string {
  return `A S X : ${ticker.toUpperCase().split("").join(" ")}`;
}

/**
 * Sanity checks before a draft is shown to an analyst.
 *
 * These are structural, not editorial: a report with no cover page or with the
 * closing page in the middle is a broken document, and it is better to fail the
 * generation and say so than to render it and let a reviewer work out why it
 * looks wrong.
 */
export function validateReportDoc(doc: ReportDoc): string[] {
  const problems: string[] = [];

  if (!doc.ticker?.trim()) problems.push("report has no ticker");
  if (!doc.pages?.length) {
    problems.push("report has no pages");
    return problems;
  }

  if (doc.pages[0].kind !== "cover") {
    problems.push(`first page is "${doc.pages[0].kind}", expected "cover"`);
  }
  if (doc.pages.filter((page) => page.kind === "cover").length > 1) {
    problems.push("report has more than one cover page");
  }

  const closingAt = doc.pages.findIndex((page) => page.kind === "closing");
  if (closingAt === -1) {
    problems.push("report has no closing page");
  } else if (closingAt !== doc.pages.length - 1) {
    problems.push("closing page is not the last page");
  }

  const cover = doc.pages[0];
  if (cover.kind === "cover" && cover.kpis.length === 0) {
    problems.push("cover page has no KPI cards");
  }

  if (doc.pages.length < REPORT_PAGE_TARGET.min) {
    problems.push(
      `report is ${doc.pages.length} pages, below the ${REPORT_PAGE_TARGET.min}-page minimum`,
    );
  }

  return problems;
}
