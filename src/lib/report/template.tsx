import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import {
  CLOSING_SIGN_OFF,
  DISCLAIMER_HEADING,
  DISCLAIMER_PARAGRAPHS,
  formatEyebrow,
  formatReportDate,
  MANAGEMENT_QUESTION_HEADING,
  type ReportCallout,
  type ReportChart,
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
 * the document's rhythm (eyebrow, one idea per page, big-number cards, running
 * footer), and that is a component tree either way. This route adds no ~50 MB
 * Chromium binary, no cold-start penalty and no memory tuning, and Next.js
 * already treats `@react-pdf/renderer` as an external server package.
 *
 * Fonts are the built-in Helvetica rather than the dashboard's Plus Jakarta
 * Sans. Registering a Google font means react-pdf fetching a TTF over the
 * network at render time — a new failure mode on the critical path of a cron
 * run, in exchange for a typeface nobody sees next to the UI. Helvetica is also
 * simply what institutional research is set in.
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

const PALETTE = {
  navy: "#1B2A4A",
  ink: "#111827",
  muted: "#64748B",
  faint: "#94A3B8",
  hairline: "#E2E8F0",
  wash: "#F8FAFC",
  paper: "#FFFFFF",

  /**
   * Chart and verdict colours.
   *
   * Deliberately desaturated. A Daily Mover is printed and forwarded, and the
   * saturated red/green of a trading screen reads as an opinion on the page —
   * which is exactly what these charts must not be. `steel` is the default bar;
   * `navy` is the highlighted one the conclusion is about, so emphasis comes
   * from the house colour rather than from a second hue.
   */
  steel: "#94A3B8",
  positive: "#166534",
  negative: "#9F1239",
  track: "#EEF2F7",
} as const;

const styles = StyleSheet.create({
  page: {
    backgroundColor: PALETTE.paper,
    paddingTop: 44,
    paddingBottom: 56,
    paddingHorizontal: 52,
    fontFamily: "Helvetica",
    color: PALETTE.ink,
    fontSize: 10.5,
    lineHeight: 1.5,
  },

  /** The "A S X : S P Z" eyebrow that opens every page. */
  eyebrow: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.6,
    color: PALETTE.faint,
    marginBottom: 22,
  },

  /**
   * Absolutely positioned so page content can flow to its natural length
   * without pushing the footer around, and `fixed` so it repeats if a page's
   * content ever overflows onto a second sheet.
   */
  footer: {
    position: "absolute",
    bottom: 28,
    left: 52,
    right: 52,
    borderTopWidth: 0.75,
    borderTopColor: PALETTE.hairline,
    paddingTop: 8,
    fontSize: 7.5,
    color: PALETTE.faint,
  },

  coverCompany: {
    fontFamily: "Helvetica-Bold",
    fontSize: 30,
    lineHeight: 1.15,
    color: PALETTE.navy,
    marginBottom: 16,
  },
  coverHeadline: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    lineHeight: 1.4,
    color: PALETTE.ink,
    marginBottom: 30,
  },
  coverRule: {
    borderBottomWidth: 2,
    borderBottomColor: PALETTE.navy,
    width: 56,
    marginBottom: 26,
  },

  pageTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 19,
    lineHeight: 1.2,
    color: PALETTE.navy,
    marginBottom: 14,
  },
  intro: {
    fontSize: 10.5,
    color: PALETTE.ink,
    marginBottom: 16,
  },
  paragraph: {
    fontSize: 10.5,
    marginBottom: 10,
  },

  calloutLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.2,
    color: PALETTE.navy,
    marginBottom: 5,
  },
  calloutText: {
    fontSize: 10,
    marginBottom: 14,
  },

  /** KPI cards: a wrapping row of fixed-basis cards, two or three up. */
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
    marginBottom: 8,
  },
  kpiCard: {
    borderLeftWidth: 2.5,
    borderLeftColor: PALETTE.navy,
    backgroundColor: PALETTE.wash,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginRight: 10,
    marginBottom: 10,
    minHeight: 74,
  },
  kpiValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 21,
    color: PALETTE.navy,
    marginBottom: 4,
  },
  kpiLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    // Tighter than the eyebrow's tracking: letter-spacing is what pushed these
    // labels past the card width in the first place.
    letterSpacing: 0.5,
    color: PALETTE.muted,
  },
  kpiNote: {
    fontSize: 8.5,
    color: PALETTE.muted,
    marginTop: 5,
    lineHeight: 1.35,
  },

  note: {
    fontSize: 9.5,
    color: PALETTE.muted,
    marginBottom: 7,
  },

  entity: {
    borderTopWidth: 0.75,
    borderTopColor: PALETTE.hairline,
    paddingTop: 10,
    marginBottom: 12,
  },
  entityName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11.5,
    color: PALETTE.navy,
    marginBottom: 3,
  },
  entityStat: {
    fontSize: 9.5,
    color: PALETTE.ink,
    marginBottom: 3,
  },
  entityComment: {
    fontSize: 9.5,
    color: PALETTE.muted,
  },

  riskItem: {
    marginBottom: 12,
  },
  riskLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10.5,
    color: PALETTE.navy,
    marginBottom: 3,
  },
  riskText: {
    fontSize: 9.5,
    color: PALETTE.ink,
  },

  statement: {
    fontSize: 12,
    lineHeight: 1.5,
    marginBottom: 14,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: PALETTE.hairline,
  },
  signature: {
    marginTop: 26,
    paddingTop: 12,
    borderTopWidth: 0.75,
    borderTopColor: PALETTE.hairline,
  },
  signatureName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: PALETTE.navy,
  },
  signatureRole: {
    fontSize: 9,
    color: PALETTE.muted,
  },

  disclaimerHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: PALETTE.ink,
    marginBottom: 12,
  },
  disclaimerText: {
    fontSize: 8.5,
    lineHeight: 1.55,
    color: PALETTE.muted,
    marginBottom: 10,
  },

  // --- charts (instruction 32) -------------------------------------------
  chartFrame: {
    marginTop: 6,
    marginBottom: 14,
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  chartBaseline: {
    height: 0.75,
    backgroundColor: PALETTE.muted,
  },
  chartCell: {
    paddingHorizontal: 4,
  },
  chartValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: PALETTE.ink,
    textAlign: "center",
    marginTop: 6,
  },
  chartCategory: {
    fontSize: 8,
    color: PALETTE.muted,
    textAlign: "center",
    marginTop: 2,
  },
  chartUnit: {
    fontSize: 8,
    color: PALETTE.faint,
    marginBottom: 8,
  },
  /** The "what to notice" line. Instruction 32 makes it part of the chart. */
  chartConclusion: {
    borderLeftWidth: 2,
    borderLeftColor: PALETTE.navy,
    backgroundColor: PALETTE.wash,
    paddingVertical: 9,
    paddingHorizontal: 12,
    fontSize: 10,
    lineHeight: 1.45,
    marginBottom: 12,
  },
  /** Horizontal-bar variant, for named categories rather than periods. */
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  barLabel: {
    width: "30%",
    fontSize: 9,
    color: PALETTE.ink,
    paddingRight: 8,
  },
  barTrack: {
    width: "55%",
    height: 14,
    backgroundColor: PALETTE.track,
    flexDirection: "row",
  },
  barValue: {
    width: "15%",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: PALETTE.ink,
    textAlign: "right",
  },

  // --- market vs reality (instruction 28) --------------------------------
  mvrBlock: {
    borderLeftWidth: 2.5,
    paddingLeft: 12,
    paddingVertical: 4,
    marginBottom: 16,
  },
  mvrLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.2,
    color: PALETTE.muted,
    marginBottom: 5,
  },
  mvrText: {
    fontSize: 10.5,
    lineHeight: 1.5,
  },

  // --- comparison table (instructions 29 and 30) -------------------------
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.navy,
    paddingBottom: 5,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: PALETTE.hairline,
    paddingVertical: 7,
  },
  tableHeadCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 0.8,
    color: PALETTE.muted,
  },
  tableMetric: {
    width: "37%",
    fontSize: 9.5,
    paddingRight: 6,
  },
  tableFigure: {
    width: "21%",
    fontSize: 9.5,
    textAlign: "right",
    paddingRight: 6,
  },
  tableChange: {
    width: "21%",
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    textAlign: "right",
  },

  // --- Vitti View (instruction 33) ---------------------------------------
  ratingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    borderBottomWidth: 0.75,
    borderBottomColor: PALETTE.hairline,
    paddingVertical: 8,
  },
  ratingLabel: {
    width: "34%",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1,
    color: PALETTE.muted,
  },
  ratingValue: {
    width: "22%",
    fontFamily: "Helvetica-Bold",
    fontSize: 11.5,
    color: PALETTE.navy,
  },
  ratingNote: {
    width: "44%",
    fontSize: 9,
    color: PALETTE.muted,
  },

  // --- outlook (instruction 35) ------------------------------------------
  outlookColumns: {
    flexDirection: "row",
    marginTop: 4,
  },
  outlookColumn: {
    width: "50%",
    paddingRight: 14,
  },
  outlookHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.1,
    marginBottom: 9,
  },
  outlookItem: {
    fontSize: 9.5,
    lineHeight: 1.45,
    marginBottom: 7,
  },

  // --- closing extras (instructions 34 and 37) ---------------------------
  questionBlock: {
    marginTop: 18,
    borderWidth: 0.75,
    borderColor: PALETTE.hairline,
    backgroundColor: PALETTE.wash,
    padding: 12,
  },
  questionHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.2,
    color: PALETTE.muted,
    marginBottom: 5,
  },
  questionText: {
    fontSize: 10,
    lineHeight: 1.45,
    color: PALETTE.ink,
  },
  signOff: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: PALETTE.navy,
    marginTop: 20,
  },
});

/**
 * KPI cards share the row width, so their basis depends on how many there are.
 *
 * Four cards go two-up over two rows rather than four-up in one. A quarter-width
 * card is about 90pt of usable text, which is narrower than labels like "CASH
 * CONSIDERATION" and their explanatory notes — the four-up row looked right in
 * the abstract and produced stacks of two-and-three-letter fragments with real
 * content in it.
 */
function kpiWidth(count: number): string {
  if (count <= 1) return "100%";
  if (count === 3) return "30.5%";
  return "47%";
}

function KpiCards({ kpis }: { kpis: ReportKpi[] }) {
  const width = kpiWidth(kpis.length);

  return (
    <View style={styles.kpiRow}>
      {kpis.map((kpi, index) => (
        <View key={index} style={[styles.kpiCard, { width }]}>
          <Text style={styles.kpiValue}>{kpi.value}</Text>
          <Text style={styles.kpiLabel}>{kpi.label.toUpperCase()}</Text>
          {kpi.note ? <Text style={styles.kpiNote}>{kpi.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function Callouts({ callouts }: { callouts: ReportCallout[] }) {
  return (
    <>
      {callouts.map((callout, index) => (
        <View key={index} wrap={false}>
          <Text style={styles.calloutLabel}>
            {callout.label.toUpperCase()}
          </Text>
          <Text style={styles.calloutText}>{callout.text}</Text>
        </View>
      ))}
    </>
  );
}

/** Plot height in points. Leaves room for a title, a conclusion and callouts. */
const CHART_PLOT_HEIGHT = 132;

/** How a point prints: its own `display`, or the raw number as a fallback. */
function pointLabel(value: number, display?: string | null): string {
  return display?.trim() || String(value);
}

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

  const barColour = (point: (typeof points)[number]) => {
    if (point.highlight) return PALETTE.navy;
    return point.value < 0 ? PALETTE.negative : PALETTE.steel;
  };

  return (
    <View style={styles.chartFrame}>
      {chart.unit ? <Text style={styles.chartUnit}>{chart.unit}</Text> : null}

      {positiveHeight > 0 ? (
        <View style={[styles.chartRow, { height: positiveHeight }]}>
          {points.map((point, index) => (
            <View
              key={index}
              style={[styles.chartCell, { width: cellWidth, height: "100%", justifyContent: "flex-end" }]}
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
          <View key={index} style={{ width: cellWidth }}>
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
                width: `${Math.max(1, (Math.abs(point.value) / maxAbsolute) * 100)}%`,
                backgroundColor: point.highlight
                  ? PALETTE.navy
                  : point.value < 0
                    ? PALETTE.negative
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

function ChartBlock({ chart }: { chart: ReportChart }) {
  return chart.type === "bars" ? (
    <BarChart chart={chart} />
  ) : (
    <ColumnChart chart={chart} />
  );
}

/** Verdict colour for a comparison row. Neutral by default — see `PALETTE`. */
function changeColour(direction: ReportComparisonRow["direction"]): string {
  if (direction === "better") return PALETTE.positive;
  if (direction === "worse") return PALETTE.negative;
  return PALETTE.ink;
}

function ManagementQuestion({ question }: { question: string }) {
  return (
    <View style={styles.questionBlock} wrap={false}>
      <Text style={styles.questionHeading}>
        {MANAGEMENT_QUESTION_HEADING.toUpperCase()}
      </Text>
      <Text style={styles.questionText}>{question}</Text>
    </View>
  );
}

function Footer({ doc }: { doc: ReportDoc }) {
  return (
    <View style={styles.footer} fixed>
      <Text>
        {`Daily Mover Report  |  ${formatReportDate(doc.moveDate)}  |  Analyst: ${doc.analystName}`}
      </Text>
    </View>
  );
}

function PageFrame({
  doc,
  children,
}: {
  doc: ReportDoc;
  children: React.ReactNode;
}) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.eyebrow}>{formatEyebrow(doc.ticker)}</Text>
      {children}
      <Footer doc={doc} />
    </Page>
  );
}

function ContentPage({ doc, page }: { doc: ReportDoc; page: ReportPage }) {
  switch (page.kind) {
    case "cover":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.coverCompany}>{page.companyName}</Text>
          <View style={styles.coverRule} />
          <Text style={styles.coverHeadline}>{page.headline}</Text>
          <KpiCards kpis={page.kpis.slice(0, 2)} />
        </PageFrame>
      );

    case "narrative":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.pageTitle}>{page.title}</Text>
          {page.intro ? <Text style={styles.intro}>{page.intro}</Text> : null}
          {page.paragraphs.map((paragraph, index) => (
            <Text key={index} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
          {page.callouts?.length ? (
            <View style={{ marginTop: 10 }}>
              <Callouts callouts={page.callouts} />
            </View>
          ) : null}
        </PageFrame>
      );

    case "kpis":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.pageTitle}>{page.title}</Text>
          {page.intro ? <Text style={styles.intro}>{page.intro}</Text> : null}
          <KpiCards kpis={page.kpis} />
          {page.notes?.map((note, index) => (
            <Text key={index} style={styles.note}>
              {note}
            </Text>
          ))}
          {page.callouts?.length ? (
            <View style={{ marginTop: 12 }}>
              <Callouts callouts={page.callouts} />
            </View>
          ) : null}
        </PageFrame>
      );

    case "entities":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.pageTitle}>{page.title}</Text>
          {page.intro ? <Text style={styles.intro}>{page.intro}</Text> : null}
          {page.items.map((item, index) => (
            <View key={index} style={styles.entity} wrap={false}>
              <Text style={styles.entityName}>{item.name}</Text>
              <Text style={styles.entityStat}>{item.stat}</Text>
              {item.comment ? (
                <Text style={styles.entityComment}>{item.comment}</Text>
              ) : null}
            </View>
          ))}
        </PageFrame>
      );

    case "risks":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.pageTitle}>{page.title}</Text>
          {page.items.map((item, index) => (
            <View key={index} style={styles.riskItem} wrap={false}>
              <Text style={styles.riskLabel}>{item.label}</Text>
              <Text style={styles.riskText}>{item.text}</Text>
            </View>
          ))}
        </PageFrame>
      );

    case "chart":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.pageTitle}>{page.title}</Text>
          {page.intro ? <Text style={styles.intro}>{page.intro}</Text> : null}
          <ChartBlock chart={page.chart} />
          <Text style={styles.chartConclusion}>{page.conclusion}</Text>
          {page.callouts?.length ? (
            <View style={{ marginTop: 6 }}>
              <Callouts callouts={page.callouts} />
            </View>
          ) : null}
        </PageFrame>
      );

    case "market-vs-reality":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.pageTitle}>{page.title}</Text>
          <View style={[styles.mvrBlock, { borderLeftColor: PALETTE.faint }]}>
            <Text style={styles.mvrLabel}>HEADLINE</Text>
            <Text style={styles.mvrText}>{page.headline}</Text>
          </View>
          <View style={[styles.mvrBlock, { borderLeftColor: PALETTE.steel }]}>
            <Text style={styles.mvrLabel}>MARKET FOCUS</Text>
            <Text style={styles.mvrText}>{page.marketFocus}</Text>
          </View>
          <View style={[styles.mvrBlock, { borderLeftColor: PALETTE.navy }]}>
            <Text style={styles.mvrLabel}>WHAT REALLY MATTERS</Text>
            <Text style={styles.mvrText}>{page.whatMatters}</Text>
          </View>
        </PageFrame>
      );

    case "comparison":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.pageTitle}>{page.title}</Text>
          {page.intro ? <Text style={styles.intro}>{page.intro}</Text> : null}
          <View style={styles.tableHead}>
            <Text style={[styles.tableMetric, styles.tableHeadCell]}>
              {page.columns[0].toUpperCase()}
            </Text>
            <Text style={[styles.tableFigure, styles.tableHeadCell]}>
              {page.columns[1].toUpperCase()}
            </Text>
            <Text style={[styles.tableFigure, styles.tableHeadCell]}>
              {page.columns[2].toUpperCase()}
            </Text>
            <Text style={[styles.tableChange, styles.tableHeadCell]}>
              CHANGE
            </Text>
          </View>
          {page.rows.map((row, index) => (
            <View key={index} style={styles.tableRow} wrap={false}>
              <Text style={styles.tableMetric}>{row.metric}</Text>
              <Text style={styles.tableFigure}>{row.before}</Text>
              <Text style={styles.tableFigure}>{row.now}</Text>
              <Text
                style={[styles.tableChange, { color: changeColour(row.direction) }]}
              >
                {row.change}
              </Text>
            </View>
          ))}
          {page.conclusion ? (
            <Text style={[styles.chartConclusion, { marginTop: 16 }]}>
              {page.conclusion}
            </Text>
          ) : null}
        </PageFrame>
      );

    case "vitti-view":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.pageTitle}>{page.title}</Text>
          {page.ratings.map((rating, index) => (
            <View key={index} style={styles.ratingRow} wrap={false}>
              <Text style={styles.ratingLabel}>
                {rating.label.toUpperCase()}
              </Text>
              <Text style={styles.ratingValue}>{rating.value}</Text>
              <Text style={styles.ratingNote}>{rating.note ?? ""}</Text>
            </View>
          ))}
          <View style={{ marginTop: 18 }}>
            <Text style={styles.calloutLabel}>KEY DEBATE</Text>
            <Text style={styles.calloutText}>{page.keyDebate}</Text>
            <Text style={styles.calloutLabel}>NEXT CATALYST</Text>
            <Text style={styles.calloutText}>{page.nextCatalyst}</Text>
          </View>
          {page.managementQuestion ? (
            <ManagementQuestion question={page.managementQuestion} />
          ) : null}
        </PageFrame>
      );

    case "outlook":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.pageTitle}>{page.title}</Text>
          {page.intro ? <Text style={styles.intro}>{page.intro}</Text> : null}
          <View style={styles.outlookColumns}>
            <View style={styles.outlookColumn}>
              <Text style={[styles.outlookHeading, { color: PALETTE.positive }]}>
                WHAT WOULD IMPROVE THE STORY
              </Text>
              {page.improve.map((item, index) => (
                <Text key={index} style={styles.outlookItem}>
                  {`•  ${item}`}
                </Text>
              ))}
            </View>
            <View style={styles.outlookColumn}>
              <Text style={[styles.outlookHeading, { color: PALETTE.negative }]}>
                WHAT WOULD MAKE IT WORSE
              </Text>
              {page.worsen.map((item, index) => (
                <Text key={index} style={styles.outlookItem}>
                  {`•  ${item}`}
                </Text>
              ))}
            </View>
          </View>
        </PageFrame>
      );

    case "closing":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.pageTitle}>{page.title}</Text>
          {page.statements.map((statement, index) => (
            <Text key={index} style={styles.statement}>
              {statement}
            </Text>
          ))}
          {page.managementQuestion ? (
            <ManagementQuestion question={page.managementQuestion} />
          ) : null}
          {/* Instruction 37: the house sign-off, verbatim and never model-written. */}
          <Text style={styles.signOff}>{CLOSING_SIGN_OFF}</Text>
          <View style={styles.signature}>
            <Text style={styles.signatureName}>{doc.analystName}</Text>
            <Text style={styles.signatureRole}>Research Analyst</Text>
          </View>
        </PageFrame>
      );
  }
}

/**
 * The compliance page. Appended here rather than emitted by the model — see the
 * note on `DISCLAIMER_PARAGRAPHS`.
 */
function DisclaimerPage() {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.disclaimerHeading}>{DISCLAIMER_HEADING}</Text>
      {DISCLAIMER_PARAGRAPHS.map((paragraph, index) => (
        <Text key={index} style={styles.disclaimerText}>
          {paragraph}
        </Text>
      ))}
    </Page>
  );
}

export function DailyMoverReport({ doc }: { doc: ReportDoc }) {
  return (
    <Document
      title={`Daily Mover ${doc.ticker} ${doc.moveDate}`}
      author="Vitti Capital"
      subject={`${doc.companyName} (ASX: ${doc.ticker}) Daily Mover`}
      creator="Vitti Capital Daily Movers Terminal"
    >
      {doc.pages.map((page, index) => (
        <ContentPage key={index} doc={doc} page={page} />
      ))}
      <DisclaimerPage />
    </Document>
  );
}
