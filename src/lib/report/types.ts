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
  /**
   * Optional mark from `REPORT_ICONS`, drawn in a disc above the label.
   *
   * Used on the risks grid, where the deck gives every card an icon: six
   * outlined cards of identical text are a wall, and the mark is what makes the
   * page scannable in the two seconds it gets.
   */
  icon?: string | null;
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
  /**
   * The plotted magnitude. Signed — negatives plot below the baseline.
   *
   * On a `waterfall` this is the step itself, not the running total: the cash
   * build-up "start $122M, +$453M proceeds, -$88M dividend" is 122, 453, -88,
   * and the renderer does the stacking.
   */
  value: number;
  /** How the figure prints. Falls back to the raw value. */
  display?: string | null;
  /** Draws this point in the accent colour: the one the conclusion is about. */
  highlight?: boolean;
  /**
   * `waterfall` only: this bar is a total rather than a step.
   *
   * A waterfall reads as "where it started, what moved it, where it ends", so
   * the two ends sit on the baseline as solid columns and the steps float
   * between them. Without the flag the renderer would stack the closing total
   * on top of the steps that produced it and print it at twice its value.
   */
  isTotal?: boolean;
};

/**
 * A chart, in the three forms the page has room for.
 *
 * `columns` is the trend — quarterly growth, margin by half, production by
 * period — and reads left to right as time. `bars` is the comparison, where the
 * labels are names rather than dates and are too long to sit under a column.
 * `waterfall` is the build-up: a starting figure, the things that add to or
 * subtract from it, and what is left. The desk asked for it by name after the
 * St Barbara note plotted an $880 million cash balance as a single column and
 * left the reader to work out what it was made of and what is already spoken
 * for — the shape of that answer is a waterfall, not a bar.
 *
 * Deliberately not a general charting layer. Instruction 32 asks for charts that
 * carry an insight, and every insight the desk has needed is one series of
 * labelled magnitudes with a conclusion under it. A second series, a secondary
 * axis or a scatter would all be new ways for a model to produce a chart nobody
 * can read.
 */
export type ReportChart = {
  type: "columns" | "bars" | "waterfall";
  points: ReportChartPoint[];
  /** Optional axis note: "% change on prior corresponding period". */
  unit?: string | null;
};

/**
 * The small vector marks the deck uses to make a page scannable.
 *
 * Names, not glyphs: the renderer draws each one as a path, so the model picks
 * a meaning ("cash", "regulation") and never a character that may not exist in
 * the embedded font. Shared with the tool schema as an enum, which is what
 * stops a page asking for an icon the renderer has no drawing for.
 *
 * Deliberately a short list of business meanings rather than a general icon
 * set. Sixteen marks a reader can tell apart at 9pt on a dark ground beats
 * forty that all read as "a small grey shape".
 */
export const REPORT_ICONS = [
  "cash",
  "chart",
  "plant",
  "mine",
  "resource",
  "contract",
  "regulation",
  "trial",
  "supply",
  "operations",
  "announcement",
  "done",
  "warning",
  "timing",
  "people",
  "geography",
] as const;

export type ReportIcon = (typeof REPORT_ICONS)[number];

/** One dated step on a `timeline` page. */
export type ReportTimelineEvent = {
  /** "26 May 2025", "Jun 2026 Qtr", "Dec 2024" — as the filing dates it. */
  date: string;
  /** What happened, in one line. */
  text: string;
  /** Optional mark, from `REPORT_ICONS`. */
  icon?: string | null;
};

/**
 * Every page carries the same optional provenance line.
 *
 * `sourceNote` is what the desk asked for after the St Barbara note: the
 * figures on a page are checkable only if the page says which filing they came
 * from, and a reviewer should not have to open five PDFs to find out. It prints
 * small under the content — "Source: Simberi Transaction Presentation, ASX
 * 10 Sep 2026" — and it is the writer's own audit trail as much as the
 * reader's, because a figure whose source cannot be named is usually a figure
 * that was not read anywhere.
 *
 * An `accent` field is deliberately absent: a page's colour comes from its
 * kind, in the renderer. A model choosing colours produces a document with no
 * code in it.
 */
type PageCommon = {
  /** "Source: FY26 Financial Results, ASX 28 Aug 2026; exchange feed." */
  sourceNote?: string | null;
};

export type ReportPage = PageCommon &
  (
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
        /** One line under the hero cards: the single fact behind the move. */
        intro?: string | null;
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
        /** The one-line read on the cards, set in the accent under them. */
        conclusion?: string | null;
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
     * The conclusion is required, not optional. A chart without it is
     * decoration, which is the thing instruction 32 rules out.
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
     * The three-way split of instruction 28: what was announced, what the
     * market actually reacted to, and the thing that decides the story from
     * here.
     *
     * Its own page kind rather than three callouts because the gap between the
     * headline and the reaction is the whole point of a Daily Mover on a day
     * when a record result sells off, and a fixed three-block layout is what
     * stops it being written as another narrative page.
     */
    | {
        kind: "market-vs-reality";
        title: string;
        headline: string;
        marketFocus: string;
        whatMatters: string;
      }
    /**
     * "What changed since the last update" (29) and "expectations vs actual"
     * (30) are the same shape: a metric, two figures, and the delta between
     * them. `columns` names what the two figures are, so one layout serves
     * both.
     *
     * It is also how a transaction gets weighed: ["Metric", "What SBM
     * Receives", "What SBM Gives Up"] is a comparison, and the desk's standing
     * complaint about deal notes is that they print only the first column.
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
     * How the story got here: the dated steps, in order.
     *
     * The desk publishes this as a row of marks along a rule, and it does a job
     * no paragraph does — it separates what has already happened from what is
     * merely agreed, which is exactly where the St Barbara draft went wrong
     * when it described a sale that had not completed as though it had. A date
     * against each step makes that distinction unavoidable.
     */
    | {
        kind: "timeline";
        title: string;
        intro?: string | null;
        events: ReportTimelineEvent[];
        conclusion?: string | null;
      }
    /**
     * Who runs the company, and what has changed at the top.
     *
     * A PM meeting a name for the first time asks who is running it and whether
     * they own any of it, and the answer changes how the rest of the report
     * reads: a turnaround under a chief executive appointed four months ago is
     * a different proposition from the same turnaround under a fifteen-year
     * founder. Board and executive churn is also a risk in its own right —
     * three CFOs in two years is a finding, not a footnote.
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
        /** Optional headings, when "improve/worsen" is not what the two lists are. */
        columns?: [string, string] | null;
        conclusion?: string | null;
      }
    /**
     * "Where the Story Stands": a few standalone statements, then the by-line.
     *
     * `signOff` is not a field — the renderer appends the house line verbatim,
     * for the same reason the disclaimer is not in the schema.
     */
    | {
        kind: "closing";
        title: string;
        statements: string[];
        /** The line the deck sets as a pull quote above the sign-off. */
        pullQuote?: string | null;
        /** Instruction 34, when it hasn't already been asked on the Vitti View page. */
        managementQuestion?: string | null;
      }
  );

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
  "timeline",
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
 * How many sheets the finished PDF is allowed to run to.
 *
 * Six, and six means six in the file a client opens — the compliance page is a
 * sheet like any other, so it comes out of the same budget rather than sitting
 * outside it. That leaves five content pages.
 *
 * It was eight until the desk reviewed the St Barbara note of 10 September
 * 2026. That one ran to eleven sheets, with the dividend, the buy-back, deal
 * completion and project execution each restated on three or four of them, and
 * the verdict was that a Daily Mover is read in about a minute: four or five
 * pages is where it should land. So the ceiling came down and the page shapes
 * in the prompt were rewritten around it, rather than left to be squeezed.
 */
export const REPORT_MAX_SHEETS = 6;

/**
 * How many content pages a report should run to.
 *
 * `max` is `REPORT_MAX_SHEETS - 1`: the renderer appends the disclaimer, and
 * that sheet is counted. Earlier ceilings of nine and then seven content pages
 * were both set by what would fit rather than by what anyone wanted to read —
 * and with no length budget on the blocks, a page carrying four long paragraphs
 * and three callouts wrapped onto a second sheet, so the count a reader saw was
 * not the count anyone had chosen. `REPORT_LIMITS` fixes the second half of
 * that; this fixes the first.
 *
 * `min` is four because four pages is a complete note in this format: the
 * cover, what happened and what it is worth, the risks, and where the story
 * stands. The pages that carry the most argument per word — the comparison, the
 * waterfall, market-vs-reality — are also the most compact, so a tight report
 * is a better report rather than a thinner one. A thin day should produce a
 * short honest note, not a padded one.
 */
export const REPORT_PAGE_TARGET = { min: 4, max: REPORT_MAX_SHEETS - 1 } as const;

/**
 * The per-block length budget, in characters.
 *
 * These exist because "one idea per page" is a layout promise, and the layout
 * only keeps it if the text fits. An A4 sheet at the template's metrics gives
 * about 650pt of body height once the eyebrow, heading and footer are taken
 * out; at 10.5pt on a 1.5 line height that is roughly 41 lines, and at the
 * page's measure roughly 100 characters a line — call it 4,000 characters of
 * plain prose before react-pdf wraps the page onto a second sheet and the
 * document quietly grows.
 *
 * So every page kind is budgeted well inside that, and the budget is enforced
 * twice: as `maxLength`/`maxItems` in the tool schema, so the model writes to
 * length rather than being cut, and again in `normalisePage`, which trims at a
 * sentence boundary if it overruns anyway. The schema alone is not enough —
 * models treat `maxLength` on a nested string as advice.
 *
 * The numbers are deliberately generous against the prompt's own word counts
 * (the prompt asks for ~55 words a paragraph; the trim fires at ~400
 * characters, about 65). The trim is a guard rail, not the editor: a report
 * where it fires on every paragraph is a prompt problem, and it logs so.
 */
export const REPORT_LIMITS = {
  /** 'narrative': three paragraphs of about 55 words is a full page with air. */
  paragraphs: 3,
  paragraphChars: 400,
  /** The framing line under a heading. One sentence, not a first paragraph. */
  introChars: 240,
  /** Callouts sit under the body, so they are budgeted tighter than it. */
  callouts: 3,
  calloutChars: 240,
  /**
   * 'kpis': six cards is two rows of three, which is the deck layout and the
   * answer to the review note that these reports carry too few numbers. The note
   * under a card is one line.
   */
  kpis: 6,
  kpiNoteChars: 90,
  noteChars: 170,
  notes: 2,
  /** 'entities': five named blocks at three lines each. */
  entities: 5,
  entityCommentChars: 150,
  /** 'risks': six fills two rows of three in the deck grid. */
  risks: 6,
  riskChars: 240,
  /** 'market-vs-reality': three blocks, each a short paragraph. */
  mvrChars: 300,
  /** 'comparison': past six rows the table stops being scannable. */
  comparisonRows: 6,
  conclusionChars: 220,
  /** 'chart': eight columns is the most that stays legible at the measure. */
  chartPoints: 8,
  /** 'management': the people who actually run it, not the whole board. */
  people: 4,
  personNoteChars: 140,
  changes: 4,
  changeChars: 160,
  /** 'vitti-view'. */
  ratings: 4,
  ratingNoteChars: 90,
  debateChars: 260,
  /** 'outlook': two columns, so each item is a half-measure line or two. */
  outlookItems: 4,
  outlookItemChars: 150,
  /** 'closing': four statements, each set large — they need to be short. */
  statements: 4,
  statementChars: 200,
  /** The question for management. One sentence. */
  questionChars: 240,
  /** Headings and labels, which are set large or letter-spaced. */
  titleChars: 80,
  labelChars: 40,
  /**
   * The provenance line under a page. Two filings named with their dates fit;
   * a third is a sign the page is carrying more than one idea.
   */
  sourceNoteChars: 180,
  /**
   * 'timeline': eight marks along the rule, each caption a line or two. Past
   * eight the captions collide at this measure.
   */
  timelineEvents: 8,
  timelineDateChars: 24,
  timelineTextChars: 120,
  /** 'closing': the pull quote the deck sets in the accent above the by-line. */
  pullQuoteChars: 220,
} as const;

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
    if (page.kind === "chart") {
      if (!page.conclusion?.trim()) {
        problems.push(`chart on page ${index + 1} has no conclusion line`);
      }
      if (page.chart.points.length < 2) {
        problems.push(`chart on page ${index + 1} has fewer than two points`);
      }
      /**
       * A waterfall whose steps are all totals is a column chart that has been
       * mislabelled, and it renders as a row of full-height bars with nothing
       * floating — which is worse than the column chart it should have been,
       * because the reader reads it as a build-up that does not build.
       */
      if (
        page.chart.type === "waterfall" &&
        page.chart.points.every((point) => point.isTotal)
      ) {
        problems.push(
          `waterfall on page ${index + 1} has no steps between its totals`,
        );
      }
    }
    if (page.kind === "timeline" && page.events.length < 2) {
      problems.push(`timeline on page ${index + 1} has fewer than two events`);
    }
  }

  if (doc.pages.length < REPORT_PAGE_TARGET.min) {
    problems.push(
      `report is ${doc.pages.length} pages, below the ${REPORT_PAGE_TARGET.min}-page minimum`,
    );
  }

  /**
   * The sheet ceiling, enforced rather than asked for.
   *
   * `fitReportPages` already trims an over-long report before it gets here, so
   * this failing means something bypassed it — which is worth a loud error,
   * because the one thing the desk asked for is a note that can be read in a
   * minute.
   */
  if (doc.pages.length > REPORT_PAGE_TARGET.max) {
    problems.push(
      `report is ${doc.pages.length} content pages, above the ` +
        `${REPORT_PAGE_TARGET.max}-page ceiling (${REPORT_MAX_SHEETS} sheets including the disclaimer)`,
    );
  }

  return problems;
}

/**
 * The label a page gets in the cover's contents rail and in the PDF outline.
 *
 * The cover has no title of its own, and the rail needs one line per page that
 * a reader can aim at, so the cover borrows the document's own name. Everything
 * else uses its heading, shortened — the headings are written as findings
 * ("Is the Balance Sheet a Problem?"), which is exactly what makes them good
 * navigation and occasionally too long for one line of it.
 */
export function pageNavLabel(page: ReportPage): string {
  if (page.kind === "cover") return "Overview";
  const title = page.title?.trim();
  if (!title) return page.kind;
  return title.length <= 48 ? title : `${title.slice(0, 47).trimEnd()}…`;
}

/** The PDF anchor a page is linked to: `#page-3`, targeted by the rail. */
export function pageAnchorId(index: number): string {
  return `page-${index + 1}`;
}
