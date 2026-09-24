import {
  REPORT_LIMITS,
  REPORT_PAGE_TARGET,
  type ReportCallout,
  type ReportPage,
  type SnapshotChart,
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
 * Every character budget on the snapshot, in one place.
 *
 * These are what the fixed grid lays out: a clause is one line at the column
 * measure, a timeline step two lines in its sixth of the band, and so on. They
 * are enforced twice. `snapshotOverruns` finds the lines over budget so the
 * pipeline can have the model rewrite them whole (`shortenOverruns` in
 * `mover-draft.ts`), and the fitter below cuts only what that pass left —
 * because a line cut to fit ends "...via Transaction Process…", and that is
 * a sentence nobody wrote.
 */
export const SNAPSHOT_CAPS = {
  clause: 76,
  timelineStep: 62,
  riskLabel: 42,
  riskText: 84,
  pullQuote: 158,
  sourceNote: REPORT_LIMITS.sourceNoteChars,
  chartTitle: 68,
  chartNote: 46,
  chartFootnote: 92,
  seriesName: 22,
  pointLabel: 10,
} as const;

/**
 * Where the rewrite pass aims tighter than the fitter cuts.
 *
 * A headline is never cut (the renderer sets a long one smaller), so its only
 * budget is this one: past 90 characters it is a headline that says three
 * things, and the desk wants one. Chart titles likewise read as a label, not
 * a sentence, well before the 68 characters the card can physically hold.
 */
export const SNAPSHOT_TARGETS = {
  headline: 90,
  chartTitle: 56,
} as const;

/** One line over its budget, addressed so a rewrite can be put back. */
export type SnapshotOverrun = {
  /** "whyItMoved.0", "timeline.2", "risks.1.text", "chart.title"... */
  id: string;
  /** What the line is, for the rewrite prompt: "timeline step". */
  what: string;
  text: string;
  max: number;
};

type SnapshotPage = Extract<ReportPage, { kind: "snapshot" }>;

/**
 * The lines on each snapshot that are over their budget. Only the items the
 * fitter would keep are checked: a fourth risk is dropped whole, so rewriting
 * it would be wasted.
 */
export function snapshotOverruns(pages: ReportPage[]): SnapshotOverrun[] {
  const out: SnapshotOverrun[] = [];
  const check = (id: string, what: string, text: string | null | undefined, max: number) => {
    const value = text?.trim() ?? "";
    if (value.length > max) out.push({ id, what, text: value, max });
  };

  const page = pages.find((p): p is SnapshotPage => p.kind === "snapshot");
  if (!page) return out;

  check("headline", "headline", page.headline, SNAPSHOT_TARGETS.headline);
  page.whyItMoved.slice(0, 3).forEach((item, i) =>
    check(`whyItMoved.${i}`, "'why it moved' clause", item, SNAPSHOT_CAPS.clause),
  );
  page.whatChangesNow.slice(0, 4).forEach((item, i) =>
    check(`whatChangesNow.${i}`, "'what changes now' clause", item, SNAPSHOT_CAPS.clause),
  );
  page.timeline.slice(0, 6).forEach((event, i) =>
    check(`timeline.${i}`, "timeline step", event.text, SNAPSHOT_CAPS.timelineStep),
  );
  page.risks.slice(0, 3).forEach((risk, i) => {
    check(`risks.${i}.label`, "risk card label", risk.label, SNAPSHOT_CAPS.riskLabel);
    check(`risks.${i}.text`, "risk card explanation", risk.text, SNAPSHOT_CAPS.riskText);
  });
  check("pullQuote", "closing Vitti view line", page.pullQuote, SNAPSHOT_CAPS.pullQuote);
  check("sourceNote", "source line", page.sourceNote, SNAPSHOT_CAPS.sourceNote);
  if (page.chart) {
    check("chart.title", "chart title", page.chart.title, SNAPSHOT_TARGETS.chartTitle);
    check("chart.note", "chart note", page.chart.note, SNAPSHOT_CAPS.chartNote);
    check("chart.footnote", "chart footnote", page.chart.footnote, SNAPSHOT_CAPS.chartFootnote);
    page.chart.series.slice(0, 2).forEach((series, i) =>
      check(`chart.series.${i}`, "chart legend name", series.name, SNAPSHOT_CAPS.seriesName),
    );
  }
  return out;
}

/** `snapshotOverruns` addresses, with their rewritten text put back. */
export function applySnapshotRewrites(
  pages: ReportPage[],
  rewrites: Record<string, string>,
): ReportPage[] {
  const pick = (id: string, fallback: string) => rewrites[id] ?? fallback;
  return pages.map((page) => {
    if (page.kind !== "snapshot") return page;
    return {
      ...page,
      headline: pick("headline", page.headline),
      whyItMoved: page.whyItMoved.map((item, i) => pick(`whyItMoved.${i}`, item)),
      whatChangesNow: page.whatChangesNow.map((item, i) => pick(`whatChangesNow.${i}`, item)),
      timeline: page.timeline.map((event, i) => ({ ...event, text: pick(`timeline.${i}`, event.text) })),
      risks: page.risks.map((risk, i) => ({
        ...risk,
        label: pick(`risks.${i}.label`, risk.label),
        text: pick(`risks.${i}.text`, risk.text),
      })),
      pullQuote: pick("pullQuote", page.pullQuote),
      sourceNote: page.sourceNote == null ? page.sourceNote : pick("sourceNote", page.sourceNote),
      chart: page.chart
        ? {
            ...page.chart,
            title: pick("chart.title", page.chart.title),
            note: page.chart.note == null ? page.chart.note : pick("chart.note", page.chart.note),
            footnote:
              page.chart.footnote == null ? page.chart.footnote : pick("chart.footnote", page.chart.footnote),
            series: page.chart.series.map((series, i) => ({
              ...series,
              name: pick(`chart.series.${i}`, series.name),
            })),
          }
        : page.chart,
    };
  });
}

/**
 * A category label that names a period: "FY26", "1Q27", "2H25", "Q3 FY26",
 * "Jul-26", "Sep 2026", "2025". Anything else ("Seed", "Series A",
 * "Australia") is a separate amount, not a point in time.
 */
const PERIOD_LABEL =
  /^((FY|CY)\s?'?\d{2,4}|[1-4]Q\s?(FY)?\d{2,4}|Q[1-4](\s?(FY)?\s?'?\d{2,4})?|[12]H\s?(FY)?\d{2,4}|H[12](\s?(FY)?\s?'?\d{2,4})?|[A-Z][a-z]{2,8}[-\s']?'?\d{2,4}|\d{4})$/i;

function fitSnapshotChart(chart: SnapshotChart, trim: Trimmer): SnapshotChart {
  const series = chart.series.slice(0, 2);
  /**
   * A series through time is a line, whatever the model asked for.
   *
   * The prompt names line as the house default and the model still sent
   * OFX's quarterly NOI (1Q26, 4Q26, 1Q27) as three big columns on
   * 24 September 2026. So the fitter decides from the labels: columns only
   * survive for amounts that are not periods, such as capital by round.
   */
  const labels = series[0]?.points.map((point) => point.label.trim()) ?? [];
  const periodic = labels.length > 0 && labels.every((label) => PERIOD_LABEL.test(label));
  const form = chart.form === "columns" && !periodic ? "columns" : "line";
  if (chart.form === "columns" && form === "line") {
    trim.notes.push("chart drawn as a line: its categories are periods");
  }
  const cap =
    form === "line"
      ? REPORT_LIMITS.snapshotLinePoints
      : series.length > 1
        ? REPORT_LIMITS.snapshotPairedColumnPoints
        : REPORT_LIMITS.snapshotColumnPoints;

  return {
    ...chart,
    form,
    title: trim.text(chart.title, SNAPSHOT_CAPS.chartTitle, "chart title"),
    note: trim.maybe(chart.note, SNAPSHOT_CAPS.chartNote, "chart note"),
    footnote: trim.maybe(chart.footnote, SNAPSHOT_CAPS.chartFootnote, "chart footnote"),
    series: series.map((s) => {
      if (s.points.length > cap) {
        trim.notes.push(`chart points cut from ${s.points.length} to the latest ${cap}`);
      }
      return {
        ...s,
        name: trim.text(s.name, SNAPSHOT_CAPS.seriesName, "series name"),
        // The series runs oldest first and ends on the period that matters,
        // so a cut drops the oldest points rather than today's.
        points: s.points.slice(-cap).map((point) => ({
          ...point,
          label: trim.text(point.label, SNAPSHOT_CAPS.pointLabel, "chart label"),
        })),
      };
    }),
  };
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
      // Not a layout cap any more: the renderer sets a long headline smaller
      // rather than cutting it (see `headlineSize`). This only stops a runaway.
      headline: trim.text(page.headline, 170, "snapshot headline"),
      kpis: page.kpis.slice(0, 4),
      whyItMoved: page.whyItMoved
        .slice(0, 3)
        .map((item) => trim.text(item, SNAPSHOT_CAPS.clause, "why it moved")),
      whatChangesNow: page.whatChangesNow
        .slice(0, 4)
        .map((item) => trim.text(item, SNAPSHOT_CAPS.clause, "what changes now")),
      /**
       * Two series, and a category count set by the form.
       *
       * Columns print a figure over every bar, and the band's width carries
       * eight before those collide — so four categories with two series, five
       * with one. A
       * line prints figures only at its ends and can run to twelve, but one
       * shorter than six is drawn as columns, because that is what it reads
       * better as. The fitter enforces both rather than trusting the prompt.
       * Every series is cut to the same count, because a second series with
       * five points against the first's four would draw its extra column over
       * the axis.
       */
      chart: page.chart ? fitSnapshotChart(page.chart, trim) : null,
      timeline: page.timeline.slice(0, 6).map((event) => ({
        ...event,
        text: trim.text(event.text, SNAPSHOT_CAPS.timelineStep, "timeline step"),
      })),
      risks: page.risks.slice(0, 3).map((risk) => ({
        ...risk,
        label: trim.text(risk.label, SNAPSHOT_CAPS.riskLabel, "risk label"),
        text: trim.text(risk.text, SNAPSHOT_CAPS.riskText, "risk detail"),
      })),
      pullQuote: trim.text(page.pullQuote, SNAPSHOT_CAPS.pullQuote, "pull quote"),
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
