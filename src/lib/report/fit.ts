import {
  REPORT_LIMITS,
  REPORT_PAGE_TARGET,
  type ReportCallout,
  type ReportPage,
} from "./types";

/**
 * The layout guard rail: what actually keeps a Daily Mover inside its sheet ceiling.
 *
 * The tool schema asks for the right lengths and the prompt explains why, and
 * between them they get it right most days. Neither is a guarantee. Models
 * treat `maxLength` on a nested string as a hint, and the failure mode is
 * invisible at the point it happens: an extra hundred words in one paragraph
 * does not look wrong in the JSON, it looks wrong three steps later as a report
 * that renders eleven sheets because four pages each spilled onto a second one.
 *
 * So the budget is enforced here as well, on the typed blocks, immediately
 * before they are stored. Two things happen:
 *
 * 1. Text over its budget is cut back to the last complete sentence inside it.
 *    Not an ellipsis mid-word — this is a client document, and a truncated
 *    figure ("revenue rose to $55.4 mil…") is worse than a paragraph that stops
 *    a sentence early.
 * 2. Lists over their budget are cut to length, keeping the front of the list,
 *    which is where a model puts the items it thinks matter most.
 *
 * Everything here is a last resort and it says so: the trims are logged,
 * because a report where the guard rail fires on every page is a prompt
 * problem, and the log is the only place that would be visible.
 *
 * Client-safe: it imports types and nothing else, so the review UI can show a
 * reviewer the same blocks the PDF is built from.
 */

/** How much of the budget a sentence-boundary cut is allowed to give up. */
const MIN_SENTENCE_FRACTION = 0.55;

/**
 * Cuts `text` to `max` characters, preferring the last sentence end.
 *
 * Falls back to a word-boundary cut with an ellipsis when there is no sentence
 * end late enough in the budget to use — a single 600-character sentence has no
 * good cut, and stopping mid-clause with a marker at least tells a reviewer
 * that something was removed.
 */
export function trimToLength(text: string, max: number): string {
  const value = text.trim();
  if (value.length <= max) return value;

  const window = value.slice(0, max);

  let sentenceEnd = -1;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const char = window[index];
    if (char !== "." && char !== "!" && char !== "?") continue;
    // A full stop inside "$55.4" is not a sentence end; one at the very end of
    // the window is.
    const next = window[index + 1];
    if (next === undefined || /\s/.test(next)) {
      sentenceEnd = index;
      break;
    }
  }

  if (sentenceEnd >= max * MIN_SENTENCE_FRACTION) {
    return window.slice(0, sentenceEnd + 1).trimEnd();
  }

  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > max * MIN_SENTENCE_FRACTION ? lastSpace : window.length;
  return `${window.slice(0, cut).trimEnd()}…`;
}

/** Trims and records, so the caller can log what the guard rail had to do. */
type Trimmer = {
  text: (value: string, max: number, what: string) => string;
  maybe: (
    value: string | null | undefined,
    max: number,
    what: string,
  ) => string | null;
  list: <T>(items: T[], max: number, what: string) => T[];
  /** What was cut on this report. Empty on one written to length. */
  readonly notes: string[];
};

function createTrimmer(): Trimmer {
  const notes: string[] = [];

  const text: Trimmer["text"] = (value, max, what) => {
    const trimmed = trimToLength(value, max);
    if (trimmed !== value.trim()) {
      notes.push(
        `${what} cut from ${value.trim().length} to ${trimmed.length} characters`,
      );
    }
    return trimmed;
  };

  return {
    notes,
    text,
    maybe: (value, max, what) => (value ? text(value, max, what) || null : null),
    list: (items, max, what) => {
      if (items.length <= max) return items;
      notes.push(`${what} cut from ${items.length} to ${max}`);
      return items.slice(0, max);
    },
  };
}

function fitCallouts(
  callouts: ReportCallout[],
  limit: number,
  trim: Trimmer,
): ReportCallout[] {
  return trim.list(callouts, limit, "callouts").map((callout) => ({
    ...callout,
    label: trim.text(callout.label, REPORT_LIMITS.labelChars, "callout label"),
    text: trim.text(callout.text, REPORT_LIMITS.calloutChars, "callout"),
  }));
}

/**
 * One page, cut to the budget in `REPORT_LIMITS`.
 *
 * The provenance line is trimmed here rather than in each branch: it is the one
 * field every page kind carries, and a "Source:" line that runs to three
 * filings is the same overflow as a fourth paragraph — it wraps and takes the
 * bottom of the page with it.
 */
function fitPage(page: ReportPage, trim: Trimmer): ReportPage {
  return {
    ...fitPageBody(page, trim),
    sourceNote: trim.maybe(
      page.sourceNote,
      REPORT_LIMITS.sourceNoteChars,
      "source note",
    ),
  };
}

/**
 * The body of a page, cut to the budget.
 *
 * The cover keeps everything but a runaway headline: it carries two cards and a
 * line of type, and its length was never the problem.
 */
function fitPageBody(page: ReportPage, trim: Trimmer): ReportPage {
  const intro =
    "intro" in page
      ? trim.maybe(page.intro, REPORT_LIMITS.introChars, "intro")
      : null;

  if (page.kind === "cover") {
    return {
      ...page,
      headline: trim.text(page.headline, 200, "cover headline"),
      kpis: page.kpis.slice(0, 2),
      intro,
    };
  }

  /**
   * The snapshot has no slack at all, so it is cut here rather than trusted.
   *
   * Every other page kind can afford a long list -- the deck simply gets a
   * denser page. This one is a fixed grid on a single 960x540 sheet: a fifth
   * timeline step or a fourth risk card does not make the page busier, it
   * pushes content off the bottom edge where nobody sees it go. The counts
   * below are what the published PIA sheet uses and what the renderer lays out.
   */
  if (page.kind === "snapshot") {
    return {
      ...page,
      headline: trim.text(page.headline, 96, "snapshot headline"),
      kpis: page.kpis.slice(0, 4),
      whyItMoved: page.whyItMoved
        .slice(0, 3)
        .map((item) => trim.text(item, 76, "why it moved")),
      whatChangesNow: page.whatChangesNow
        .slice(0, 4)
        .map((item) => trim.text(item, 76, "what changes now")),
      /**
       * The chart shares the timeline's slot, so it is capped just as hard.
       * Five columns is what the band's width carries with labels under them
       * that are still readable; a sixth makes every label wrap.
       */
      /**
       * Two series, four categories, and short labels.
       *
       * The band's width carries eight columns before the printed values start
       * colliding, so four categories is the ceiling with two series and the
       * fitter enforces it rather than trusting the count twice in the prompt.
       * Every series is cut to the same categories as the first, because a
       * second series with five points against the first's four would draw its
       * extra column over the axis.
       */
      chart: page.chart
        ? {
            ...page.chart,
            title: trim.text(page.chart.title, 68, "chart title"),
            note: trim.maybe(page.chart.note, 46, "chart note"),
            footnote: trim.maybe(page.chart.footnote, 92, "chart footnote"),
            series: page.chart.series.slice(0, 2).map((series) => ({
              name: trim.text(series.name, 22, "series name"),
              points: series.points.slice(0, 4).map((point) => ({
                ...point,
                label: trim.text(point.label, 10, "chart label"),
              })),
            })),
          }
        : null,
      timeline: page.timeline.slice(0, 6).map((event) => ({
        ...event,
        text: trim.text(event.text, 62, "timeline step"),
      })),
      risks: page.risks.slice(0, 3).map((risk) => ({
        ...risk,
        label: trim.text(risk.label, 42, "risk label"),
        text: trim.text(risk.text, 84, "risk detail"),
      })),
      pullQuote: trim.text(page.pullQuote, 158, "pull quote"),
      sourceNote: trim.maybe(page.sourceNote, 150, "source note"),
    };
  }

  const title = trim.text(page.title, REPORT_LIMITS.titleChars, "title");

  switch (page.kind) {
    case "narrative": {
      const paragraphs = trim
        .list(page.paragraphs, REPORT_LIMITS.paragraphs, "paragraphs")
        .map((paragraph) =>
          trim.text(paragraph, REPORT_LIMITS.paragraphChars, "paragraph"),
        );
      /**
       * Callouts share the page with the paragraphs, so the allowance depends
       * on whether there are any: three callouts under three full paragraphs is
       * the combination that overflows, and a callouts-only narrative page is a
       * perfectly good page.
       */
      const calloutLimit =
        paragraphs.length > 0 ? REPORT_LIMITS.callouts - 1 : REPORT_LIMITS.callouts;
      return {
        ...page,
        title,
        intro,
        paragraphs,
        callouts: fitCallouts(page.callouts ?? [], calloutLimit, trim),
      };
    }

    case "kpis":
      return {
        ...page,
        title,
        intro,
        kpis: trim.list(page.kpis, REPORT_LIMITS.kpis, "KPI cards").map((kpi) => ({
          ...kpi,
          note: trim.maybe(kpi.note, REPORT_LIMITS.kpiNoteChars, "KPI note"),
        })),
        notes: trim
          .list(page.notes ?? [], REPORT_LIMITS.notes, "notes")
          .map((note) => trim.text(note, REPORT_LIMITS.noteChars, "note")),
        callouts: fitCallouts(page.callouts ?? [], REPORT_LIMITS.callouts - 1, trim),
        conclusion: trim.maybe(
          page.conclusion,
          REPORT_LIMITS.conclusionChars,
          "KPI conclusion",
        ),
      };

    case "entities":
      return {
        ...page,
        title,
        intro,
        items: trim
          .list(page.items, REPORT_LIMITS.entities, "entities")
          .map((item) => ({
            ...item,
            comment: trim.maybe(
              item.comment,
              REPORT_LIMITS.entityCommentChars,
              "entity comment",
            ),
          })),
      };

    case "risks":
      return {
        ...page,
        title,
        items: trim.list(page.items, REPORT_LIMITS.risks, "risks").map((item) => ({
          ...item,
          label: trim.text(item.label, REPORT_LIMITS.labelChars, "risk label"),
          text: trim.text(item.text, REPORT_LIMITS.riskChars, "risk"),
        })),
      };

    case "chart":
      return {
        ...page,
        title,
        intro,
        chart: {
          ...page.chart,
          points: trim.list(
            page.chart.points,
            REPORT_LIMITS.chartPoints,
            "chart points",
          ),
        },
        conclusion: trim.text(
          page.conclusion,
          REPORT_LIMITS.conclusionChars,
          "chart conclusion",
        ),
        callouts: fitCallouts(page.callouts ?? [], 2, trim),
      };

    case "market-vs-reality":
      return {
        ...page,
        title,
        headline: trim.text(page.headline, REPORT_LIMITS.mvrChars, "headline block"),
        marketFocus: trim.text(
          page.marketFocus,
          REPORT_LIMITS.mvrChars,
          "market focus",
        ),
        whatMatters: trim.text(
          page.whatMatters,
          REPORT_LIMITS.mvrChars,
          "what matters",
        ),
      };

    case "comparison":
      return {
        ...page,
        title,
        intro,
        rows: trim
          .list(page.rows, REPORT_LIMITS.comparisonRows, "comparison rows")
          .map((row) => ({
            ...row,
            metric: trim.text(
              row.metric,
              REPORT_LIMITS.comparisonCellChars,
              "comparison metric",
            ),
            before: trim.text(
              row.before,
              REPORT_LIMITS.comparisonCellChars,
              "comparison cell",
            ),
            now: trim.text(
              row.now,
              REPORT_LIMITS.comparisonCellChars,
              "comparison cell",
            ),
            change: trim.text(
              row.change,
              REPORT_LIMITS.comparisonChangeChars,
              "comparison change",
            ),
          })),
        conclusion: trim.maybe(
          page.conclusion,
          REPORT_LIMITS.conclusionChars,
          "comparison conclusion",
        ),
      };

    case "timeline":
      return {
        ...page,
        title,
        intro,
        events: trim
          .list(page.events, REPORT_LIMITS.timelineEvents, "timeline events")
          .map((event) => ({
            ...event,
            date: trim.text(event.date, REPORT_LIMITS.timelineDateChars, "event date"),
            text: trim.text(event.text, REPORT_LIMITS.timelineTextChars, "event"),
          })),
        conclusion: trim.maybe(
          page.conclusion,
          REPORT_LIMITS.conclusionChars,
          "timeline conclusion",
        ),
      };

    case "management":
      return {
        ...page,
        title,
        intro,
        people: trim.list(page.people, REPORT_LIMITS.people, "people").map((person) => ({
          ...person,
          note: trim.maybe(person.note, REPORT_LIMITS.personNoteChars, "person note"),
        })),
        changes: trim
          .list(page.changes ?? [], REPORT_LIMITS.changes, "board changes")
          .map((change) =>
            trim.text(change, REPORT_LIMITS.changeChars, "board change"),
          ),
      };

    case "vitti-view":
      return {
        ...page,
        title,
        ratings: trim
          .list(page.ratings, REPORT_LIMITS.ratings, "ratings")
          .map((rating) => ({
            ...rating,
            note: trim.maybe(
              rating.note,
              REPORT_LIMITS.ratingNoteChars,
              "rating note",
            ),
          })),
        keyDebate: trim.text(page.keyDebate, REPORT_LIMITS.debateChars, "key debate"),
        nextCatalyst: trim.text(
          page.nextCatalyst,
          REPORT_LIMITS.debateChars,
          "next catalyst",
        ),
        managementQuestion: trim.maybe(
          page.managementQuestion,
          REPORT_LIMITS.questionChars,
          "management question",
        ),
      };

    case "outlook":
      return {
        ...page,
        title,
        intro,
        improve: trim
          .list(page.improve, REPORT_LIMITS.outlookItems, "outlook improvements")
          .map((item) =>
            trim.text(item, REPORT_LIMITS.outlookItemChars, "outlook item"),
          ),
        worsen: trim
          .list(page.worsen, REPORT_LIMITS.outlookItems, "outlook risks")
          .map((item) =>
            trim.text(item, REPORT_LIMITS.outlookItemChars, "outlook item"),
          ),
        conclusion: trim.maybe(
          page.conclusion,
          REPORT_LIMITS.conclusionChars,
          "outlook conclusion",
        ),
      };

    case "closing":
      return {
        ...page,
        title,
        statements: trim
          .list(page.statements, REPORT_LIMITS.statements, "closing statements")
          .map((statement) =>
            trim.text(statement, REPORT_LIMITS.statementChars, "closing statement"),
          ),
        pullQuote: trim.maybe(
          page.pullQuote,
          REPORT_LIMITS.pullQuoteChars,
          "closing pull quote",
        ),
        managementQuestion: trim.maybe(
          page.managementQuestion,
          REPORT_LIMITS.questionChars,
          "management question",
        ),
      };
  }
}

/**
 * Whether a page has to survive the cut when a report comes back over the
 * ceiling.
 *
 * The cover, the closing and the risks page are structural —
 * `validateReportDoc` fails without them. Everything else is dropped from the
 * BACK of the document rather than by kind: the house shape puts the story
 * first and the supporting material last, so the tail is where the model itself
 * put the page it was least sure about.
 */
function isStructural(page: ReportPage, index: number, total: number): boolean {
  if (index === 0 || index === total - 1) return true;
  return page.kind === "cover" || page.kind === "closing" || page.kind === "risks";
}

/**
 * Every page cut to its budget, and the document cut to the page ceiling.
 *
 * `label` only names the report in the log — the ticker, in practice.
 */
export function fitReportPages(pages: ReportPage[], label: string): ReportPage[] {
  const trim = createTrimmer();
  const fitted = pages.map((page) => fitPage(page, trim));

  if (trim.notes.length > 0) {
    console.warn(
      `draft ${label}: report ran over the page budget and was trimmed — ` +
        `${trim.notes.join("; ")}. Expected when re-fitting a draft written before ` +
        `the current caps; if it happens on FRESH drafts, the prompt's length rules ` +
        `(sections 10 and 13) are not landing and the numbers there should be cut ` +
        `rather than this trimmer relied on — it cuts mid-clause, which reads worse ` +
        `than a shorter sentence would have.`,
    );
  }

  if (fitted.length <= REPORT_PAGE_TARGET.max) return fitted;

  /**
   * Walk backwards over the droppable pages until the document fits. Recorded
   * as a set of indices so the survivors stay in their original order.
   */
  const dropped = new Set<number>();
  for (let index = fitted.length - 1; index >= 0; index -= 1) {
    if (fitted.length - dropped.size <= REPORT_PAGE_TARGET.max) break;
    if (isStructural(fitted[index], index, fitted.length)) continue;
    dropped.add(index);
  }

  if (dropped.size > 0) {
    const names = [...dropped]
      .sort((a, b) => a - b)
      .map((index) => `page ${index + 1} (${fitted[index].kind})`)
      .join(", ");
    console.warn(
      `draft ${label}: report came back ${fitted.length} pages, over the ` +
        `${REPORT_PAGE_TARGET.max}-page ceiling — dropped ${names}.`,
    );
  }

  return fitted.filter((_, index) => !dropped.has(index));
}
