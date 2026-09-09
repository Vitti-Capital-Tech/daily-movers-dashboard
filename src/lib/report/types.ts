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

/**
 * One plotted point. `display` is what prints, because the number that explains
 * the story is rarely the number that formats itself well: -0.5 plots as a
 * downward column and prints as "-0.5%".
 */
export type ReportChartPoint = {
  /** Axis label: "Q1 FY26", "New Zealand", "Jul-26". */
  label: string;
  /** The plotted magnitude. Signed — negatives plot below the baseline. */
  value: number;
  /** How the figure prints. Falls back to the raw value. */
  display?: string | null;
  /** Draws this point in the accent colour: the one the conclusion is about. */
  highlight?: boolean;
};

/**
 * A chart, in the only two forms the page has room for.
 *
 * `columns` is the trend — quarterly growth, margin by half, production by
 * period — and reads left to right as time. `bars` is the comparison, where the
 * labels are names rather than dates and are too long to sit under a column.
 *
 * Deliberately not a general charting layer. Instruction 32 asks for charts that
 * carry an insight, and every insight the desk has needed is one series of
 * labelled magnitudes with a conclusion under it. A second series, a secondary
 * axis or a scatter would all be new ways for a model to produce a chart nobody
 * can read.
 */
export type ReportChart = {
  type: "columns" | "bars";
  points: ReportChartPoint[];
  /** Optional axis note: "% change on prior corresponding period". */
  unit?: string | null;
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
  /**
   * A chart with the one-line conclusion that says what to notice in it.
   *
   * The conclusion is required, not optional. A chart without it is decoration,
   * which is the thing instruction 32 rules out.
   */
  | {
      kind: "chart";
      title: string;
      intro?: string | null;
      chart: ReportChart;
      conclusion: string;
      callouts?: ReportCallout[];
    }
  /**
   * The three-way split of instruction 28: what was announced, what the market
   * actually reacted to, and the thing that decides the story from here.
   *
   * Its own page kind rather than three callouts because the gap between the
   * headline and the reaction is the whole point of a Daily Mover on a day when
   * a record result sells off, and a fixed three-block layout is what stops it
   * being written as another narrative page.
   */
  | {
      kind: "market-vs-reality";
      title: string;
      headline: string;
      marketFocus: string;
      whatMatters: string;
    }
  /**
   * "What changed since the last update" (29) and "expectations vs actual" (30)
   * are the same shape: a metric, two figures, and the delta between them.
   * `columns` names what the two figures are, so one layout serves both.
   */
  | {
      kind: "comparison";
      title: string;
      intro?: string | null;
      /** Column headings: ["Metric", "Before", "Now"] or ["Metric", "Consensus", "Actual"]. */
      columns: [string, string, string];
      rows: ReportComparisonRow[];
      conclusion?: string | null;
    }
  /**
   * Who runs the company, and what has changed at the top.
   *
   * A PM meeting a name for the first time asks who is running it and whether
   * they own any of it, and the answer changes how the rest of the report reads:
   * a turnaround under a chief executive appointed four months ago is a
   * different proposition from the same turnaround under a fifteen-year founder.
   * Board and executive churn is also a risk in its own right — three CFOs in
   * two years is a finding, not a footnote.
   */
  | {
      kind: "management";
      title: string;
      intro?: string | null;
      people: ReportPerson[];
      /** Recent board or executive changes, from the filings. */
      changes?: string[];
    }
  /** The Vitti View scorecard (33). Not a recommendation — a read of the setup. */
  | {
      kind: "vitti-view";
      title: string;
      ratings: ReportRating[];
      keyDebate: string;
      nextCatalyst: string;
      /** The one question for management, from instruction 34. */
      managementQuestion?: string | null;
    }
  /** "What would change the story" (35): the two lists, company-specific. */
  | {
      kind: "outlook";
      title: string;
      intro?: string | null;
      improve: string[];
      worsen: string[];
    }
  /**
   * "Where the Story Stands": a few standalone statements, then the by-line.
   *
   * `signOff` is not a field — the renderer appends the house line verbatim, for
   * the same reason the disclaimer is not in the schema.
   */
  | {
      kind: "closing";
      title: string;
      statements: string[];
      /** Instruction 34, when it hasn't already been asked on the Vitti View page. */
      managementQuestion?: string | null;
    };

/** One row of a `comparison` page. */
export type ReportComparisonRow = {
  metric: string;
  before: string;
  now: string;
  /** "Beat"/"Miss", "+2.1pp", "Growth to contraction". Short — it is a column. */
  change: string;
  /** Colours the change cell. `neutral` when the direction isn't a verdict. */
  direction?: "better" | "worse" | "neutral" | null;
};

/**
 * One person on the management or board page.
 *
 * Everything but name and role is optional, because the evidence rarely carries
 * all of it. A directors' report gives tenure and shareholding; an appointment
 * announcement gives a start date and a background paragraph; a results pack
 * gives a name under a signature and nothing else. A page that renders what is
 * known beats one that needs a full dossier to render at all.
 */
export type ReportPerson = {
  name: string;
  /** "Managing Director & CEO", "Chair", "Chief Financial Officer". */
  role: string;
  /** "Appointed March 2024", "With the company 12 years". */
  tenure?: string | null;
  /** "2.1 million shares (0.4%)". */
  holding?: string | null;
  /** One line of relevant background, from the filings only. */
  note?: string | null;
};

/** One line of the Vitti View scorecard. */
export type ReportRating = {
  /** "Business Quality", "Balance Sheet", "Current Momentum". */
  label: string;
  /** "Strong", "Neutral", "Weak", "Improving", "Stable", "Weakening". */
  value: string;
  /** Optional one-line justification. */
  note?: string | null;
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
  /**
   * The signed move, so the renderer can colour the cover's hero card by
   * direction.
   *
   * Carried on the document rather than parsed out of the cover headline, which
   * would mean reading "Rise"/"Fall" out of prose the model wrote. Optional
   * because documents stored before this existed do not have it — the renderer
   * falls back to the house navy rather than guessing a direction.
   */
  movePct?: number | null;
  pages: ReportPage[];
};

/** Page kinds the model is allowed to emit. `disclaimer` is not one of them. */
export const REPORT_PAGE_KINDS = [
  "cover",
  "narrative",
  "kpis",
  "entities",
  "chart",
  "market-vs-reality",
  "comparison",
  "management",
  "risks",
  "vitti-view",
  "outlook",
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

/**
 * How many content pages a report should run to.
 *
 * Instruction 22 sets the house length at roughly four to six content sections
 * plus a closing page, which with the cover is six to eight. Nine is the ceiling
 * rather than eight because the analyst-first pages added for instructions
 * 28-35 — market-vs-reality, the comparison, the Vitti View — replace prose
 * rather than adding to it, and a company with both a result and a transaction
 * to explain legitimately needs the extra sheet. Above that it is padding, which
 * the same instruction rules out.
 */
export const REPORT_PAGE_TARGET = { min: 6, max: 9 } as const;

/**
 * The house sign-off (instruction 37), appended by the renderer.
 *
 * Out of the schema for the same reason as the disclaimer: it is fixed text,
 * and a model asked to end on a set phrase will paraphrase it about one time in
 * five. Appending it means it is either exactly right or absent, never
 * "That is where things stand today."
 */
export const CLOSING_SIGN_OFF = "That's where the story stands today.";

/** Heading above the management question (instruction 34), wherever it appears. */
export const MANAGEMENT_QUESTION_HEADING = "Question for management";

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

  /**
   * Instruction 17: every report carries real risks. This is the one editorial
   * rule enforced structurally, because a missing risks page is the failure that
   * turns explanatory research into promotional material — the reputational
   * problem, not merely a thin note.
   */
  if (!doc.pages.some((page) => page.kind === "risks")) {
    problems.push("report has no risks page");
  }

  /** Instruction 32: a chart without its conclusion is decoration. */
  for (const [index, page] of doc.pages.entries()) {
    if (page.kind !== "chart") continue;
    if (!page.conclusion?.trim()) {
      problems.push(`chart on page ${index + 1} has no conclusion line`);
    }
    if (page.chart.points.length < 2) {
      problems.push(`chart on page ${index + 1} has fewer than two points`);
    }
  }

  if (doc.pages.length < REPORT_PAGE_TARGET.min) {
    problems.push(
      `report is ${doc.pages.length} pages, below the ${REPORT_PAGE_TARGET.min}-page minimum`,
    );
  }

  return problems;
}
