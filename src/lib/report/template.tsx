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
import {
  CLOSING_SIGN_OFF,
  DISCLAIMER_HEADING,
  DISCLAIMER_PARAGRAPHS,
  formatEyebrow,
  formatReportDate,
  MANAGEMENT_QUESTION_HEADING,
  type ReportCallout,
  type ReportChart,
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
 * The accent a page is drawn in, by kind.
 *
 * Centralised so the code stays consistent as pages are added — the alternative
 * is a colour chosen at each render site, which is how a document ends up with
 * four greens. Only risk pages leave the mint, because only risk has a
 * direction that the reader should feel before reading.
 */
function pageAccent(kind: ReportPage["kind"]): string {
  return kind === "risks" ? PALETTE.coral : PALETTE.mint;
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
  chartCell: { justifyContent: "flex-end", paddingHorizontal: 5 },
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
  barLabel: { width: 150, fontSize: 9.5, color: PALETTE.body, paddingRight: 10 },
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
  disclaimerHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    letterSpacing: 1.4,
    color: PALETTE.mint,
    marginBottom: 12,
  },
  disclaimerText: {
    fontSize: 9.5,
    lineHeight: 1.5,
    color: PALETTE.muted,
    marginBottom: 8,
    maxWidth: 640,
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
          <Circle cx="7" cy="7" r="5" fill="none" stroke={stroke} strokeWidth={1.4} />
          <Line x1="7" y1="3.4" x2="7" y2="10.6" stroke={stroke} strokeWidth={1.4} />
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
          <Rect x="2.5" y="1.5" width="9" height="11" fill="none" stroke={stroke} strokeWidth={1.2} />
          <Line x1="4.6" y1="5" x2="9.4" y2="5" stroke={stroke} strokeWidth={1.1} />
          <Line x1="4.6" y1="8" x2="9.4" y2="8" stroke={stroke} strokeWidth={1.1} />
        </>
      );
    case "regulation":
      return (
        <>
          <Line x1="7" y1="2" x2="7" y2="12" stroke={stroke} strokeWidth={1.3} />
          <Line x1="2.2" y1="4.4" x2="11.8" y2="4.4" stroke={stroke} strokeWidth={1.3} />
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
          <Circle cx="7" cy="7" r="3.2" fill="none" stroke={stroke} strokeWidth={1.6} />
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
          <Rect x="6.3" y="5.4" width="1.4" height="3.6" fill={PALETTE.coralDeep} />
          <Rect x="6.3" y="9.8" width="1.4" height="1.4" fill={PALETTE.coralDeep} />
        </>
      );
    case "timing":
      return (
        <>
          <Circle cx="7" cy="7" r="5.2" fill="none" stroke={stroke} strokeWidth={1.3} />
          <Line x1="7" y1="4" x2="7" y2="7.4" stroke={stroke} strokeWidth={1.3} />
          <Line x1="7" y1="7.4" x2="9.6" y2="8.8" stroke={stroke} strokeWidth={1.3} />
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
          <Circle cx="7" cy="7" r="5.2" fill="none" stroke={stroke} strokeWidth={1.3} />
          <Line x1="1.8" y1="7" x2="12.2" y2="7" stroke={stroke} strokeWidth={1.2} />
          <Path d="M7 1.8 C4 4.6 4 9.4 7 12.2 C10 9.4 10 4.6 7 1.8 Z" fill="none" stroke={stroke} strokeWidth={1.2} />
        </>
      );
    default:
      return <Circle cx="7" cy="7" r="3.2" fill={stroke} />;
  }
}

/** The icon in its coloured disc — mint by default, coral on a risks page. */
function IconDisc({
  name,
  tone = PALETTE.mintDeep,
  size = 26,
}: {
  name?: string | null;
  tone?: string;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.disc,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: tone },
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

function sheetCount(doc: ReportDoc): number {
  return doc.pages.length + 1;
}

function Chrome({ doc }: { doc: ReportDoc }) {
  return (
    <View style={styles.chrome}>
      <Text style={styles.eyebrow}>{formatEyebrow(doc.ticker)}</Text>
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
function Footer({
  doc,
  pageNumber,
}: {
  doc: ReportDoc;
  pageNumber: number;
}) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>
        <Text style={styles.footerStrong}>Daily Mover Report</Text>
        {`   |   ${formatReportDate(doc.moveDate)}   |   Analyst: ${doc.analystName}`}
      </Text>
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
}: {
  doc: ReportDoc;
  pageNumber: number;
  children: ReactNode;
}) {
  return (
    <Page size={PAGE_SIZE} style={styles.page}>
      <View style={styles.edgeTop} fixed />
      <Chrome doc={doc} />
      {children}
      <View style={styles.edgeBottom} fixed />
      <Footer doc={doc} pageNumber={pageNumber} />
    </Page>
  );
}

function SourceLine({ note }: { note?: string | null }) {
  if (!note?.trim()) return null;
  return <Text style={styles.source}>{note.trim()}</Text>;
}

/** The full-width accent band a page ends on when it has a conclusion. */
function ConclusionBand({ text }: { text?: string | null }) {
  if (!text?.trim()) return null;
  return (
    <View style={styles.band} wrap={false}>
      <Rich style={styles.bandText} strongStyle={{ color: PALETTE.mintInk }}>
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
      <Text style={styles.heading}>{page.title}</Text>
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
}: {
  kpi: ReportKpi;
  width: string;
  tone?: "accent" | "negative" | "cobalt" | "plain";
}) {
  const filled = tone === "accent" || tone === "negative" || tone === "cobalt";
  const background =
    tone === "accent"
      ? PALETTE.mint
      : tone === "negative"
        ? PALETTE.coral
        : tone === "cobalt"
          ? PALETTE.cobalt
          : PALETTE.card;

  const valueColour = tone === "accent" ? PALETTE.mintInk : PALETTE.paper;
  const labelColour = tone === "accent" ? PALETTE.mintInk : PALETTE.paper;
  const noteColour =
    tone === "accent"
      ? "#0C5A43"
      : filled
        ? "#F2F5F9"
        : PALETTE.muted;

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
        <Text style={[styles.tileValue, { color: valueColour }]}>{kpi.value}</Text>
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
function TileGrid({ kpis }: { kpis: ReportKpi[] }) {
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

function Bullets({
  items,
  accent,
}: {
  items: string[];
  accent: string;
}) {
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
function ColumnChart({ chart }: { chart: ReportChart }) {
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
    if (point.highlight) return PALETTE.mint;
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
                  style={{
                    // A floor of 2pt so a small positive still reads as present
                    // rather than as a missing period.
                    height: Math.max(2, (positiveHeight * point.value) / maxPositive),
                    backgroundColor: barColour(point),
                  }}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.chartBaseline} />

      {negativeHeight > 0 ? (
        <View style={[styles.chartRow, { height: negativeHeight, alignItems: "flex-start" }]}>
          {points.map((point, index) => (
            <View key={index} style={[styles.chartCell, { width: cellWidth }]}>
              {point.value < 0 ? (
                <View
                  style={{
                    height: Math.max(2, (negativeHeight * -point.value) / maxNegative),
                    backgroundColor: barColour(point),
                  }}
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
function BarChart({ chart }: { chart: ReportChart }) {
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
                  ? PALETTE.mint
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

function WaterfallChart({ chart }: { chart: ReportChart }) {
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
              ? PALETTE.mint
              : PALETTE.steel
            : span.point.value < 0
              ? PALETTE.coral
              : PALETTE.mint;

          return (
            <View
              key={index}
              style={[styles.chartCell, { width: cellWidth, height: "100%" }]}
            >
              <View style={{ height, backgroundColor: colour }} />
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

function ChartBlock({ chart }: { chart: ReportChart }) {
  if (chart.type === "bars") return <BarChart chart={chart} />;
  if (chart.type === "waterfall") return <WaterfallChart chart={chart} />;
  return <ColumnChart chart={chart} />;
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

function ManagementQuestion({ question }: { question?: string | null }) {
  if (!question?.trim()) return null;
  return (
    <View style={styles.question} wrap={false}>
      <Text style={styles.questionHeading}>
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
}: {
  doc: ReportDoc;
  page: Extract<ReportPage, { kind: "cover" }>;
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
      <View style={styles.coverRule} />

      <View style={styles.tileRow}>
        {move ? (
          <Tile kpi={move} width="50%" tone={falling ? "negative" : "accent"} />
        ) : null}
        {second ? <Tile kpi={second} width="50%" tone="cobalt" /> : null}
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
}: {
  page: Extract<ReportPage, { kind: "risks" }>;
}) {
  const perRow = page.items.length <= 2 ? page.items.length : 3;
  const width = `${100 / perRow}%`;
  return (
    <View style={styles.body}>
      <View style={styles.tileRow}>
        {page.items.map((item, index) => (
          <View key={index} style={[styles.tileCell, { width }]}>
            <View style={styles.tile} wrap={false}>
              <IconDisc name={item.icon} tone={PALETTE.coralDeep} />
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
}: {
  page: Extract<ReportPage, { kind: "entities" }>;
}) {
  return (
    <View style={styles.body}>
      {page.items.map((item, index) => (
        <View key={index} style={{ marginBottom: 10 }} wrap={false}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <IconDisc name="chart" size={20} />
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
                color: PALETTE.mint,
                marginLeft: 10,
                flex: 1,
              }}
              strongStyle={{ fontFamily: "Helvetica-Bold", color: PALETTE.mint }}
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
}: {
  page: Extract<ReportPage, { kind: "comparison" }>;
}) {
  return (
    <View style={styles.body}>
      <View style={styles.compHead}>
        <Text style={[styles.compMetric, styles.compHeadCell, { paddingTop: 0, color: PALETTE.muted }]}>
          {page.columns[0].toUpperCase()}
        </Text>
        <Text style={[styles.compHeadCell, { flex: 1, color: PALETTE.muted, marginRight: 8 }]}>
          {page.columns[1].toUpperCase()}
        </Text>
        <Text style={[styles.compHeadCell, { flex: 1, color: PALETTE.mint }]}>
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
          <View style={[styles.compNow, { borderColor: PALETTE.mintDeep }]}>
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

      <ConclusionBand text={page.conclusion} />
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
}: {
  page: Extract<ReportPage, { kind: "timeline" }>;
}) {
  const width = `${100 / page.events.length}%`;
  return (
    <View style={styles.bodyCentred}>
      <View style={styles.timelineRow}>
        {/* The rule the marks sit on, inset so it starts at the first disc. */}
        <View style={[styles.timelineTrack, { top: 33 }]} />
        {page.events.map((event, index) => (
          <View key={index} style={[styles.timelineCell, { width }]}>
            <Text style={styles.timelineDate}>{event.date}</Text>
            <IconDisc name={event.icon} size={28} />
            <Rich style={styles.timelineText}>{event.text}</Rich>
          </View>
        ))}
      </View>
      <ConclusionBand text={page.conclusion} />
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function MarketVsRealityBody({
  page,
}: {
  page: Extract<ReportPage, { kind: "market-vs-reality" }>;
}) {
  const blocks: Array<{ label: string; text: string; tone: string }> = [
    { label: "What was announced", text: page.headline, tone: PALETTE.cobalt },
    { label: "What the market reacted to", text: page.marketFocus, tone: PALETTE.coral },
    { label: "What decides it from here", text: page.whatMatters, tone: PALETTE.mint },
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
}: {
  page: Extract<ReportPage, { kind: "vitti-view" }>;
}) {
  return (
    <View style={styles.body}>
      <View style={styles.tileRow}>
        {page.ratings.map((rating, index) => (
          <View
            key={index}
            style={[styles.tileCell, { width: `${100 / Math.max(1, page.ratings.length)}%` }]}
          >
            <View style={styles.tile} wrap={false}>
              <Text style={[styles.tileValue, { fontSize: 16, color: PALETTE.mint }]}>
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
        <Text style={styles.sectionLabel}>THE KEY DEBATE</Text>
        <Rich style={styles.paragraph}>{page.keyDebate}</Rich>
        <Text style={styles.sectionLabel}>NEXT CATALYST</Text>
        <Rich style={styles.paragraph}>{page.nextCatalyst}</Rich>
      </View>

      <ManagementQuestion question={page.managementQuestion} />
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function OutlookBody({
  page,
}: {
  page: Extract<ReportPage, { kind: "outlook" }>;
}) {
  const [left, right] = page.columns ?? [
    "What would improve the story",
    "What would make it worse",
  ];
  return (
    <View style={styles.body}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ flex: 1, paddingRight: 18 }}>
          <Text style={[styles.sectionLabel, { color: PALETTE.mint }]}>
            {left.toUpperCase()}
          </Text>
          <View style={styles.rule} />
          <Bullets items={page.improve} accent={PALETTE.mint} />
        </View>
        <View style={{ flex: 1, paddingLeft: 18 }}>
          <Text style={[styles.sectionLabel, { color: PALETTE.coral }]}>
            {right.toUpperCase()}
          </Text>
          <View style={styles.rule} />
          <Bullets items={page.worsen} accent={PALETTE.coral} />
        </View>
      </View>
      <ConclusionBand text={page.conclusion} />
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function ManagementBody({
  page,
}: {
  page: Extract<ReportPage, { kind: "management" }>;
}) {
  return (
    <View style={styles.body}>
      <View style={styles.tileRow}>
        {page.people.map((person, index) => (
          <View
            key={index}
            style={[styles.tileCell, { width: `${100 / Math.max(1, page.people.length)}%` }]}
          >
            <View style={styles.tile} wrap={false}>
              <IconDisc name="people" size={22} />
              <Text
                style={[styles.tileLabel, { fontSize: 10.5, letterSpacing: 0, marginTop: 9 }]}
              >
                {person.name}
              </Text>
              <Text style={[styles.tileNote, { color: PALETTE.mint }]}>
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
          <Text style={styles.sectionLabel}>RECENT CHANGES</Text>
          <View style={styles.rule} />
          <Bullets items={page.changes} accent={PALETTE.mint} />
        </View>
      ) : null}
      <SourceLine note={page.sourceNote} />
    </View>
  );
}

function ClosingBody({
  doc,
  page,
}: {
  doc: ReportDoc;
  page: Extract<ReportPage, { kind: "closing" }>;
}) {
  return (
    <View style={styles.body}>
      {page.statements.map((statement, index) => (
        <Rich key={index} style={styles.paragraph}>
          {statement}
        </Rich>
      ))}

      <View style={styles.coverRule} />

      {page.pullQuote?.trim() ? (
        <Text style={styles.quote}>{`"${page.pullQuote.trim()}"`}</Text>
      ) : null}
      <Text style={[styles.quote, { marginTop: 8 }]}>
        {`"${CLOSING_SIGN_OFF}"`}
      </Text>

      <ManagementQuestion question={page.managementQuestion} />

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

function PageBody({ doc, page }: { doc: ReportDoc; page: ReportPage }) {
  const accent = pageAccent(page.kind);

  switch (page.kind) {
    case "cover":
      return <CoverBody doc={doc} page={page} />;

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
          <TileGrid kpis={page.kpis} />
          {page.notes?.map((note, index) => (
            <Text
              key={index}
              style={{ fontSize: 9.5, lineHeight: 1.4, color: PALETTE.muted }}
            >
              {note}
            </Text>
          ))}
          <Callouts callouts={page.callouts} accent={accent} />
          <ConclusionBand text={page.conclusion} />
          <SourceLine note={page.sourceNote} />
        </View>
      );

    case "entities":
      return <EntitiesBody page={page} />;

    case "risks":
      return <RisksBody page={page} />;

    case "chart":
      return (
        <View style={styles.bodyCentred}>
          <ChartBlock chart={page.chart} />
          <Callouts callouts={page.callouts} accent={accent} />
          <ConclusionBand text={page.conclusion} />
          <SourceLine note={page.sourceNote} />
        </View>
      );

    case "market-vs-reality":
      return <MarketVsRealityBody page={page} />;

    case "comparison":
      return <ComparisonBody page={page} />;

    case "timeline":
      return <TimelineBody page={page} />;

    case "management":
      return <ManagementBody page={page} />;

    case "vitti-view":
      return <VittiViewBody page={page} />;

    case "outlook":
      return <OutlookBody page={page} />;

    case "closing":
      return <ClosingBody doc={doc} page={page} />;
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
function DisclaimerPage({ doc }: { doc: ReportDoc }) {
  return (
    <Page size={PAGE_SIZE} style={styles.page}>
      <View style={styles.edgeTop} fixed />
      <Chrome doc={doc} />
      <View style={styles.body}>
        <Text style={styles.disclaimerHeading}>
          {DISCLAIMER_HEADING.replace(/:$/, "").toUpperCase()}
        </Text>
        {DISCLAIMER_PARAGRAPHS.map((paragraph, index) => (
          <Text key={index} style={styles.disclaimerText}>
            {paragraph}
          </Text>
        ))}
      </View>
      <View style={styles.edgeBottom} fixed />
      <Footer doc={doc} pageNumber={sheetCount(doc)} />
    </Page>
  );
}

export function DailyMoverReport({ doc }: { doc: ReportDoc }) {
  return (
    <Document
      title={`${doc.ticker} Daily Mover — ${formatReportDate(doc.moveDate)}`}
      author={`${doc.analystName}, Vitti Capital`}
      subject={`Daily Mover: ${doc.companyName} (${doc.ticker})`}
    >
      {doc.pages.map((page, index) => (
        <Sheet key={index} doc={doc} pageNumber={index + 1}>
          {page.kind === "cover" ? null : (
            <PageHeading page={page} accent={pageAccent(page.kind)} />
          )}
          <PageBody doc={doc} page={page} />
        </Sheet>
      ))}
      <DisclaimerPage doc={doc} />
    </Document>
  );
}
