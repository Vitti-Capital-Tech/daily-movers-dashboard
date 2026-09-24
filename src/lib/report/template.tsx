import type { ReactNode } from "react";
import type { Style } from "@react-pdf/stylesheet";

import {
  Circle,
  Document,
  Font,
  Image,
  Line,
  Page,
  Path,
  Polygon,
  Polyline,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";

import { VITTI_MARK_PNG, VITTI_MARK_RATIO } from "./logo";
import { layoutPriceBand, type PriceBandLayout } from "./price-band";
import {
  CLOSING_SIGN_OFF,
  DISCLAIMER_HEADING,
  DISCLAIMER_PARAGRAPHS,
  ONE_PAGE_DISCLAIMER,
  isSnapshotDoc,
  formatEyebrow,
  formatReportDate,
  MANAGEMENT_QUESTION_HEADING,
  type ReportCallout,
  type ReportChart,
  type ReportTimelineEvent,
  type SnapshotChart,
  type ReportChartPoint,
  type ReportComparisonRow,
  type ReportDoc,
  type ReportKpi,
  type ReportPage,
} from "./types";

/**
 * The Daily Mover PDF, as a react-pdf document.
 *
 * Why react-pdf rather than headless Chrome: the reports it replaces were made
 * in a design tool and exported, so there is no HTML original to reproduce
 * pixel-for-pixel — which is the only thing Chromium would buy. What matters is
 * the document rhythm (eyebrow, one idea per page, big-number cards, running
 * footer), and that is a component tree either way. This route adds no ~50 MB
 * Chromium binary, no cold-start penalty and no memory tuning, and Next.js
 * already treats `@react-pdf/renderer` as an external server package.
 *
 * ## Why it is a dark landscape deck
 *
 * It was an A4 portrait note on white until the desk compared a generated draft
 * against what it actually publishes. The published note — the Focus Minerals
 * report of 11 September 2026 — is a 16:9 slide deck on deep navy: a mint rule
 * top and bottom, the wordmark in the corner, a serif display line, and content
 * carried in tiles, icon rows, dated timelines and two-column splits. Next to
 * it the portrait draft read as a memo someone had typed, and a reader scanning
 * it on a laptop had to work to find the numbers.
 *
 * So the geometry, the palette and the components here are the deck. The
 * substance of a page is still decided by `ReportPage`, and the length budget
 * is still `REPORT_LIMITS` — this file only decides how a page looks.
 *
 * Fonts are the built-in Helvetica and Times rather than the deck's own faces.
 * Registering a downloaded font means react-pdf fetching a TTF over the network
 * at render time — a new failure mode on the critical path of a cron run. Times
 * is the closest built-in to the serif the deck sets its display lines in, and
 * it is what institutional research is set in anyway.
 */

/**
 * Hyphenation off, everywhere.
 *
 * react-pdf hyphenates by default, and in a narrow KPI card that produced
 * "A$215M" rendered as "~-" / "A$215M" across two lines, and ">6.0-MTPA". A
 * hyphen inserted into a financial figure is not a typographic blemish, it is
 * a wrong number on a client document — "6.0-MTPA" reads as a range. Returning
 * the word whole makes the layout do the adjusting instead.
 */
Font.registerHyphenationCallback((word) => [word]);

/**
 * The deck sheet: 960 x 540 points, which is 16:9.
 *
 * Not A4 landscape (842 x 595). The desk deck is 16:9, it is read on a screen
 * far more often than it is printed, and the extra width is what lets three
 * tiles sit in a row with air around them.
 */
const PAGE_SIZE: [number, number] = [960, 540];

/**
 * The one-pager is a taller sheet than the deck.
 *
 * Measured off what the desk publishes: the CVB snapshot of 18 September 2026 is
 * **1092 x 876**, where the earlier PIA sheet was 960 x 540. The desk moved to
 * the taller page for a reason that is obvious once both are open — the extra
 * 336pt is what a real chart needs, with an axis, a legend and two series, and
 * on 540pt there was never room for one.
 *
 * The deck keeps 960 x 540. Only the snapshot changes size, so stored multi-page
 * drafts still render exactly as they did.
 */
const SNAPSHOT_PAGE_SIZE: [number, number] = [1092, 876];

function pageSizeFor(doc: ReportDoc): [number, number] {
  return isSnapshotDoc(doc) ? SNAPSHOT_PAGE_SIZE : PAGE_SIZE;
}

const GUTTER = 46;
/** The dark band the footer sits in, and the mint hairline under it. */
const FOOTER_HEIGHT = 34;
const EDGE_RULE = 4;

/**
 * The document colour.
 *
 * Four working colours, and each one means something:
 *
 * 1. **Navy is the ground.** Everything sits on it, tiles are a lighter navy so
 *    they read as raised rather than outlined, and the footer band is darker so
 *    the page has a floor.
 * 2. **Mint is the house accent and it marks the finding.** The eyebrow, a
 *    section label, the highlighted tile, the conclusion band, the closing pull
 *    quote. If a reader follows only the mint, they get the argument.
 * 3. **Coral is the direction that hurts.** A fall, a risk, a step that takes
 *    cash out. Reserved for that — a coral tile anywhere else would read as a
 *    house view.
 * 4. **Cobalt is a fact without a verdict.** The second hero card, a neutral
 *    figure, the "before" column of a comparison.
 *
 * Body text is one off-white and one grey, and nothing else: coloured body copy
 * on a dark ground is what makes a slide look like a warning label.
 */
const PALETTE = {
  navy: "#0D1B2A",
  navyDeep: "#081320",
  card: "#14263C",
  cardSoft: "#1B3350",
  hairline: "#23405E",

  paper: "#FFFFFF",
  body: "#D7E0EA",
  muted: "#9FB2C6",
  faint: "#6F86A1",

  mint: "#2FE0A6",
  mintDeep: "#1B9C73",
  mintInk: "#052A1E",

  coral: "#E2574C",
  coralDeep: "#B03A31",

  cobalt: "#3355D8",

  /** Default chart bar: present, unemphasised, clearly not a verdict. */
  steel: "#5C7796",
  track: "#1B3350",
} as const;

/**
 * The deck's accent, decided by the direction of the move.
 *
 * A Daily Mover is about one thing before it is about anything else — the stock
 * went up, or it went down — and the desk asked for the document to carry that
 * before a word of it is read: **green on a rise, red on a fall**, with the
 * cobalt tile beside it either way. So the accent is not a house constant; it
 * is a property of the day, and everything that used to be mint now reads it
 * from here: the edges, the eyebrow, the heading rule, the conclusion band, the
 * timeline marks, the closing quote.
 *
 * Cobalt stays put in both. It is the colour for a fact without a verdict, and
 * a fact does not change direction with the share price.
 */
export type DeckTheme = {
  accent: string;
  accentDeep: string;
  /** Type colour on a filled accent panel. */
  accentInk: string;
};

const RISE: DeckTheme = {
  accent: PALETTE.mint,
  accentDeep: PALETTE.mintDeep,
  accentInk: PALETTE.mintInk,
};

const FALL: DeckTheme = {
  accent: PALETTE.coral,
  accentDeep: PALETTE.coralDeep,
  accentInk: "#2A0906",
};

function deckTheme(movePct?: number | null): DeckTheme {
  return (movePct ?? 0) < 0 ? FALL : RISE;
}

/**
 * The theme travels as a prop, not through React context.
 *
 * Context would be tidier, and Next.js will not have it: this module is
 * reachable from a Server Component — the cron route imports the renderer —
 * and `createContext` anywhere in that graph is a build error. A prop also does
 * not depend on which reconciler is running, which for a file rendered by
 * react-pdf rather than by the DOM is worth something on its own.
 */

/**
 * The accent a page is drawn in.
 *
 * Only risk pages leave the deck's accent, and only on a rising day: risk has a
 * direction a reader should feel before reading, and on a falling deck the two
 * colours would be the same anyway.
 */
function pageAccent(kind: ReportPage["kind"], theme: DeckTheme): string {
  return kind === "risks" ? PALETTE.coral : theme.accent;
}

/** The small chip above a heading, naming what kind of page this is. */
function pageKindLabel(kind: ReportPage["kind"]): string | null {
  switch (kind) {
    case "market-vs-reality":
      return "Announcement vs reaction";
    case "comparison":
      return "What changed";
    case "timeline":
      return "How it got here";
    case "chart":
      return "The numbers";
    case "kpis":
      return "The numbers";
    case "risks":
      return "Key risks";
    case "vitti-view":
      return "Vitti view";
    case "outlook":
      return "What to watch";
    case "management":
      return "Who runs it";
    default:
      return null;
  }
}

/**
 * The chart band's coordinate space.
 *
 * The sheet is 1092 wide with a 46pt gutter each side, so the band is 1000pt
 * across; 46 of that is the tick-label gutter.
 */
const SNAP_CHART_W = 1000;
const SNAP_AXIS_W = 46;
/** The numbered disc marking a timeline step on the price line. */
const PRICE_MARKER = 15;
/** The chart card: padding, the rotated unit, and the plot it leaves. */
const CARD_PAD_X = 16;
const CARD_PAD_Y = 9;
const CHART_UNIT_W = 16;
const CHART_RIGHT_PAD = 24;
const CHART_PLOT_H = 92;
const CARD_PLOT_W =
  SNAP_CHART_W - CARD_PAD_X * 2 - CHART_UNIT_W - SNAP_AXIS_W - CHART_RIGHT_PAD;


const styles = StyleSheet.create({
  page: {
    backgroundColor: PALETTE.navy,
    color: PALETTE.body,
    fontFamily: "Helvetica",
    fontSize: 10.5,
    paddingTop: 24,
    paddingBottom: FOOTER_HEIGHT + 18,
    paddingHorizontal: GUTTER,
    position: "relative",
  },

  edgeTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: EDGE_RULE,
    backgroundColor: PALETTE.mintDeep,
  },
  edgeBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: EDGE_RULE,
    backgroundColor: PALETTE.mintDeep,
  },

  chrome: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  eyebrow: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    letterSpacing: 2.6,
    color: PALETTE.mint,
  },
  lockup: { flexDirection: "row", alignItems: "center" },
  /**
   * The mark, at 26pt tall.
   *
   * Its ground was keyed out when the PNG was built, so it sits on the page
   * navy with no box around it — see `logo.ts`. Width comes from the generated
   * ratio rather than a hardcoded number, so a re-crop of the source cannot
   * silently stretch it.
   */
  mark: { height: 26, width: 26 * VITTI_MARK_RATIO },
  wordmark: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    letterSpacing: 0.4,
    color: PALETTE.paper,
  },
  wordmarkNote: {
    fontSize: 5.5,
    letterSpacing: 0.6,
    color: PALETTE.muted,
    marginTop: 1,
  },

  kindChip: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    letterSpacing: 1.8,
    marginBottom: 6,
  },
  heading: {
    fontFamily: "Times-Bold",
    fontSize: 32,
    lineHeight: 1.12,
    letterSpacing: -0.2,
    color: PALETTE.paper,
  },
  /** The short rule under a page heading. The cover has a longer one. */
  headingRule: {
    width: 54,
    height: 2,
    marginTop: 10,
  },
  intro: {
    fontSize: 12,
    lineHeight: 1.45,
    color: PALETTE.muted,
    marginTop: 8,
  },

  body: { flexGrow: 1, marginTop: 16 },
  /**
   * The same body, vertically centred.
   *
   * For the pages that are one visual block — a chart, a timeline, the cover —
   * top alignment leaves the block hanging under the heading with a third of the
   * sheet empty below it. Centring costs nothing and makes the page look
   * composed rather than unfinished.
   */
  bodyCentred: { flexGrow: 1, marginTop: 16, justifyContent: "center" },

  /**
   * The emphasis inside body copy.
   *
   * The desk asked for pages that read as a deck rather than as a page of
   * text, and the cheapest version of that is letting the figure inside a
   * sentence carry the weight the sentence is about: "$410 million on
   * completion" in white bold against grey body copy is found in a glance. The
   * model marks it with `**` and `Rich` renders it — see below for why the
   * markup is parsed rather than trusted.
   */
  strong: { fontFamily: "Helvetica-Bold", color: PALETTE.paper },

  paragraph: {
    fontSize: 12,
    lineHeight: 1.5,
    color: PALETTE.body,
    marginBottom: 8,
  },

  sectionLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    letterSpacing: 1.6,
    color: PALETTE.mint,
    marginBottom: 6,
  },
  rule: {
    height: 0.75,
    backgroundColor: PALETTE.hairline,
    marginBottom: 10,
  },

  /** Tiles ------------------------------------------------------------- */
  tileRow: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },
  tileCell: { paddingHorizontal: 6, marginBottom: 12, flexDirection: "column" },
  tile: {
    backgroundColor: PALETTE.card,
    borderWidth: 0.75,
    borderColor: PALETTE.hairline,
    borderStyle: "solid",
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexGrow: 1,
  },
  tileValue: {
    fontFamily: "Times-Bold",
    fontSize: 24,
    color: PALETTE.paper,
  },
  tileLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.4,
    color: PALETTE.body,
    marginTop: 6,
  },
  tileNote: {
    fontSize: 9.5,
    lineHeight: 1.35,
    color: PALETTE.muted,
    marginTop: 5,
  },

  /** Cover ------------------------------------------------------------- */
  coverName: {
    fontFamily: "Times-Bold",
    fontSize: 44,
    lineHeight: 1.08,
    color: PALETTE.paper,
  },
  coverHeadline: {
    fontSize: 15,
    lineHeight: 1.45,
    color: PALETTE.body,
    marginTop: 14,
  },
  coverRule: {
    width: 84,
    height: 2.5,
    backgroundColor: PALETTE.mint,
    marginTop: 16,
    marginBottom: 18,
  },
  coverNote: {
    fontSize: 10.5,
    lineHeight: 1.45,
    color: PALETTE.muted,
    marginTop: 14,
  },

  /** Callouts and bullets ---------------------------------------------- */
  callout: {
    borderLeftWidth: 2,
    borderLeftColor: PALETTE.mint,
    borderStyle: "solid",
    paddingLeft: 10,
    marginBottom: 9,
  },
  calloutLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.4,
    color: PALETTE.mint,
    marginBottom: 3,
  },
  calloutText: { fontSize: 11, lineHeight: 1.45, color: PALETTE.body },

  bulletRow: { flexDirection: "row", marginBottom: 7 },
  bulletMark: { color: PALETTE.mint, fontSize: 10, marginRight: 7 },
  bulletText: { fontSize: 11.5, lineHeight: 1.4, color: PALETTE.body, flex: 1 },

  /** The icon disc ----------------------------------------------------- */
  disc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  /** Charts ------------------------------------------------------------ */
  chartFrame: { marginTop: 4 },
  chartUnit: {
    fontSize: 8,
    letterSpacing: 0.6,
    color: PALETTE.faint,
    marginBottom: 8,
  },
  chartRow: { flexDirection: "row", alignItems: "flex-end" },
  chartCell: {
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 5,
  },
  /**
   * The drawn bar.
   *
   * Capped, because a four-point series across a 960pt sheet gives each column
   * 220 points of width and the chart stops reading as a chart — it reads as
   * four coloured panels. 148pt is about the width a column wants at this
   * height, and a longer series simply fills its cell as before.
   */
  bar: { width: "100%", maxWidth: 148 },
  chartBaseline: { height: 0.75, backgroundColor: PALETTE.hairline },
  chartValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: PALETTE.paper,
    textAlign: "center",
    marginTop: 6,
  },
  chartCategory: {
    fontSize: 8,
    color: PALETTE.muted,
    textAlign: "center",
    marginTop: 2,
  },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 9 },
  barLabel: {
    width: 150,
    fontSize: 9.5,
    color: PALETTE.body,
    paddingRight: 10,
  },
  barTrack: { flex: 1, height: 15, backgroundColor: PALETTE.track },
  barValue: {
    width: 76,
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    color: PALETTE.paper,
    textAlign: "right",
  },

  /** Comparison -------------------------------------------------------- */
  compHead: { flexDirection: "row", marginBottom: 6 },
  compHeadCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.4,
  },
  compRow: { flexDirection: "row", marginBottom: 5, alignItems: "stretch" },
  compMetric: {
    width: 150,
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    color: PALETTE.paper,
    paddingRight: 10,
    paddingTop: 8,
  },
  compBefore: {
    flex: 1,
    backgroundColor: PALETTE.card,
    paddingVertical: 7,
    paddingHorizontal: 11,
    marginRight: 8,
  },
  compNow: {
    flex: 1,
    borderWidth: 0.75,
    borderStyle: "solid",
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  compText: { fontSize: 10, lineHeight: 1.3 },
  compChangeCell: { width: 86, paddingLeft: 8, justifyContent: "center" },
  /**
   * The verdict, as a chip rather than a word.
   *
   * "Worse" set in coral type reads as a typo at 8.5pt; the same word in a
   * tinted pill reads as a label, which is what it is — and it gives the row a
   * right-hand edge, so a six-row table scans as a table.
   */
  compChip: {
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 6,
    alignSelf: "flex-end",
  },
  compChipText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 0.3,
    textAlign: "center",
  },

  /** Timeline ---------------------------------------------------------- */
  timelineRow: { flexDirection: "row", marginTop: 10 },
  timelineCell: { alignItems: "center", paddingHorizontal: 4 },
  timelineDate: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: PALETTE.mint,
    textAlign: "center",
    marginBottom: 8,
  },
  timelineText: {
    fontSize: 9.5,
    lineHeight: 1.35,
    color: PALETTE.body,
    textAlign: "center",
    marginTop: 8,
  },
  timelineTrack: {
    position: "absolute",
    left: 24,
    right: 24,
    height: 0.75,
    backgroundColor: PALETTE.hairline,
  },

  /** Bands, quotes, notes ---------------------------------------------- */
  band: {
    backgroundColor: PALETTE.mint,
    paddingVertical: 11,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  bandText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11.5,
    lineHeight: 1.4,
    color: PALETTE.mintInk,
  },
  quote: {
    fontFamily: "Times-BoldItalic",
    fontSize: 14,
    lineHeight: 1.4,
    color: PALETTE.mint,
  },
  question: {
    borderLeftWidth: 2,
    borderLeftColor: PALETTE.mint,
    borderStyle: "solid",
    paddingLeft: 10,
    marginTop: 12,
  },
  questionHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    letterSpacing: 1.6,
    color: PALETTE.mint,
    marginBottom: 3,
  },
  questionText: {
    fontSize: 10,
    lineHeight: 1.4,
    color: PALETTE.body,
    fontFamily: "Helvetica-Oblique",
  },
  /**
   * The provenance line, at the end of the page body.
   *
   * It was briefly positioned absolutely, to stop the case that produced it:
   * the SBM comparison page of 10 September 2026 ran about twenty points long
   * and put its source line — and nothing else — on a sheet of its own. That
   * fixed the spill and traded it for a worse failure, because a page that is
   * still slightly too tall then prints its content *underneath* the caption.
   *
   * So the caption stays in the flow, and the overflow is fixed where it was
   * actually caused: comparison cells now have a character budget
   * (`REPORT_LIMITS.comparisonCellChars`), rows are two points tighter, and
   * `renderReportPdf` counts the sheets it produced and says so in the log when
   * a page has wrapped. A spilled sheet is visible and rare; overlapping text
   * is neither.
   */
  source: {
    fontSize: 8,
    lineHeight: 1.35,
    color: PALETTE.faint,
    marginTop: 10,
  },

  /**
   * The snapshot body spreads, rather than stacking from the top.
   *
   * The bands are sized by their content, and the content does not reliably add
   * up to the sheet: the first NZK draft left 59pt — a ninth of the page —
   * sitting empty between the source line and the footer, which reads as an
   * unfinished slide rather than a composed one. `space-between` hands that
   * slack back to the gaps between bands instead of pooling it at the bottom,
   * so a short day's copy breathes and a long day's does not change at all.
   *
   * It is also why the heading trio is wrapped in its own View: without that,
   * the label, the company name and the headline would each be pushed apart by
   * the same distribution, and those three are one block.
   */
  snapBody: {
    flexGrow: 1,
    marginTop: 16,
    justifyContent: "space-between",
  },

  /** Snapshot (the one-page sheet) ------------------------------------- */
  /**
   * A fixed grid, not a flow.
   *
   * Every band below has a stated height and the sheet adds up to the 540pt
   * page on purpose: chrome and footer take roughly 110, leaving ~430 for
   * these. react-pdf will happily push a sixth timeline step past the bottom
   * edge without complaining, so the heights are the contract and `fit.ts`
   * cuts the content to match. Change one number here and check the preview.
   */
  snapLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11.6,
    letterSpacing: 2.4,
    color: PALETTE.faint,
    marginBottom: 3,
  },
  snapCompany: {
    fontFamily: "Helvetica",
    fontSize: 19.21,
    color: PALETTE.muted,
    marginBottom: 2,
  },
  snapHeadline: {
    fontFamily: "Times-Bold",
    fontSize: 27.5,
    lineHeight: 1.16,
    color: PALETTE.paper,
  },
  snapTileRow: { flexDirection: "row", marginTop: 12 },
  /**
   * Every tile carries a left edge; only the first one carries it in the
   * accent.
   *
   * The four tiles were identical, which made the sheet read as a grid of
   * equally important numbers — and one of them is not equally important. The
   * share move is the reason the page exists, so it gets the accent edge and
   * the accent figure while the other three stay white on navy. Giving all four
   * the same 3pt edge keeps their inner widths identical, so the hierarchy is
   * carried by colour alone rather than by the boxes drifting out of line.
   */
  snapTile: {
    flexGrow: 1,
    flexBasis: 0,
    backgroundColor: PALETTE.card,
    borderRadius: 5,
    borderLeftWidth: 3,
    borderLeftColor: PALETTE.cardSoft,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 8,
  },
  snapTileValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 26.13,
    color: PALETTE.paper,
  },
  snapTileLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9.22,
    letterSpacing: 1.5,
    color: PALETTE.faint,
    marginTop: 3,
  },
  snapColumns: { flexDirection: "row", marginTop: 10 },
  snapColumn: { flexGrow: 1, flexBasis: 0, marginRight: 14 },
  /**
   * A hairline between the columns.
   *
   * The two lists answer different questions and were separated only by a gap,
   * so at a glance they read as one list that had wrapped. The rule costs no
   * height and does the separating that the gap was failing to do.
   */
  snapColumnDivided: { paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: PALETTE.hairline },
  snapColHead: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11.53,
    letterSpacing: 2,
    marginBottom: 5,
  },
  snapItem: { flexDirection: "row", marginBottom: 3.5 },
  snapItemNum: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11.53,
    width: 11,
    marginTop: 0.6,
  },
  snapItemText: {
    flexGrow: 1,
    flexBasis: 0,
    fontSize: 13.06,
    lineHeight: 1.32,
    color: PALETTE.body,
  },
  snapBandHead: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11.53,
    letterSpacing: 2,
    marginTop: 9,
    marginBottom: 5,
  },
  /**
   * One continuous line, and no dots.
   *
   * It was a segmented rule with a dot per step, which is how the connector
   * started life and not how the desk draws it: the published CVB sheet runs a
   * single unbroken line across the band with the steps hanging off it. Dots
   * pull the eye to six separate points; the line says "this is one sequence"
   * before a word is read, which is the only job this band has.
   *
   * The line is absolutely positioned inside the track, so adding it costs no
   * height at all and the steps keep the padding they already had.
   */
  snapTrack: { flexDirection: "row", alignItems: "flex-start", position: "relative" },
  snapTrackLine: {
    position: "absolute",
    top: 3,
    left: 0,
    right: 0,
    height: 1.5,
  },
  snapStep: {
    flexGrow: 1,
    flexBasis: 0,
    paddingRight: 10,
    paddingTop: 11,
  },
  snapStepDate: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11.53,
    color: PALETTE.paper,
  },
  snapStepText: {
    fontSize: 11.53,
    lineHeight: 1.28,
    color: PALETTE.muted,
    marginTop: 1.5,
  },
  /** Chart card ------------------------------------------------------- */
  chartCard: {
    marginTop: 10,
    backgroundColor: PALETTE.navyDeep,
    borderWidth: 0.8,
    borderColor: PALETTE.hairline,
    borderRadius: 5,
    paddingHorizontal: CARD_PAD_X,
    paddingVertical: CARD_PAD_Y,
  },
  chartCardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 7,
  },
  chartCardTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12.3,
    letterSpacing: 1.6,
  },
  chartCardNote: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10.4,
    color: PALETTE.muted,
    marginLeft: 10,
  },
  chartCardRight: { flexShrink: 0 },
  chartCardUnit: {
    fontSize: 9.6,
    color: PALETTE.faint,
    width: CHART_PLOT_H,
    textAlign: "center",
    transform: "rotate(-90deg)",
  },
  chartCardFoot: {
    fontSize: 10.4,
    color: PALETTE.faint,
    marginTop: 6,
  },
  chartLegendItem: { flexDirection: "row", alignItems: "center", marginLeft: 16 },
  chartLegendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  chartLegendLabel: { fontFamily: "Helvetica-Bold", fontSize: 10.8, color: PALETTE.body },
  snapCategory: {
    flexGrow: 1,
    flexBasis: 0,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    fontSize: 11.2,
    color: PALETTE.body,
    marginTop: 6,
  },
  timelineDot: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  /** Price-and-events band ----------------------------------------------- */
  priceMarker: {
    position: "absolute",
    width: PRICE_MARKER,
    height: PRICE_MARKER,
    borderRadius: PRICE_MARKER / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  priceMarkerText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.6,
    color: PALETTE.navy,
  },
  priceMonth: {
    position: "absolute",
    top: 3,
    width: 60,
    textAlign: "center",
    fontSize: 10.2,
    color: PALETTE.muted,
  },
  /** Chart band ------------------------------------------------------- */
  snapChartHead: { marginBottom: 7 },
  snapChartTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12.32,
    letterSpacing: 1.6,
    color: PALETTE.muted,
  },
  snapChartNote: { fontFamily: "Helvetica-Bold", fontSize: 13.78, marginTop: 3 },
  snapChartLegend: { flexDirection: "row", marginTop: 5 },
  snapLegendItem: { flexDirection: "row", alignItems: "center", marginRight: 16 },
  snapLegendSwatch: { width: 9, height: 9, borderRadius: 2, marginRight: 5 },
  snapLegendLabel: { fontSize: 12.32, color: PALETTE.body },
  snapAxisLabel: {
    position: "absolute",
    right: 8,
    width: SNAP_AXIS_W - 8,
    textAlign: "right",
    fontSize: 10.88,
    color: PALETTE.faint,
  },
  snapGrid: { position: "absolute", left: 0, right: 0, height: 0.6 },
  snapChartValue: {
    position: "absolute",
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    fontSize: 11.02,
    color: PALETTE.paper,
  },
  snapChartLabel: {
    flexGrow: 1,
    flexBasis: 0,
    textAlign: "center",
    fontSize: 12.32,
    color: PALETTE.muted,
    marginTop: 6,
  },
  snapChartFoot: {
    fontSize: 10.44,
    color: PALETTE.faint,
    marginTop: 7,
    marginLeft: SNAP_AXIS_W,
  },

  snapRiskRow: { flexDirection: "row" },
  /** Coral edge, so the risk band is identifiable before it is read. */
  snapRisk: {
    flexGrow: 1,
    flexBasis: 0,
    backgroundColor: PALETTE.card,
    borderRadius: 5,
    borderLeftWidth: 3,
    borderLeftColor: PALETTE.coral,
    paddingVertical: 7,
    paddingHorizontal: 9,
    marginRight: 8,
  },
  snapRiskLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12.3,
    color: PALETTE.paper,
    marginBottom: 2.5,
  },
  snapRiskText: { fontSize: 11.53, lineHeight: 1.3, color: PALETTE.muted },
  /**
   * A left accent bar rather than a rule above.
   *
   * The rule read as a divider — the page ending — when the quote is the one
   * line of judgement on the sheet and should read as the conclusion. Moving
   * the mark to the left edge also hands back 11pt of height, which is most of
   * what the rest of this pass spends.
   */
  snapQuote: {
    marginTop: 11,
    paddingLeft: 12,
    borderLeftWidth: 3,
  },
  snapQuoteLead: { fontFamily: "Helvetica-Bold" },
  /**
   * Bigger than the deck's source line, and given room to breathe.
   *
   * At 8pt it was the smallest type on a sheet whose whole job is to be read at
   * a glance, and a long provenance line had nowhere to go. This is the line
   * that makes every figure on the sheet checkable, so it is set to be read.
   */
  snapSource: {
    fontSize: 12.32,
    lineHeight: 1.35,
    color: PALETTE.muted,
    marginTop: 8,
  },
  snapQuoteText: {
    fontFamily: "Times-Italic",
    fontSize: 16.14,
    lineHeight: 1.3,
    color: PALETTE.paper,
  },
  /** The compliance line, set small under the by-line on the one-pager. */
  snapDisclaimer: {
    fontSize: 7.5,
    lineHeight: 1.25,
    color: PALETTE.faint,
    marginTop: 1.5,
    maxWidth: 640,
  },

  /** Footer ------------------------------------------------------------ */
  footer: {
    position: "absolute",
    bottom: EDGE_RULE,
    left: 0,
    right: 0,
    height: FOOTER_HEIGHT,
    backgroundColor: PALETTE.navyDeep,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: GUTTER,
  },
  footerText: { fontSize: 8, color: PALETTE.muted },
  footerStrong: { fontFamily: "Helvetica-Bold", color: PALETTE.body },
  footerPage: { fontSize: 8, color: PALETTE.faint },

  /** Disclaimer -------------------------------------------------------- */
  /**
   * The compliance sheet, set to be read.
   *
   * It was 9.5pt across a 640pt measure on a 960pt sheet, which left two thirds
   * of the page empty and the one piece of regulated text in the document as
   * the smallest type in it. At 13pt over a wider measure it fills the sheet and
   * reads like part of the deck — which is what it is.
   */
  disclaimerHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    letterSpacing: 1.6,
    color: PALETTE.mint,
    marginBottom: 18,
  },
  disclaimerText: {
    fontSize: 13,
    lineHeight: 1.65,
    color: PALETTE.body,
    marginBottom: 16,
    maxWidth: 820,
  },
});

/**
 * The icon marks, drawn rather than set.
 *
 * Drawn because an icon font would have to be fetched at render time, and a
 * missing glyph on a client document is a blank square where a meaning was. Each
 * one is two or three primitives: at 13 points inside a disc, a recognisable
 * silhouette is all that survives anyway, and detail only muddies it.
 */
function IconGlyph({ name }: { name: string }) {
  const stroke = PALETTE.paper;
  switch (name) {
    case "cash":
      return (
        <>
          <Circle
            cx="7"
            cy="7"
            r="5"
            fill="none"
            stroke={stroke}
            strokeWidth={1.4}
          />
          <Line
            x1="7"
            y1="3.4"
            x2="7"
            y2="10.6"
            stroke={stroke}
            strokeWidth={1.4}
          />
        </>
      );
    case "chart":
      return (
        <>
          <Rect x="1.5" y="8" width="2.6" height="4.5" fill={stroke} />
          <Rect x="5.7" y="5" width="2.6" height="7.5" fill={stroke} />
          <Rect x="9.9" y="2" width="2.6" height="10.5" fill={stroke} />
        </>
      );
    case "plant":
      return (
        <>
          <Rect x="1.5" y="6.5" width="11" height="6" fill={stroke} />
          <Polygon points="1.5,6.5 5,4 5,6.5" fill={stroke} />
          <Rect x="8.5" y="1.5" width="2" height="5" fill={stroke} />
        </>
      );
    case "mine":
      return <Polygon points="7,2 12.5,12 1.5,12" fill={stroke} />;
    case "resource":
      return <Polygon points="7,1.8 12.2,6 7,12.2 1.8,6" fill={stroke} />;
    case "contract":
      return (
        <>
          <Rect
            x="2.5"
            y="1.5"
            width="9"
            height="11"
            fill="none"
            stroke={stroke}
            strokeWidth={1.2}
          />
          <Line
            x1="4.6"
            y1="5"
            x2="9.4"
            y2="5"
            stroke={stroke}
            strokeWidth={1.1}
          />
          <Line
            x1="4.6"
            y1="8"
            x2="9.4"
            y2="8"
            stroke={stroke}
            strokeWidth={1.1}
          />
        </>
      );
    case "regulation":
      return (
        <>
          <Line
            x1="7"
            y1="2"
            x2="7"
            y2="12"
            stroke={stroke}
            strokeWidth={1.3}
          />
          <Line
            x1="2.2"
            y1="4.4"
            x2="11.8"
            y2="4.4"
            stroke={stroke}
            strokeWidth={1.3}
          />
          <Polygon points="2.2,4.4 4.4,8.4 0,8.4" fill={stroke} />
          <Polygon points="11.8,4.4 14,8.4 9.6,8.4" fill={stroke} />
        </>
      );
    case "trial":
      return (
        <>
          <Path d="M5 2 L9 2 L9 5.5 L12 12 L2 12 L5 5.5 Z" fill={stroke} />
        </>
      );
    case "supply":
      return (
        <>
          <Rect x="1.5" y="4.5" width="7" height="5" fill={stroke} />
          <Polygon points="8.5,6 11.5,6 12.5,9.5 8.5,9.5" fill={stroke} />
          <Circle cx="4.2" cy="11" r="1.5" fill={stroke} />
          <Circle cx="10.4" cy="11" r="1.5" fill={stroke} />
        </>
      );
    case "operations":
      return (
        <>
          <Circle
            cx="7"
            cy="7"
            r="3.2"
            fill="none"
            stroke={stroke}
            strokeWidth={1.6}
          />
          <Rect x="6.2" y="0.6" width="1.6" height="3" fill={stroke} />
          <Rect x="6.2" y="10.4" width="1.6" height="3" fill={stroke} />
          <Rect x="0.6" y="6.2" width="3" height="1.6" fill={stroke} />
          <Rect x="10.4" y="6.2" width="3" height="1.6" fill={stroke} />
        </>
      );
    case "announcement":
      return (
        <>
          <Polygon points="2,5.5 8,2.5 8,11.5 2,8.5" fill={stroke} />
          <Rect x="8.8" y="5" width="3.4" height="4" fill={stroke} />
        </>
      );
    case "done":
      return (
        <Polyline
          points="2.2,7.4 5.6,10.6 11.8,3.6"
          fill="none"
          stroke={stroke}
          strokeWidth={1.8}
        />
      );
    case "warning":
      return (
        <>
          <Polygon points="7,1.6 13,12.4 1,12.4" fill={stroke} />
          <Rect
            x="6.3"
            y="5.4"
            width="1.4"
            height="3.6"
            fill={PALETTE.coralDeep}
          />
          <Rect
            x="6.3"
            y="9.8"
            width="1.4"
            height="1.4"
            fill={PALETTE.coralDeep}
          />
        </>
      );
    case "timing":
      return (
        <>
          <Circle
            cx="7"
            cy="7"
            r="5.2"
            fill="none"
            stroke={stroke}
            strokeWidth={1.3}
          />
          <Line
            x1="7"
            y1="4"
            x2="7"
            y2="7.4"
            stroke={stroke}
            strokeWidth={1.3}
          />
          <Line
            x1="7"
            y1="7.4"
            x2="9.6"
            y2="8.8"
            stroke={stroke}
            strokeWidth={1.3}
          />
        </>
      );
    case "people":
      return (
        <>
          <Circle cx="7" cy="4.6" r="2.4" fill={stroke} />
          <Path d="M1.8 12.4 C2.4 8.8 11.6 8.8 12.2 12.4 Z" fill={stroke} />
        </>
      );
    case "geography":
      return (
        <>
          <Circle
            cx="7"
            cy="7"
            r="5.2"
            fill="none"
            stroke={stroke}
            strokeWidth={1.3}
          />
          <Line
            x1="1.8"
            y1="7"
            x2="12.2"
            y2="7"
            stroke={stroke}
            strokeWidth={1.2}
          />
          <Path
            d="M7 1.8 C4 4.6 4 9.4 7 12.2 C10 9.4 10 4.6 7 1.8 Z"
            fill="none"
            stroke={stroke}
            strokeWidth={1.2}
          />
        </>
      );
    default:
      return <Circle cx="7" cy="7" r="3.2" fill={stroke} />;
  }
}

/** The icon in its coloured disc — mint by default, coral on a risks page. */
function IconDisc({
  name,
  tone,
  size = 26,
  theme,
}: {
  name?: string | null;
  tone?: string;
  size?: number;
  theme: DeckTheme;
}) {
  const disc = tone ?? theme.accentDeep;
  return (
    <View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: disc,
        },
      ]}
    >
      <Svg width={size * 0.54} height={size * 0.54} viewBox="0 0 14 14">
        <IconGlyph name={name ?? "done"} />
      </Svg>
    </View>
  );
}

/**
 * Body copy with `**figure**` emphasis resolved.
 *
 * The model is allowed to mark the one or two figures a block turns on, and
 * only those. The markup is *parsed*, never trusted: an unbalanced `**` — which
 * is what a length trim at a sentence boundary can leave behind — would
 * otherwise bold everything to the end of the page, so an odd number of markers
 * makes the whole string render plain with the markers stripped. A stray
 * asterisk on a client document is a smaller failure than half a page in bold,
 * and printing the literal `**` is not an option either way.
 */
function Rich({
  children,
  style,
  strongStyle = styles.strong,
}: {
  children?: string | null;
  style?: Style | Style[];
  strongStyle?: Style;
}) {
  const text = children?.trim() ?? "";
  if (!text) return null;

  const parts = text.split("**");
  // An even number of parts means an odd number of markers: unbalanced.
  if (parts.length % 2 === 0) {
    return <Text style={style}>{parts.join("")}</Text>;
  }

  return (
    <Text style={style}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Text key={index} style={strongStyle}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

/** How a point prints: its own `display`, or the raw number as a fallback. */
function pointLabel(value: number, display?: string | null): string {
  return display?.trim() || String(value);
}

/**
 * Sheets in the finished PDF.
 *
 * The deck adds a compliance sheet; the snapshot does not, because a one-page
 * report that prints as two pages is not a one-page report. Its compliance line
 * goes in the footer instead — see `ONE_PAGE_DISCLAIMER`, which is the desk's
 * own published short form and not an abbreviation invented here.
 */
function sheetCount(doc: ReportDoc): number {
  return isSnapshotDoc(doc) ? doc.pages.length : doc.pages.length + 1;
}

function Chrome({ doc, theme }: { doc: ReportDoc; theme: DeckTheme }) {
  return (
    <View style={styles.chrome}>
      <Text style={[styles.eyebrow, { color: theme.accent }]}>
        {formatEyebrow(doc.ticker)}
      </Text>
      <View style={styles.lockup}>
        {/* react-pdf primitive, not an HTML img — there is no alt attribute in
            the PDF object model, and the mark is decorative next to the
            wordmark that follows it. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={VITTI_MARK_PNG} style={styles.mark} />
        <View style={{ marginLeft: 8 }}>
          <Text style={styles.wordmark}>vitti.capital</Text>
          <Text style={styles.wordmarkNote}>Empowering Growth, Together</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * The running footer: the by-line, and the sheet counter.
 *
 * `fixed` so it repeats if react-pdf ever wraps a page onto a second sheet —
 * which the length budget exists to prevent, but a footerless orphan sheet is
 * the worst way to find out that it happened.
 */
function Footer({ doc, pageNumber }: { doc: ReportDoc; pageNumber: number }) {
  const snapshot = isSnapshotDoc(doc);
  return (
    <View style={styles.footer} fixed>
      <View>
        <Text style={styles.footerText}>
          <Text style={styles.footerStrong}>
            {snapshot ? "Daily Mover Snapshot" : "Daily Mover Report"}
          </Text>
          {`   |   ${formatReportDate(doc.moveDate)}   |   Analyst: ${doc.analystName}`}
        </Text>
        {snapshot ? (
          <Text style={styles.snapDisclaimer}>{ONE_PAGE_DISCLAIMER}</Text>
        ) : null}
      </View>
      <Text style={styles.footerPage}>
        {`${pageNumber} / ${sheetCount(doc)}`}
      </Text>
    </View>
  );
}

/** The sheet: the two mint edges, the chrome, the content, the footer. */
function Sheet({
  doc,
  pageNumber,
  children,
  theme,
}: {
  doc: ReportDoc;
  pageNumber: number;
  children: ReactNode;
  theme: DeckTheme;
}) {
  return (
    <Page size={pageSizeFor(doc)} style={styles.page}>
      <View
        style={[styles.edgeTop, { backgroundColor: theme.accentDeep }]}
        fixed
      />
      <Chrome doc={doc} theme={theme} />
      {children}
      <View
        style={[styles.edgeBottom, { backgroundColor: theme.accentDeep }]}
        fixed
      />
      <Footer doc={doc} pageNumber={pageNumber} />
    </Page>
  );
}

function SourceLine({ note }: { note?: string | null }) {
  if (!note?.trim()) return null;
  return <Text style={styles.source}>{note.trim()}</Text>;
}

/** The full-width accent band a page ends on when it has a conclusion. */
function ConclusionBand({
  text,
  theme,
}: {
  text?: string | null;
  theme: DeckTheme;
}) {
  if (!text?.trim()) return null;
  return (
    <View style={[styles.band, { backgroundColor: theme.accent }]} wrap={false}>
      <Rich
        style={[styles.bandText, { color: theme.accentInk }]}
        strongStyle={{ color: theme.accentInk }}
      >
        {text}
      </Rich>
    </View>
  );
}

function PageHeading({
  page,
  accent,
}: {
  page: Exclude<ReportPage, { kind: "cover" }>;
  accent: string;
}) {
  const chip = pageKindLabel(page.kind);
  return (
    <View>
      {chip ? (
        <Text style={[styles.kindChip, { color: accent }]}>
          {chip.toUpperCase()}
        </Text>
      ) : null}
      <Text style={styles.heading}>{"title" in page ? page.title : ""}</Text>
      <View style={[styles.headingRule, { backgroundColor: accent }]} />
      {"intro" in page && page.intro?.trim() ? (
        <Rich style={styles.intro}>{page.intro}</Rich>
      ) : null}
    </View>
  );
}

/** ------------------------------------------------------------------ tiles */

function Tile({
  kpi,
  width,
  tone,
  theme,
}: {
  kpi: ReportKpi;
  width: string;
  tone?: "accent" | "negative" | "cobalt" | "plain";
  theme: DeckTheme;
}) {
  const filled = tone === "accent" || tone === "negative" || tone === "cobalt";
  const background =
    tone === "accent"
      ? theme.accent
      : tone === "negative"
        ? PALETTE.coral
        : tone === "cobalt"
          ? PALETTE.cobalt
          : PALETTE.card;

  const valueColour = tone === "accent" ? theme.accentInk : PALETTE.paper;
  const labelColour = tone === "accent" ? theme.accentInk : PALETTE.paper;
  const noteColour =
    tone === "accent" ? theme.accentDeep : filled ? "#F2F5F9" : PALETTE.muted;

  return (
    <View style={[styles.tileCell, { width }]}>
      <View
        style={[
          styles.tile,
          {
            backgroundColor: background,
            borderColor: filled ? background : PALETTE.hairline,
          },
        ]}
      >
        <Text style={[styles.tileValue, { color: valueColour }]}>
          {kpi.value}
        </Text>
        <Text style={[styles.tileLabel, { color: labelColour }]}>
          {kpi.label.toUpperCase()}
        </Text>
        {kpi.note?.trim() ? (
          <Rich
            style={[styles.tileNote, { color: noteColour }]}
            strongStyle={{ fontFamily: "Helvetica-Bold" }}
          >
            {kpi.note}
          </Rich>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The tile grid: three across, so four cards read as 3 + 1 and six as two full
 * rows.
 *
 * The first tile is filled in the accent unless the page says otherwise — the
 * desk deck leads with the number the page is about, and a row of six identical
 * outlined tiles makes the reader choose, which is the report failing to.
 */
function TileGrid({ kpis, theme }: { kpis: ReportKpi[]; theme: DeckTheme }) {
  if (kpis.length === 0) return null;
  const perRow = kpis.length <= 2 ? kpis.length : 3;
  const width = `${100 / perRow}%`;
  return (
    <View style={styles.tileRow}>
      {kpis.map((kpi, index) => (
        <Tile
          key={index}
          kpi={kpi}
          width={width}
          tone={index === 0 ? "accent" : "plain"}
          theme={theme}
        />
      ))}
    </View>
  );
}

function Callouts({
  callouts,
  accent,
}: {
  callouts?: ReportCallout[];
  accent: string;
}) {
  if (!callouts?.length) return null;
  return (
    <View style={{ marginTop: 10 }}>
      {callouts.map((callout, index) => (
        <View
          key={index}
          style={[styles.callout, { borderLeftColor: accent }]}
          wrap={false}
        >
          <Text style={[styles.calloutLabel, { color: accent }]}>
            {callout.label.toUpperCase()}
          </Text>
          <Rich style={styles.calloutText}>{callout.text}</Rich>
        </View>
      ))}
    </View>
  );
}

function Bullets({ items, accent }: { items: string[]; accent: string }) {
  return (
    <View>
      {items.map((item, index) => (
        <View key={index} style={styles.bulletRow} wrap={false}>
          <Text style={[styles.bulletMark, { color: accent }]}>•</Text>
          <Rich style={styles.bulletText}>{item}</Rich>
        </View>
      ))}
    </View>
  );
}

/** ----------------------------------------------------------------- charts */

/** Plot height in points. Leaves room for a heading, a band and a source line. */
const CHART_PLOT_HEIGHT = 210;

/**
 * A column chart with a real zero baseline.
 *
 * The baseline is the reason this is not just a row of proportional bars. The
 * charts these pages exist for are growth series — "+6.0, +6.5, +4.0, +0.3,
 * -0.5" — where the whole insight is the crossing into negative territory. A
 * chart that plots magnitude alone shows five bars of similar height and hides
 * the one fact worth showing, so the plot is split into a positive region and a
 * negative one, sized by how far the series actually runs each way.
 */
function ColumnChart({
  chart,
  theme,
}: {
  chart: ReportChart;
  theme: DeckTheme;
}) {
  const points = chart.points;
  const cellWidth = `${100 / points.length}%`;

  const maxPositive = Math.max(0, ...points.map((point) => point.value));
  const maxNegative = Math.max(0, ...points.map((point) => -point.value));
  const span = maxPositive + maxNegative;

  // An all-zero series would divide by zero and, more usefully, is not a chart.
  if (span === 0) return null;

  const positiveHeight = Math.round(CHART_PLOT_HEIGHT * (maxPositive / span));
  const negativeHeight = CHART_PLOT_HEIGHT - positiveHeight;

  const barColour = (point: ReportChartPoint) => {
    if (point.highlight) return theme.accent;
    return point.value < 0 ? PALETTE.coral : PALETTE.steel;
  };

  return (
    <View style={styles.chartFrame}>
      {chart.unit ? <Text style={styles.chartUnit}>{chart.unit}</Text> : null}

      {positiveHeight > 0 ? (
        <View style={[styles.chartRow, { height: positiveHeight }]}>
          {points.map((point, index) => (
            <View
              key={index}
              style={[styles.chartCell, { width: cellWidth, height: "100%" }]}
            >
              {point.value > 0 ? (
                <View
                  style={[
                    styles.bar,
                    {
                      // A floor of 2pt so a small positive still reads as
                      // present rather than as a missing period.
                      height: Math.max(
                        2,
                        (positiveHeight * point.value) / maxPositive,
                      ),
                      backgroundColor: barColour(point),
                    },
                  ]}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.chartBaseline} />

      {negativeHeight > 0 ? (
        <View
          style={[
            styles.chartRow,
            { height: negativeHeight, alignItems: "flex-start" },
          ]}
        >
          {points.map((point, index) => (
            <View key={index} style={[styles.chartCell, { width: cellWidth }]}>
              {point.value < 0 ? (
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(
                        2,
                        (negativeHeight * -point.value) / maxNegative,
                      ),
                      backgroundColor: barColour(point),
                    },
                  ]}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.chartRow}>
        {points.map((point, index) => (
          <View key={index} style={{ width: cellWidth, paddingHorizontal: 5 }}>
            <Text style={styles.chartValue}>
              {pointLabel(point.value, point.display)}
            </Text>
            <Text style={styles.chartCategory}>{point.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Horizontal bars, for series whose labels are names rather than periods.
 *
 * "New Zealand" and "United Kingdom" do not fit under a column at eight point,
 * and abbreviating a country to fit is how a chart starts misleading. Turning
 * the chart on its side gives the label a whole line.
 */
function BarChart({ chart, theme }: { chart: ReportChart; theme: DeckTheme }) {
  const maxAbsolute = Math.max(
    ...chart.points.map((point) => Math.abs(point.value)),
  );
  if (maxAbsolute === 0) return null;

  return (
    <View style={styles.chartFrame}>
      {chart.unit ? <Text style={styles.chartUnit}>{chart.unit}</Text> : null}
      {chart.points.map((point, index) => (
        <View key={index} style={styles.barRow} wrap={false}>
          <Text style={styles.barLabel}>{point.label}</Text>
          <View style={styles.barTrack}>
            <View
              style={{
                height: "100%",
                width: `${Math.max(1, (Math.abs(point.value) / maxAbsolute) * 100)}%`,
                backgroundColor: point.highlight
                  ? theme.accent
                  : point.value < 0
                    ? PALETTE.coral
                    : PALETTE.steel,
              }}
            />
          </View>
          <Text style={styles.barValue}>
            {pointLabel(point.value, point.display)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The build-up chart: where a balance started, what moved it, what is left.
 *
 * The desk asked for this after a draft plotted an $880 million cash balance as
 * one column, which answers none of the questions a reader has — how much of it
 * arrived with the deal, how much is already committed to the dividend and the
 * buy-back, and what is actually free. A waterfall answers all three in one
 * shape.
 *
 * `isTotal` points sit on the baseline; steps float from the running total
 * before them to the running total after. Cumulative arithmetic runs over the
 * steps only, so a closing total is drawn at its own value rather than stacked
 * on top of the steps that produced it.
 */
/**
 * Each waterfall bar as the span it occupies, in the chart unit.
 *
 * A module-level function rather than a running total inside the component: the
 * accumulation is a fold over the points, and folding it in place inside a
 * render body is both harder to read and something the lint rules rightly
 * refuse.
 */
function waterfallSpans(
  points: ReportChartPoint[],
): Array<{ point: ReportChartPoint; from: number; to: number }> {
  return points.reduce<
    Array<{ point: ReportChartPoint; from: number; to: number }>
  >((spans, point) => {
    const running = spans.length > 0 ? spans[spans.length - 1].to : 0;
    spans.push(
      point.isTotal
        ? { point, from: 0, to: point.value }
        : { point, from: running, to: running + point.value },
    );
    return spans;
  }, []);
}

function WaterfallChart({
  chart,
  theme,
}: {
  chart: ReportChart;
  theme: DeckTheme;
}) {
  const points = chart.points;
  const cellWidth = `${100 / points.length}%`;

  const spans = waterfallSpans(points);

  const ceiling = Math.max(
    ...spans.map((span) => Math.max(span.from, span.to)),
    0,
  );
  if (ceiling <= 0) return null;

  const scale = (value: number) => (CHART_PLOT_HEIGHT * value) / ceiling;

  return (
    <View style={styles.chartFrame}>
      {chart.unit ? <Text style={styles.chartUnit}>{chart.unit}</Text> : null}

      <View style={[styles.chartRow, { height: CHART_PLOT_HEIGHT }]}>
        {spans.map((span, index) => {
          const top = Math.max(span.from, span.to);
          const bottom = Math.min(span.from, span.to);
          const height = Math.max(2, scale(top - bottom));
          const colour = span.point.isTotal
            ? span.point.highlight
              ? theme.accent
              : PALETTE.steel
            : span.point.value < 0
              ? PALETTE.coral
              : theme.accent;

          return (
            <View
              key={index}
              style={[styles.chartCell, { width: cellWidth, height: "100%" }]}
            >
              {/**
               * The connector: a hairline from where this bar ends to where the
               * next one starts.
               *
               * Without it a waterfall is a row of bars at odd heights, and the
               * reader has to infer that each one begins where the last left
               * off — which is the entire claim the chart is making. It spans
               * the gutter between cells, so it reads as one line across the
               * plot rather than a tick on each bar.
               */}
              {index < spans.length - 1 ? (
                <View
                  style={{
                    position: "absolute",
                    // From this bar's centre to the next one's: the line runs
                    // at the level the next bar starts from, which is the whole
                    // claim a waterfall makes.
                    left: "50%",
                    width: "100%",
                    height: 0.75,
                    top: Math.max(0, CHART_PLOT_HEIGHT - scale(span.to)),
                    backgroundColor: PALETTE.faint,
                  }}
                />
              ) : null}
              <View style={[styles.bar, { height, backgroundColor: colour }]} />
              {/* The gap under a floating step, so it reads as suspended. */}
              <View style={{ height: Math.max(0, scale(bottom)) }} />
            </View>
          );
        })}
      </View>

      <View style={styles.chartBaseline} />

      <View style={styles.chartRow}>
        {points.map((point, index) => (
          <View key={index} style={{ width: cellWidth, paddingHorizontal: 5 }}>
            <Text
              style={[
                styles.chartValue,
                point.isTotal ? { color: PALETTE.paper } : {},
              ]}
            >
              {stepLabel(point)}
            </Text>
            <Text style={styles.chartCategory}>{point.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * A waterfall step, printed with its sign.
 *
 * `display` is what should print and usually carries the sign and the unit
 * ("+$410M"). When the model leaves it out the fallback used to be the bare
 * number, and a waterfall of "427 410 43 880" says nothing about which of those
 * are movements — so a step without a display at least gets a "+".
 */
function stepLabel(point: ReportChartPoint): string {
  const display = point.display?.trim();
  if (display) return display;
  if (point.isTotal || point.value < 0) return String(point.value);
  return `+${point.value}`;
}

function ChartBlock({
  chart,
  theme,
}: {
  chart: ReportChart;
  theme: DeckTheme;
}) {
  if (chart.type === "bars") return <BarChart chart={chart} theme={theme} />;
  if (chart.type === "waterfall")
    return <WaterfallChart chart={chart} theme={theme} />;
  return <ColumnChart chart={chart} theme={theme} />;
}

/** Verdict colour for a comparison row. Neutral by default. */
function changeColour(direction: ReportComparisonRow["direction"]): string {
  if (direction === "better") return PALETTE.mint;
  if (direction === "worse") return PALETTE.coral;
  return PALETTE.muted;
}

/** The chip behind that verdict: the same hue, at panel strength. */
function changeTint(direction: ReportComparisonRow["direction"]): string {
  if (direction === "better") return "#10382C";
  if (direction === "worse") return "#3B1F1D";
  return PALETTE.card;
}

function ManagementQuestion({
  question,
  theme,
}: {
  question?: string | null;
  theme: DeckTheme;
}) {
  if (!question?.trim()) return null;
  return (
    <View
      style={[styles.question, { borderLeftColor: theme.accent }]}
      wrap={false}
    >
      <Text style={[styles.questionHeading, { color: theme.accent }]}>
        {MANAGEMENT_QUESTION_HEADING.toUpperCase()}
      </Text>
      <Text style={styles.questionText}>{question.trim()}</Text>
    </View>
  );
}

/** ------------------------------------------------------------- page bodies */

function CoverBody({
  doc,
  page,
  theme,
}: {
  doc: ReportDoc;
  page: Extract<ReportPage, { kind: "cover" }>;
  theme: DeckTheme;
}) {
  /**
   * The hero pair: the move, then the one number the announcement turned on.
   *
   * The move card is coloured by direction — coral for a fall, mint for a rise —
   * because that is the one thing a reader takes from a cover at a glance, and
   * the second card is cobalt so it reads as a fact rather than a second
   * verdict.
   */
  const falling = (doc.movePct ?? 0) < 0;
  const [move, second] = page.kpis;

  return (
    <View style={styles.bodyCentred}>
      <Text style={styles.coverName}>{page.companyName}</Text>
      <Rich style={styles.coverHeadline}>{page.headline}</Rich>
      <View style={[styles.coverRule, { backgroundColor: theme.accent }]} />

      <View style={styles.tileRow}>
        {move ? (
          <Tile
            kpi={move}
            width="50%"
            tone={falling ? "negative" : "accent"}
            theme={theme}
          />
        ) : null}
        {second ? (
          <Tile kpi={second} width="50%" tone="cobalt" theme={theme} />
        ) : null}
      </View>

      {page.intro?.trim() ? (
        <Rich style={styles.coverNote}>{page.intro}</Rich>
      ) : null}
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function RisksBody({
  page,
  theme,
}: {
  page: Extract<ReportPage, { kind: "risks" }>;
  theme: DeckTheme;
}) {
  const perRow = page.items.length <= 2 ? page.items.length : 3;
  const width = `${100 / perRow}%`;
  return (
    <View style={styles.body}>
      <View style={styles.tileRow}>
        {page.items.map((item, index) => (
          <View key={index} style={[styles.tileCell, { width }]}>
            <View style={styles.tile} wrap={false}>
              <IconDisc
                name={item.icon}
                tone={PALETTE.coralDeep}
                theme={theme}
              />
              <Text
                style={[
                  styles.tileLabel,
                  { fontSize: 10, letterSpacing: 0, marginTop: 10 },
                ]}
              >
                {item.label}
              </Text>
              <Rich style={styles.tileNote}>{item.text}</Rich>
            </View>
          </View>
        ))}
      </View>
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function EntitiesBody({
  page,
  theme,
}: {
  page: Extract<ReportPage, { kind: "entities" }>;
  theme: DeckTheme;
}) {
  return (
    <View style={styles.body}>
      {page.items.map((item, index) => (
        <View key={index} style={{ marginBottom: 10 }} wrap={false}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <IconDisc name="chart" size={20} theme={theme} />
            <Text
              style={{
                fontFamily: "Helvetica-Bold",
                fontSize: 11,
                color: PALETTE.paper,
                marginLeft: 10,
              }}
            >
              {item.name}
            </Text>
            <Rich
              style={{
                fontSize: 9.5,
                color: theme.accent,
                marginLeft: 10,
                flex: 1,
              }}
              strongStyle={{
                fontFamily: "Helvetica-Bold",
                color: theme.accent,
              }}
            >
              {item.stat}
            </Rich>
          </View>
          {item.comment?.trim() ? (
            <Text
              style={{
                fontSize: 9.5,
                lineHeight: 1.35,
                color: PALETTE.muted,
                marginLeft: 30,
                marginTop: 3,
              }}
            >
              {item.comment.trim()}
            </Text>
          ) : null}
        </View>
      ))}
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function ComparisonBody({
  page,
  theme,
}: {
  page: Extract<ReportPage, { kind: "comparison" }>;
  theme: DeckTheme;
}) {
  return (
    <View style={styles.body}>
      <View style={styles.compHead}>
        <Text
          style={[
            styles.compMetric,
            styles.compHeadCell,
            { paddingTop: 0, color: PALETTE.muted },
          ]}
        >
          {page.columns[0].toUpperCase()}
        </Text>
        <Text
          style={[
            styles.compHeadCell,
            { flex: 1, color: PALETTE.muted, marginRight: 8 },
          ]}
        >
          {page.columns[1].toUpperCase()}
        </Text>
        <Text style={[styles.compHeadCell, { flex: 1, color: theme.accent }]}>
          {page.columns[2].toUpperCase()}
        </Text>
        <View style={styles.compChangeCell} />
      </View>

      {page.rows.map((row, index) => (
        <View key={index} style={styles.compRow} wrap={false}>
          <Text style={styles.compMetric}>{row.metric}</Text>
          <View style={styles.compBefore}>
            <Rich style={[styles.compText, { color: PALETTE.muted }]}>
              {row.before}
            </Rich>
          </View>
          <View style={[styles.compNow, { borderColor: theme.accentDeep }]}>
            <Rich style={[styles.compText, { color: PALETTE.paper }]}>
              {row.now}
            </Rich>
          </View>
          <View style={styles.compChangeCell}>
            {row.change?.trim() ? (
              <View
                style={[
                  styles.compChip,
                  { backgroundColor: changeTint(row.direction) },
                ]}
              >
                <Text
                  style={[
                    styles.compChipText,
                    { color: changeColour(row.direction) },
                  ]}
                >
                  {row.change.trim()}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ))}

      <ConclusionBand text={page.conclusion} theme={theme} />
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

/**
 * The dated steps, along a rule.
 *
 * The marks sit on a hairline that runs behind them, which is what makes the
 * page read as a sequence rather than as eight small cards. The rule is
 * absolutely positioned and inset by half a cell so it starts and ends at the
 * first and last mark instead of running off the page.
 */
function TimelineBody({
  page,
  theme,
}: {
  page: Extract<ReportPage, { kind: "timeline" }>;
  theme: DeckTheme;
}) {
  const width = `${100 / page.events.length}%`;
  return (
    <View style={styles.bodyCentred}>
      <View style={styles.timelineRow}>
        {/* The rule the marks sit on, inset so it starts at the first disc. */}
        <View style={[styles.timelineTrack, { top: 33 }]} />
        {page.events.map((event, index) => (
          <View key={index} style={[styles.timelineCell, { width }]}>
            <Text style={[styles.timelineDate, { color: theme.accent }]}>
              {event.date}
            </Text>
            <IconDisc name={event.icon} size={28} theme={theme} />
            <Rich style={styles.timelineText}>{event.text}</Rich>
          </View>
        ))}
      </View>
      <ConclusionBand text={page.conclusion} theme={theme} />
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function MarketVsRealityBody({
  page,
  theme,
}: {
  page: Extract<ReportPage, { kind: "market-vs-reality" }>;
  theme: DeckTheme;
}) {
  const blocks: Array<{ label: string; text: string; tone: string }> = [
    { label: "What was announced", text: page.headline, tone: PALETTE.cobalt },
    {
      label: "What the market reacted to",
      text: page.marketFocus,
      tone: PALETTE.steel,
    },
    {
      label: "What decides it from here",
      text: page.whatMatters,
      tone: theme.accent,
    },
  ];

  return (
    <View style={styles.body}>
      <View style={styles.tileRow}>
        {blocks.map((block, index) => (
          <View key={index} style={[styles.tileCell, { width: "33.333%" }]}>
            <View
              style={[
                styles.tile,
                { borderTopWidth: 2.5, borderTopColor: block.tone },
              ]}
            >
              <Text style={[styles.calloutLabel, { color: block.tone }]}>
                {block.label.toUpperCase()}
              </Text>
              <Rich style={styles.calloutText}>{block.text}</Rich>
            </View>
          </View>
        ))}
      </View>
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function VittiViewBody({
  page,
  theme,
}: {
  page: Extract<ReportPage, { kind: "vitti-view" }>;
  theme: DeckTheme;
}) {
  return (
    <View style={styles.body}>
      <View style={styles.tileRow}>
        {page.ratings.map((rating, index) => (
          <View
            key={index}
            style={[
              styles.tileCell,
              { width: `${100 / Math.max(1, page.ratings.length)}%` },
            ]}
          >
            <View style={styles.tile} wrap={false}>
              <Text
                style={[
                  styles.tileValue,
                  { fontSize: 16, color: theme.accent },
                ]}
              >
                {rating.value}
              </Text>
              <Text style={styles.tileLabel}>{rating.label.toUpperCase()}</Text>
              {rating.note?.trim() ? (
                <Text style={styles.tileNote}>{rating.note.trim()}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      <View style={{ marginTop: 6 }}>
        <Text style={[styles.sectionLabel, { color: theme.accent }]}>
          THE KEY DEBATE
        </Text>
        <Rich style={styles.paragraph}>{page.keyDebate}</Rich>
        <Text style={[styles.sectionLabel, { color: theme.accent }]}>
          NEXT CATALYST
        </Text>
        <Rich style={styles.paragraph}>{page.nextCatalyst}</Rich>
      </View>

      <ManagementQuestion question={page.managementQuestion} theme={theme} />
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function OutlookBody({
  page,
  theme,
}: {
  page: Extract<ReportPage, { kind: "outlook" }>;
  theme: DeckTheme;
}) {
  const [left, right] = page.columns ?? [
    "What would improve the story",
    "What would make it worse",
  ];
  return (
    <View style={styles.body}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ flex: 1, paddingRight: 18 }}>
          <Text style={[styles.sectionLabel, { color: theme.accent }]}>
            {left.toUpperCase()}
          </Text>
          <View style={styles.rule} />
          <Bullets items={page.improve} accent={theme.accent} />
        </View>
        <View style={{ flex: 1, paddingLeft: 18 }}>
          <Text style={[styles.sectionLabel, { color: PALETTE.coral }]}>
            {right.toUpperCase()}
          </Text>
          <View style={styles.rule} />
          <Bullets items={page.worsen} accent={PALETTE.coral} />
        </View>
      </View>
      <ConclusionBand text={page.conclusion} theme={theme} />
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function ManagementBody({
  page,
  theme,
}: {
  page: Extract<ReportPage, { kind: "management" }>;
  theme: DeckTheme;
}) {
  return (
    <View style={styles.body}>
      <View style={styles.tileRow}>
        {page.people.map((person, index) => (
          <View
            key={index}
            style={[
              styles.tileCell,
              { width: `${100 / Math.max(1, page.people.length)}%` },
            ]}
          >
            <View style={styles.tile} wrap={false}>
              <IconDisc name="people" size={22} theme={theme} />
              <Text
                style={[
                  styles.tileLabel,
                  { fontSize: 10.5, letterSpacing: 0, marginTop: 9 },
                ]}
              >
                {person.name}
              </Text>
              <Text style={[styles.tileNote, { color: theme.accent }]}>
                {person.role}
              </Text>
              {person.tenure?.trim() ? (
                <Text style={styles.tileNote}>{person.tenure.trim()}</Text>
              ) : null}
              {person.holding?.trim() ? (
                <Text style={styles.tileNote}>{person.holding.trim()}</Text>
              ) : null}
              {person.note?.trim() ? (
                <Text style={styles.tileNote}>{person.note.trim()}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {page.changes?.length ? (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.sectionLabel, { color: theme.accent }]}>
            RECENT CHANGES
          </Text>
          <View style={styles.rule} />
          <Bullets items={page.changes} accent={theme.accent} />
        </View>
      ) : null}
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function ClosingBody({
  doc,
  page,
  theme,
}: {
  doc: ReportDoc;
  page: Extract<ReportPage, { kind: "closing" }>;
  theme: DeckTheme;
}) {
  return (
    <View style={styles.body}>
      {page.statements.map((statement, index) => (
        <Rich key={index} style={styles.paragraph}>
          {statement}
        </Rich>
      ))}

      <View style={[styles.coverRule, { backgroundColor: theme.accent }]} />

      {page.pullQuote?.trim() ? (
        <Text style={[styles.quote, { color: theme.accent }]}>
          {`"${page.pullQuote.trim()}"`}
        </Text>
      ) : null}
      <Text style={[styles.quote, { marginTop: 8, color: theme.accent }]}>
        {`"${CLOSING_SIGN_OFF}"`}
      </Text>

      <ManagementQuestion question={page.managementQuestion} theme={theme} />

      <View style={{ marginTop: 16 }}>
        <Text
          style={{
            fontFamily: "Helvetica-Bold",
            fontSize: 11,
            color: PALETTE.paper,
          }}
        >
          {doc.analystName}
        </Text>
        <Text style={{ fontSize: 9.5, color: PALETTE.muted, marginTop: 2 }}>
          Research Analyst
        </Text>
      </View>
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

/**
 * The one-page sheet.
 *
 * Reproduces what the desk publishes (PIA, 16 September 2026): the figures, why
 * it moved and what that changes side by side, how the story got here, what is
 * still open, and one line of judgement. No heading block above it -- the
 * headline *is* the heading, so `DailyMoverReport` skips `PageHeading` for this
 * kind exactly as it does for the cover.
 *
 * Numbered lists rather than bullets, because the published sheet numbers them
 * and because a reader comparing two columns wants to count items in each.
 */
/**
 * A traded price at a sensible number of decimals.
 *
 * Four decimals is right for a stock at $0.018 and absurd for one at $31.40,
 * and the Daily Mover screens both on the same morning.
 */
function tradedPrice(value: number): string {
  if (Math.abs(value) < 1) return `$${value.toFixed(4)}`;
  if (Math.abs(value) < 10) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * The lead tile, built from the feed rather than from the model.
 *
 * Three faults in one review, all of them from letting the model write this
 * tile: the move printed as "~12.5%" on a day the stock fell — no sign, so the
 * direction was invisible — with no traded price and no time against it. A
 * Daily Mover goes out mid-session, so "down 12.5%" is only meaningful next to
 * the price it was read at and the moment it was read.
 *
 * So the figure is composed here from `movePct`, `reportPrice` and `moveTime`,
 * which all come from the exchange feed and the clock. The model's own
 * `kpis[0]` is used only as the fallback label, and only when the document
 * predates these fields.
 */
function leadTile(
  doc: ReportDoc,
  fallback: ReportKpi,
): { value: string; label: string } {
  if (typeof doc.movePct !== "number") return fallback;

  /**
   * A plain ASCII hyphen, not U+2212.
   *
   * The typographic minus is not in Helvetica's WinAnsi encoding, so react-pdf
   * dropped it silently: the tile printed "12.4%" on a day the stock fell,
   * reintroducing character for character the missing-sign fault this function
   * exists to prevent. Anything outside WinAnsi must be checked in a rendered
   * PDF before it is trusted here.
   */
  const signed = `${doc.movePct > 0 ? "+" : doc.movePct < 0 ? "-" : ""}${Math.abs(doc.movePct).toFixed(1)}%`;

  const parts: string[] = [];
  if (typeof doc.reportPrice === "number" && Number.isFinite(doc.reportPrice)) {
    parts.push(tradedPrice(doc.reportPrice));
  }
  parts.push(
    doc.moveIsClose
      ? "at the close"
      : doc.moveTime
        ? `as at ${doc.moveTime}`
        : "intraday",
  );

  return { value: signed, label: `Share move \u00B7 ${parts.join(" \u00B7 ")}` };
}

/**
 * The snapshot's chart band.
 *
 * Modelled on what the desk publishes rather than on what was easy to draw: the
 * CVB sheet of 18 September 2026 plots revenue against operating loss across
 * four financial years, with a legend, a zero baseline that negatives hang
 * below, tick labels in $ million, and a footnote saying the loss figure is
 * non-IFRS. All of that is load-bearing — a two-series chart without a legend is
 * a puzzle, and a chart with negative values and no visible zero is a lie.
 *
 * Laid out by absolute position from computed pixel offsets rather than by flex.
 * A chart is a coordinate space; expressing one through nested flex containers
 * means every change is a negotiation with the layout engine instead of
 * arithmetic.
 */
function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min || Math.abs(max) || 1;
  const rough = span / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= rough) ?? 10;
  const size = step * magnitude;
  const first = Math.floor(min / size) * size;
  const ticks: number[] = [];
  // Runs until a tick clears the maximum. Stopping at `max + size / 2` left
  // the top tick under the tallest value (40 for a 42), so it drew above the plot.
  for (let value = first; ; value += size) {
    // Floating-point accumulation prints "-1.0000000000000002" otherwise.
    ticks.push(Number(value.toFixed(6)));
    if (value >= max - size * 1e-9) break;
  }
  return ticks;
}

/**
 * The chart card, drawn the way the desk's CVB sheet of 18 September 2026 draws
 * it: a bordered card across the full measure, the title in the accent with
 * the one-line note beside it, the legend top right, the unit set up the left
 * edge, a dashed zero line, and every point dotted and labelled. No grid: the
 * printed figures carry the precision, so gridlines would only add noise.
 */

function ChartCard({
  title,
  note,
  right,
  unit,
  footnote,
  theme,
  children,
}: {
  title: string;
  note?: string | null;
  right?: ReactNode;
  unit?: string | null;
  footnote?: string | null;
  theme: DeckTheme;
  children: ReactNode;
}) {
  return (
    <View style={styles.chartCard}>
      <View style={styles.chartCardHead}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "baseline",
            flexShrink: 1,
            marginRight: 16,
          }}
        >
          <Text style={[styles.chartCardTitle, { color: theme.accent }]}>
            {title.toUpperCase()}
          </Text>
          {note?.trim() ? (
            <Text style={styles.chartCardNote}>{note.trim()}</Text>
          ) : null}
        </View>
        <View style={styles.chartCardRight}>{right}</View>
      </View>
      <View style={{ flexDirection: "row" }}>
        <View
          style={{
            width: CHART_UNIT_W,
            height: CHART_PLOT_H,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {unit?.trim() ? (
            <Text style={styles.chartCardUnit}>{unit.trim()}</Text>
          ) : null}
        </View>
        <View>{children}</View>
      </View>
      {footnote?.trim() ? (
        <Text style={styles.chartCardFoot}>{footnote.trim()}</Text>
      ) : null}
    </View>
  );
}

/** Tick labels, right-aligned against the plot's left edge. */
function AxisLabels({
  ticks,
  y,
  format,
}: {
  ticks: number[];
  y: (value: number) => number;
  format: (value: number) => string;
}) {
  return (
    <View style={{ width: SNAP_AXIS_W, height: CHART_PLOT_H }}>
      {ticks.map((tick, index) => (
        <Text key={index} style={[styles.snapAxisLabel, { top: y(tick) - 4 }]}>
          {format(tick)}
        </Text>
      ))}
    </View>
  );
}

function SnapshotChartBand({
  chart,
  theme,
}: {
  chart: SnapshotChart;
  theme: DeckTheme;
}) {
  const series = chart.series.slice(0, 2).filter((s) => s.points.length >= 2);
  if (series.length === 0) return null;

  const categories = series[0].points.map((point) => point.label);
  const values = series.flatMap((s) => s.points.map((point) => point.value));
  // Headroom past the extremes, so a figure printed above the highest point
  // or below the lowest has room and does not sit on the category labels.
  const lowest = Math.min(...values, 0);
  const highest = Math.max(...values, 0);
  const headroom = (highest - lowest) * 0.2;
  const ticks = niceTicks(
    lowest < 0 ? lowest - headroom : lowest,
    highest > 0 ? highest + headroom : highest,
    5,
  );
  const low = Math.min(...ticks);
  const high = Math.max(...ticks);
  const span = high - low || 1;
  const plotW = CARD_PLOT_W;
  const H = CHART_PLOT_H;
  const y = (value: number) => H - ((value - low) / span) * H;
  const zeroY = y(0);
  const band = plotW / Math.max(1, categories.length);
  const centre = (i: number) => band * i + band / 2;
  const isLine = chart.form === "line";
  const colW = series.length > 1 ? band * 0.26 : band * 0.4;

  // Colour follows what the series MEANS, not where it sits: by position the
  // first series took the theme accent, which is coral on a falling day, so
  // revenue drew in the colour reserved for losses. Two neutral series still
  // need telling apart, hence cobalt then steel.
  const colour = (index: number) => {
    const tone = series[index]?.tone;
    if (tone === "unfavourable") return PALETTE.coral;
    if (tone === "favourable") return PALETTE.mint;
    return index === 0 ? PALETTE.cobalt : PALETTE.steel;
  };

  // A line labels every point while there is room, and only its ends after.
  const labelAll = !isLine || categories.length <= 6;
  // With two series, the higher one at each category is labelled above and
  // the lower one below, so the two labels never meet between the lines.
  const labelAbove = (seriesIndex: number, i: number) => {
    const value = series[seriesIndex].points[i]?.value ?? 0;
    if (!isLine) return value >= 0;
    const other = series[1 - seriesIndex]?.points[i]?.value;
    if (other === undefined) return y(value) > 16;
    return value >= other;
  };

  const legend = (
    <View style={{ flexDirection: "row" }}>
      {series.map((s, index) => (
        <View key={index} style={styles.chartLegendItem}>
          <View style={[styles.chartLegendDot, { backgroundColor: colour(index) }]} />
          <Text style={styles.chartLegendLabel}>{s.name}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <ChartCard
      title={chart.title}
      note={chart.note}
      right={legend}
      unit={chart.unit}
      footnote={chart.footnote}
      theme={theme}
    >
      <View style={{ flexDirection: "row" }}>
        <AxisLabels ticks={ticks} y={y} format={(tick) => String(tick)} />
        <View style={{ width: plotW, height: H, position: "relative" }}>
          <Svg style={{ position: "absolute", top: 0, left: 0 }} width={plotW} height={H}>
            <Line x1={0} y1={H} x2={plotW} y2={H} stroke={PALETTE.faint} strokeWidth={0.8} />
            {low < 0 && high > 0 ? (
              <Line
                x1={0}
                y1={zeroY}
                x2={plotW}
                y2={zeroY}
                stroke={PALETTE.faint}
                strokeWidth={0.8}
                strokeDasharray="3,3"
              />
            ) : null}
            {isLine
              ? series.map((s, index) => (
                  <Polyline
                    key={`l${index}`}
                    points={s.points
                      .map((point, i) => `${centre(i)},${y(point.value)}`)
                      .join(" ")}
                    stroke={colour(index)}
                    strokeWidth={2.2}
                    strokeLinejoin="round"
                    fill="none"
                  />
                ))
              : null}
            {isLine
              ? series.map((s, index) =>
                  s.points.map((point, i) => (
                    <Circle
                      key={`c${index}-${i}`}
                      cx={centre(i)}
                      cy={y(point.value)}
                      r={4.2}
                      fill={colour(index)}
                    />
                  )),
                )
              : null}
          </Svg>

          {!isLine
            ? series.map((s, seriesIndex) =>
                s.points.map((point, i) => {
                  const offset =
                    series.length > 1 ? (seriesIndex === 0 ? -1 : 1) * (colW / 2 + 1.5) : 0;
                  const top = Math.min(y(point.value), zeroY);
                  const height = Math.max(1.5, Math.abs(y(point.value) - zeroY));
                  return (
                    <View
                      key={`${seriesIndex}-${i}`}
                      style={{
                        position: "absolute",
                        left: centre(i) + offset - colW / 2,
                        top,
                        width: colW,
                        height,
                        backgroundColor: colour(seriesIndex),
                        borderRadius: 1.5,
                      }}
                    />
                  );
                }),
              )
            : null}

          {series.map((s, seriesIndex) =>
            s.points.map((point, i) => {
              if (!labelAll && i !== 0 && i !== s.points.length - 1) return null;
              const offset =
                !isLine && series.length > 1 ? (seriesIndex === 0 ? -1 : 1) * (colW / 2 + 1.5) : 0;
              const above = labelAbove(seriesIndex, i);
              const edge = y(point.value);
              const gap = isLine ? 8 : 2;
              return (
                <Text
                  key={`v-${seriesIndex}-${i}`}
                  style={[
                    styles.snapChartValue,
                    {
                      left: centre(i) + offset - band / 2,
                      width: band,
                      top: above ? edge - 11 - gap : edge + gap,
                    },
                  ]}
                >
                  {point.display?.trim() || String(point.value)}
                </Text>
              );
            }),
          )}
        </View>
      </View>

      <View style={{ flexDirection: "row", marginLeft: SNAP_AXIS_W, width: plotW }}>
        {categories.map((label, index) => (
          <Text key={index} style={styles.snapCategory}>
            {categories.length <= 8 || (categories.length - 1 - index) % 2 === 0
              ? label
              : ""}
          </Text>
        ))}
      </View>
    </ChartCard>
  );
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-02-05" → "Feb 2026". */
function monthYear(iso: string): string {
  const [year, month] = iso.split("-");
  return `${MONTH_NAMES[Number(month) - 1] ?? ""} ${year}`;
}

/**
 * Decimals from the tick step: "$12", "$2.50", "$0.018". A whole-dollar step
 * prints whole dollars; a 2.5 step printed with none read "$3" for $2.50.
 */
function priceLabel(value: number, step: number): string {
  const decimals = step >= 1 && Number.isInteger(step) ? 0 : step >= 0.01 ? 2 : 3;
  return `$${value.toFixed(decimals)}`;
}

/**
 * The chart card when the model supplied no series: the share price from the
 * exchange feed over the timeline's own span.
 *
 * It exists because the model's chart is optional and, until this, no snapshot
 * draft ever carried one. The timeline's steps are marked on the line with the
 * same numbers the "How we got here" band prints under it, so the two bands
 * read together: what happened, and what the price did about it.
 */
function PriceChartCard({
  layout,
  theme,
}: {
  layout: PriceBandLayout;
  theme: DeckTheme;
}) {
  // Fitted to the data, not to zero: a line that moves 30% drawn from $0
  // is a flat line. The padding keeps the extremes off the frame.
  const spread = layout.high - layout.low || layout.high * 0.1 || 1;
  const low = layout.low - spread * 0.16;
  const high = layout.high + spread * 0.16;
  const span = high - low;
  // Enough ticks that at least three land inside the fitted range: with four,
  // a $2-$8 line got a $5 step and one label.
  let allTicks = niceTicks(low, high, 4);
  for (let count = 5; count <= 9; count += 1) {
    if (allTicks.filter((tick) => tick >= low && tick <= high).length >= 3) break;
    allTicks = niceTicks(low, high, count);
  }
  const step = allTicks.length > 1 ? allTicks[1] - allTicks[0] : spread;
  const ticks = allTicks.filter((tick) => tick >= low && tick <= high);

  const plotW = CARD_PLOT_W;
  const H = CHART_PLOT_H;
  const y = (value: number) => H - ((value - low) / span) * H;
  const x = (fraction: number) => fraction * plotW;

  const change = layout.last.close / layout.first.close - 1;
  const half = PRICE_MARKER / 2;
  const lift = PRICE_MARKER + 3;

  const line = layout.points
    .map((point) => `${x(point.x).toFixed(1)},${y(point.close).toFixed(1)}`)
    .join(" ");
  const area =
    `${x(layout.points[0].x).toFixed(1)},${H} ` +
    line +
    ` ${x(layout.todayX).toFixed(1)},${H}`;
  const upcoming = layout.markers.filter((marker) => marker.upcoming);
  const lastUpcomingX = upcoming.length
    ? Math.max(...upcoming.map((marker) => marker.x))
    : null;

  return (
    <ChartCard
      title={`Share price  |  ${monthYear(layout.first.date)} to ${monthYear(layout.last.date)}`}
      note={`${change >= 0 ? "+" : "-"}${Math.abs(change * 100).toFixed(0)}% over the period`}
      right={<Text style={styles.chartLegendLabel}>Exchange feed · daily close</Text>}
      theme={theme}
    >
      <View style={{ flexDirection: "row" }}>
        <AxisLabels ticks={ticks} y={y} format={(tick) => priceLabel(tick, step)} />
        <View style={{ width: plotW, height: H, position: "relative" }}>
          <Svg style={{ position: "absolute", top: 0, left: 0 }} width={plotW} height={H}>
            <Line x1={0} y1={H} x2={plotW} y2={H} stroke={PALETTE.faint} strokeWidth={0.8} />
            {layout.markers.map((marker) => (
              <Line
                key={`d${marker.number}`}
                x1={x(marker.x)}
                y1={y(marker.close)}
                x2={x(marker.x)}
                y2={H}
                stroke={PALETTE.faint}
                strokeWidth={0.6}
                strokeDasharray="2,2"
              />
            ))}
            <Polygon points={area} fill={PALETTE.cobalt} fillOpacity={0.12} />
            <Polyline
              points={line}
              stroke={PALETTE.cobalt}
              strokeWidth={2}
              strokeLinejoin="round"
              fill="none"
            />
            {lastUpcomingX !== null ? (
              <Line
                x1={x(layout.todayX)}
                y1={y(layout.last.close)}
                x2={x(lastUpcomingX)}
                y2={y(layout.last.close)}
                stroke={PALETTE.muted}
                strokeWidth={1.2}
                strokeDasharray="3,3"
              />
            ) : null}
            <Circle cx={x(layout.todayX)} cy={y(layout.last.close)} r={4.2} fill={PALETTE.cobalt} />
          </Svg>

          {layout.markers.map((marker) => {
            const pointY = y(marker.close);
            // Lifted markers go up, unless that would leave the plot, in
            // which case they go down. A stem ties each back to its close.
            const offset = marker.stack * lift;
            const up = pointY - offset - half >= 0;
            const centreY = up ? pointY - offset : pointY + offset;
            const centreX = Math.min(Math.max(x(marker.x), half), plotW - half);
            return (
              <View key={marker.number}>
                {marker.stack > 0 ? (
                  <View
                    style={{
                      position: "absolute",
                      left: centreX - 0.5,
                      top: Math.min(pointY, centreY),
                      width: 1,
                      height: Math.abs(pointY - centreY),
                      backgroundColor: theme.accent,
                    }}
                  />
                ) : null}
                <View
                  style={[
                    styles.priceMarker,
                    { left: centreX - half, top: centreY - half },
                    marker.upcoming
                      ? { borderWidth: 1.4, borderColor: theme.accent, backgroundColor: PALETTE.card }
                      : { backgroundColor: theme.accent },
                  ]}
                >
                  <Text
                    style={[
                      styles.priceMarkerText,
                      marker.upcoming ? { color: theme.accent } : {},
                    ]}
                  >
                    {marker.number}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <View style={{ marginLeft: SNAP_AXIS_W, width: plotW, height: 17, position: "relative" }}>
        {layout.monthTicks.map((tick, index) => (
          <Text
            key={index}
            style={[
              styles.priceMonth,
              { left: Math.min(Math.max(x(tick.x) - 30, -8), plotW - 52) },
            ]}
          >
            {tick.label}
          </Text>
        ))}
      </View>
    </ChartCard>
  );
}

/**
 * "How we got here" as the desk draws it: one line across the measure in the
 * accent, a dot where each step starts and one at the end, and the date and
 * the step hanging under each. When the price card above marks the steps on
 * the line, the dots carry the same numbers so the two can be read together.
 */
function TimelineBand({
  events,
  numbered,
  theme,
}: {
  events: ReportTimelineEvent[];
  numbered: boolean;
  theme: DeckTheme;
}) {
  const size = numbered ? 13 : 8;
  const lineTop = size / 2 - 0.75;
  return (
    <View>
      <Text style={[styles.snapBandHead, { color: theme.accent }]}>
        HOW WE GOT HERE
      </Text>
      <View style={styles.snapTrack}>
        <View
          style={[
            styles.snapTrackLine,
            { top: lineTop, backgroundColor: theme.accent },
          ]}
        />
        <View
          style={[
            styles.timelineDot,
            { right: 0, top: lineTop + 0.75 - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent },
          ]}
        />
        {events.map((event, index) => (
          <View key={index} style={[styles.snapStep, { paddingTop: size + 4 }]}>
            <View
              style={[
                styles.timelineDot,
                {
                  left: 0,
                  top: 0,
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: theme.accent,
                },
              ]}
            >
              {numbered ? (
                <Text style={styles.priceMarkerText}>{index + 1}</Text>
              ) : null}
            </View>
            <Text style={styles.snapStepDate}>{event.date}</Text>
            <Text style={styles.snapStepText}>{event.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SnapshotBody({
  doc,
  page,
  theme,
}: {
  doc: ReportDoc;
  page: Extract<ReportPage, { kind: "snapshot" }>;
  theme: DeckTheme;
}) {
  const column = (
    heading: string,
    items: string[],
    accent: string,
    divided = false,
  ) => (
    <View style={[styles.snapColumn, divided ? styles.snapColumnDivided : {}]}>
      <Text style={[styles.snapColHead, { color: accent }]}>
        {heading.toUpperCase()}
      </Text>
      {items.map((item, index) => (
        <View key={index} style={styles.snapItem}>
          <Text style={[styles.snapItemNum, { color: accent }]}>
            {index + 1}
          </Text>
          <Rich style={styles.snapItemText}>{item}</Rich>
        </View>
      ))}
    </View>
  );

  const modelChart =
    page.chart && page.chart.series.some((series) => series.points.length >= 2)
      ? page.chart
      : null;
  const priceBand =
    !modelChart && doc.priceHistory
      ? layoutPriceBand({
          history: doc.priceHistory,
          timeline: page.timeline,
          moveDate: doc.moveDate,
          reportPrice: doc.reportPrice,
        })
      : null;

  return (
    <View style={styles.snapBody}>
      <View>
        <Text style={styles.snapCompany}>{page.companyName}</Text>
        <Text style={styles.snapHeadline}>{page.headline}</Text>
      </View>

      <View style={styles.snapTileRow}>
        {page.kpis.slice(0, 4).map((rawKpi, index) => {
          // The first tile is the share move — the fact the report exists for,
          // and the one tile the renderer composes itself. See `leadTile`.
          const lead = index === 0;
          const kpi = lead ? leadTile(doc, rawKpi) : rawKpi;
          return (
            <View
              key={index}
              style={[
                styles.snapTile,
                lead ? { borderLeftColor: theme.accent } : {},
              ]}
            >
              <Text
                style={[
                  styles.snapTileValue,
                  lead ? { color: theme.accent } : {},
                ]}
              >
                {kpi.value}
              </Text>
              <Text style={styles.snapTileLabel}>
                {kpi.label.toUpperCase()}
              </Text>
            </View>
          );
        })}
      </View>

      {/**
       * The chart card sits under the tiles, as on the desk's CVB sheet: the
       * model's own series when it supplied one, otherwise the share price
       * from the feed, so the sheet always carries a chart.
       */}
      {modelChart ? (
        <SnapshotChartBand chart={modelChart} theme={theme} />
      ) : priceBand ? (
        <PriceChartCard layout={priceBand} theme={theme} />
      ) : null}

      <View style={styles.snapColumns}>
        {column("Why it moved", page.whyItMoved, theme.accent)}
        {column("What changes now", page.whatChangesNow, PALETTE.cobalt, true)}
      </View>

      {page.timeline.length > 0 ? (
        <TimelineBand
          events={page.timeline}
          numbered={!modelChart && priceBand !== null}
          theme={theme}
        />
      ) : null}

      {page.risks.length > 0 ? (
        <View>
          <Text style={[styles.snapBandHead, { color: PALETTE.coral }]}>
            KEY RISKS REMAINING
          </Text>
          <View style={styles.snapRiskRow}>
            {page.risks.map((risk, index) => (
              <View key={index} style={styles.snapRisk}>
                <Text style={styles.snapRiskLabel}>{risk.label}</Text>
                <Text style={styles.snapRiskText}>{risk.text}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {page.pullQuote?.trim() ? (
        <View style={[styles.snapQuote, { borderLeftColor: theme.accent }]}>
          {/**
           * No quotation marks.
           *
           * They were read as a quote from the company. This line is the desk's
           * own analysis, and attributing it to anyone else is the kind of error
           * that matters in a client document — so it is labelled as what it is
           * and set without quote marks.
           */}
          <Text style={styles.snapQuoteText}>
            <Text style={[styles.snapQuoteLead, { color: theme.accent }]}>
              Vitti view:{" "}
            </Text>
            {page.pullQuote.trim()}
          </Text>
        </View>
      ) : null}

      {page.sourceNote?.trim() ? (
        <Text style={styles.snapSource}>{page.sourceNote.trim()}</Text>
      ) : null}
    </View>
  );
}

function PageBody({
  doc,
  page,
  theme,
}: {
  doc: ReportDoc;
  page: ReportPage;
  theme: DeckTheme;
}) {
  const accent = pageAccent(page.kind, theme);

  switch (page.kind) {
    case "snapshot":
      return <SnapshotBody doc={doc} page={page} theme={theme} />;

    case "cover":
      return <CoverBody doc={doc} page={page} theme={theme} />;

    case "narrative":
      return (
        <View style={styles.body}>
          {page.paragraphs.map((paragraph, index) => (
            <Rich key={index} style={styles.paragraph}>
              {paragraph}
            </Rich>
          ))}
          <Callouts callouts={page.callouts} accent={accent} />
          <SourceLine note={page.sourceNote} />
        </View>
      );

    case "kpis":
      return (
        <View style={styles.body}>
          <TileGrid kpis={page.kpis} theme={theme} />
          {page.notes?.map((note, index) => (
            <Text
              key={index}
              style={{ fontSize: 9.5, lineHeight: 1.4, color: PALETTE.muted }}
            >
              {note}
            </Text>
          ))}
          <Callouts callouts={page.callouts} accent={accent} />
          <ConclusionBand text={page.conclusion} theme={theme} />
          <SourceLine note={page.sourceNote} />
        </View>
      );

    case "entities":
      return <EntitiesBody page={page} theme={theme} />;

    case "risks":
      return <RisksBody page={page} theme={theme} />;

    case "chart":
      return (
        <View style={styles.bodyCentred}>
          <ChartBlock chart={page.chart} theme={theme} />
          <Callouts callouts={page.callouts} accent={accent} />
          <ConclusionBand text={page.conclusion} theme={theme} />
          <SourceLine note={page.sourceNote} />
        </View>
      );

    case "market-vs-reality":
      return <MarketVsRealityBody page={page} theme={theme} />;

    case "comparison":
      return <ComparisonBody page={page} theme={theme} />;

    case "timeline":
      return <TimelineBody page={page} theme={theme} />;

    case "management":
      return <ManagementBody page={page} theme={theme} />;

    case "vitti-view":
      return <VittiViewBody page={page} theme={theme} />;

    case "outlook":
      return <OutlookBody page={page} theme={theme} />;

    case "closing":
      return <ClosingBody doc={doc} page={page} theme={theme} />;
  }
}

/**
 * The compliance sheet.
 *
 * Same chrome as every other page, quieter type: it is part of the document,
 * not an appendix someone stapled on, and a reader who reaches it should not
 * feel they have left the deck. The text itself is verbatim from `types.ts` and
 * never model-generated.
 */
function DisclaimerPage({ doc, theme }: { doc: ReportDoc; theme: DeckTheme }) {
  return (
    <Page size={pageSizeFor(doc)} style={styles.page}>
      <View
        style={[styles.edgeTop, { backgroundColor: theme.accentDeep }]}
        fixed
      />
      <Chrome doc={doc} theme={theme} />
      <View style={styles.body}>
        <Text style={[styles.disclaimerHeading, { color: theme.accent }]}>
          {DISCLAIMER_HEADING.replace(/:$/, "").toUpperCase()}
        </Text>
        {DISCLAIMER_PARAGRAPHS.map((paragraph, index) => (
          <Text key={index} style={styles.disclaimerText}>
            {paragraph}
          </Text>
        ))}
      </View>
      <View
        style={[styles.edgeBottom, { backgroundColor: theme.accentDeep }]}
        fixed
      />
      <Footer doc={doc} pageNumber={sheetCount(doc)} />
    </Page>
  );
}

export function DailyMoverReport({ doc }: { doc: ReportDoc }) {
  const theme = deckTheme(doc.movePct);
  return (
    <Document
      title={`${doc.ticker} Daily Mover — ${formatReportDate(doc.moveDate)}`}
      author={`${doc.analystName}, Vitti Capital`}
      subject={`Daily Mover: ${doc.companyName} (${doc.ticker})`}
    >
      {doc.pages.map((page, index) => (
        <Sheet key={index} doc={doc} pageNumber={index + 1} theme={theme}>
          {page.kind === "cover" || page.kind === "snapshot" ? null : (
            <PageHeading page={page} accent={pageAccent(page.kind, theme)} />
          )}
          <PageBody doc={doc} page={page} theme={theme} />
        </Sheet>
      ))}
      {isSnapshotDoc(doc) ? null : <DisclaimerPage doc={doc} theme={theme} />}
    </Document>
  );
}
