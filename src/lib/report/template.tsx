import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import {
  DISCLAIMER_HEADING,
  DISCLAIMER_PARAGRAPHS,
  formatEyebrow,
  formatReportDate,
  type ReportCallout,
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

    case "closing":
      return (
        <PageFrame doc={doc}>
          <Text style={styles.pageTitle}>{page.title}</Text>
          {page.statements.map((statement, index) => (
            <Text key={index} style={styles.statement}>
              {statement}
            </Text>
          ))}
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
