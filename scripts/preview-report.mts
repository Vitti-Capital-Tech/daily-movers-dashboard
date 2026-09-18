/**
 * Renders a Daily Mover PDF without calling Claude.
 *
 * The template is the one part of the pipeline that can be iterated on for
 * free: a layout change does not need a new draft, and paying for a generation
 * to find out that a tile row wraps is both slow and expensive. This renders
 * either the built-in fixture — which deliberately exercises every page kind,
 * including the ones a real report only sometimes has — or a stored draft by
 * id, so a designer change can be checked against real copy.
 *
 *   npm run report:preview                       # the fixture
 *   npm run report:preview -- 8 out/sbm.pdf      # draft 8 from the database
 *
 * A draft id needs DATABASE_URL, which the npm script loads from .env.local;
 * the fixture needs nothing.
 *
 * ## Why the npm script bundles instead of running tsx directly
 *
 * `tsx scripts/preview-report.mts` fails on `@react-pdf/hyphenate`, whose
 * package exports declare only an `import` condition for its language subpaths
 * — so the CJS resolution tsx uses for `./en-us` raises
 * ERR_PACKAGE_PATH_NOT_EXPORTED. Next.js never hits it because it bundles the
 * renderer itself, and bundling here is the same fix: esbuild resolves the
 * subpath at build time and node only ever loads the bundle. The output goes
 * under node_modules/.cache, which is already ignored.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderToBuffer } from "@react-pdf/renderer";

import { fitReportPages } from "../src/lib/report/fit";
import { DailyMoverReport } from "../src/lib/report/template";
import { validateReportDoc, type ReportDoc } from "../src/lib/report/types";

/**
 * A report that uses every page kind the renderer knows.
 *
 * Longer than the page ceiling on purpose: this is a layout proof sheet, not a
 * publishable note, so it is rendered past `validateReportDoc` rather than
 * through it. The copy is modelled on the St Barbara divestment because that is
 * the note the current house rules were written against — the conditional
 * proceeds, the cash build-up, and what the company gives up as well as what it
 * gets.
 */
const FIXTURE: ReportDoc = {
  ticker: "SBM",
  companyName: "St Barbara Limited",
  moveDate: "2026-09-10",
  analystName: "Prasham Doshi",
  movePct: 17.81,
  pages: [
    {
      kind: "cover",
      companyName: "St Barbara Limited",
      headline:
        "SBM Shares Closed Up ~17.8% After Agreeing to Sell Its Remaining New Simberi Stake to Lingbao for $453 Million",
      kpis: [
        {
          value: "+17.8%",
          label: "Share move (close)",
          note: "On **2.9x** the 30-day average volume.",
        },
        {
          value: "$453M",
          label: "Headline consideration",
          note: "Cash on completion, plus a retained royalty.",
        },
      ],
      intro:
        "Completion is conditional on **PNG regulatory approvals**, so no cash has changed hands yet.",
      sourceNote:
        "Source: St Barbara to Sell Simberi Interest to Lingbao, ASX 10 Sep 2026; exchange feed.",
    },
    {
      kind: "kpis",
      title: "What the Deal Is Actually Worth",
      intro: "The figures the company put to the market this morning.",
      kpis: [
        { value: "$410M", label: "Cash consideration", note: "Payable on completion." },
        { value: "$43M", label: "Deferred", note: "Subject to conditions in the agreement." },
        { value: "$212M", label: "Royalty NPV", note: "Company figure at a 5% discount rate." },
        { value: "$880M", label: "Pro-forma cash", note: "Before dividends, buy-back and capex." },
        { value: "H2 FY28", label: "First sulphide ore", note: "Under the seller timetable." },
        { value: "$174.8M", label: "Debt repaid in 2025", note: "Out of the Laverton proceeds." },
      ],
      notes: ["Every figure on this page is the company figure, not ours."],
      conclusion:
        "The cash is large relative to the market capitalisation, but none of it is received before completion.",
      sourceNote:
        "Source: Simberi Transaction Presentation, ASX 10 Sep 2026, pp. 4-11.",
    },
    {
      kind: "chart",
      title: "Where the Cash Balance Actually Ends Up",
      chart: {
        type: "waterfall",
        unit: "$ million",
        points: [
          { label: "Cash now", value: 470, display: "$470M", isTotal: true },
          { label: "Sale proceeds", value: 410, display: "+$410M" },
          { label: "Dividend", value: -88, display: "-$88M" },
          { label: "Buy-back", value: -60, display: "-$60M" },
          { label: "15-Mile capex", value: -140, display: "-$140M" },
          { label: "Free cash", value: 592, display: "$592M", isTotal: true, highlight: true },
        ],
      },
      conclusion:
        "About two-thirds of the pro-forma balance is already committed, on the company's own guidance.",
      sourceNote: "Source: Simberi Transaction Presentation, ASX 10 Sep 2026, p. 14.",
    },
    {
      kind: "comparison",
      title: "What SBM Gets, and What It Gives Up",
      columns: ["Metric", "Gives up (Simberi)", "Receives"],
      rows: [
        {
          metric: "Production",
          before: "~180koz a year of oxide output",
          now: "No production until 15-Mile",
          change: "Worse",
          direction: "worse",
        },
        {
          metric: "Cash",
          before: "Ongoing capex commitment",
          now: "$410 million on completion",
          change: "Better",
          direction: "better",
        },
        {
          metric: "Upside",
          before: "100% of sulphide expansion",
          now: "Royalty, NPV $212 million",
          change: "Mixed",
          direction: "neutral",
        },
      ],
      conclusion:
        "The trade is certain cash now against the sulphide upside the company had been funding.",
      sourceNote: "Source: FY26 Financial Results, ASX 28 Aug 2026; transaction presentation.",
    },
    {
      kind: "timeline",
      title: "How the Simberi Exit Came Together",
      events: [
        { date: "Sep 2012", text: "St Barbara acquires the Simberi tenements.", icon: "contract" },
        { date: "May 2025", text: "Laverton sold to Genesis for $250 million.", icon: "cash" },
        { date: "2025", text: "$174.8 million of debt repaid.", icon: "done" },
        { date: "Aug 2026", text: "FY26 results show Simberi still pre-sulphide.", icon: "chart" },
        { date: "10 Sep 2026", text: "Lingbao agreement signed, subject to approvals.", icon: "announcement" },
        { date: "Pending", text: "PNG regulatory approvals before completion.", icon: "regulation" },
      ],
      conclusion: "Nothing completes until the PNG approvals are in hand.",
      sourceNote: "Source: filing timeline, ASX announcements Sep 2012 to Sep 2026.",
    },
    {
      kind: "market-vs-reality",
      title: "The Market Bought the Cash, Not the Mine",
      headline: "A binding agreement to sell the remaining New Simberi stake for $453 million.",
      marketFocus:
        "The share price rise likely reflects the size of the consideration against a $1.2 billion market capitalisation.",
      whatMatters:
        "Whether the approvals land, and what 15-Mile costs to build once they do.",
      sourceNote: "Source: exchange feed; transaction announcement, ASX 10 Sep 2026.",
    },
    {
      kind: "risks",
      title: "What Could Make This Worse",
      items: [
        {
          label: "Approvals",
          text: "Completion needs PNG regulatory approval, and the timetable is not in the company's hands.",
          icon: "regulation",
        },
        {
          label: "No production",
          text: "After completion SBM is a developer, with no operating mine until 15-Mile.",
          icon: "mine",
        },
        {
          label: "Capex",
          text: "15-Mile and Touquoy both need capital before either produces.",
          icon: "cash",
        },
        {
          label: "Gold price",
          text: "The royalty value moves with the gold price and is unhedged.",
          icon: "chart",
        },
        {
          label: "Execution",
          text: "Nova Scotia permitting has already moved the timetable once.",
          icon: "timing",
        },
        {
          label: "Counterparty",
          text: "The deferred portion depends on the buyer performing.",
          icon: "contract",
        },
      ],
      sourceNote: "Source: transaction announcement and FY26 Financial Results.",
    },
    {
      kind: "narrative",
      title: "What the Company Looks Like After Completion",
      paragraphs: [
        "On completion SBM becomes a **Nova Scotia-focused developer**. Simberi leaves the portfolio, and the royalty is what remains of the sulphide story the company had been funding.",
        "The balance sheet does the work from here. The pro-forma cash position funds 15-Mile and Touquoy without new equity, on the figures the company has disclosed.",
      ],
      callouts: [
        {
          label: "Not yet",
          text: "None of this is true until the approvals complete. Today the company still owns the stake.",
        },
      ],
      sourceNote: "Source: Simberi Transaction Presentation, ASX 10 Sep 2026.",
    },
    {
      kind: "entities",
      title: "The Two Projects That Are Left",
      items: [
        {
          name: "15-Mile",
          stat: "NPV $340M - 95koz a year - AISC $1,750/oz - capex $140M",
          comment: "The company figures, at the gold price assumed in the study.",
        },
        {
          name: "Touquoy",
          stat: "Residual tailings retreatment - 18koz - AISC $2,100/oz",
          comment: "Short-lived, and the cash flow is modest against 15-Mile.",
        },
      ],
      sourceNote: "Source: September Investor Presentation, ASX 1 Sep 2026.",
    },
    {
      kind: "management",
      title: "Who Is Running It",
      people: [
        {
          name: "Andrew Strelein",
          role: "Managing Director & CEO",
          tenure: "Appointed 2023",
          note: "Ran the Laverton divestment and the debt repayment.",
        },
        {
          name: "Alex Blasse",
          role: "Chair",
          tenure: "Appointed 2022",
        },
      ],
      changes: ["No board changes disclosed in the period."],
      sourceNote: "Source: FY26 Financial Results, directors report.",
    },
    {
      kind: "vitti-view",
      title: "How the Setup Reads",
      ratings: [
        { label: "Balance sheet", value: "Strong", note: "Net cash, no drawn debt." },
        { label: "Business quality", value: "Neutral", note: "Developer, not a producer." },
        { label: "Momentum", value: "Improving", note: "Two divestments completed." },
      ],
      keyDebate:
        "Whether cash in hand is worth more than the sulphide upside being sold.",
      nextCatalyst: "PNG regulatory approval, and the 15-Mile final investment decision.",
      managementQuestion:
        "How much of the pro-forma cash balance is already committed to 15-Mile and Touquoy before any return to shareholders?",
      sourceNote: "Source: our read of the filings above.",
    },
    {
      kind: "outlook",
      title: "What Would Change the Story",
      columns: ["What would improve it", "What would make it worse"],
      improve: [
        "PNG approvals land on the stated timetable",
        "15-Mile reaches a final investment decision",
        "A capital return is announced with the cash",
      ],
      worsen: [
        "Approvals slip and the deal lapses",
        "15-Mile capex comes in above the study",
        "The gold price falls and the royalty value with it",
      ],
      conclusion: "The next twelve months are about approvals and a build decision.",
      sourceNote: "Source: transaction announcement; September Investor Presentation.",
    },
    {
      kind: "closing",
      title: "Where the Story Stands",
      statements: [
        "SBM has agreed to sell its remaining New Simberi stake for **$453 million**, of which **$410 million** is cash on completion.",
        "Completion is conditional on PNG regulatory approvals, so the proceeds are expected rather than received.",
        "After completion the company is a Nova Scotia-focused developer with a funded balance sheet and no producing mine.",
      ],
      pullQuote:
        "The cash is real, the production is not yet, and the approvals decide when the two swap over.",
      sourceNote: "Source: as cited on each page above.",
    },
  ],
};

/**
 * The one-page sheet, with the copy the desk actually published.
 *
 * Taken from PIA, 16 September 2026 (`daily_movers` id 65) so that the preview
 * answers the only question worth asking about this layout: does the real
 * volume of copy fit on one 960x540 sheet? A fixture written to flatter the
 * grid would render beautifully and prove nothing.
 *
 *   npm run report:preview -- snapshot out/snapshot.pdf
 */
const SNAPSHOT_FIXTURE: ReportDoc = {
  ticker: "PIA",
  companyName: "Pengana International Equities Limited",
  moveDate: "2026-09-16",
  analystName: "Prasham Doshi",
  movePct: 10.2,
  pages: [
    {
      kind: "snapshot",
      companyName: "Pengana International Equities Limited",
      headline:
        "Buy-Back Settlement Clears Path for Antipodes Manager Transition",
      kpis: [
        { value: "+10.2%", label: "Share move (intraday)" },
        { value: "$1.1972", label: "Post-tax NTA / share" },
        { value: "3.7x", label: "Average trading volume" },
        { value: "29 Sep", label: "Anticipated buy-back completion" },
      ],
      whyItMoved: [
        "Settlement removes the legal overhang around the Buy-Back",
        "Court proceedings to be discontinued by consent",
        "PCG to seek consent to end the Takeovers Panel case",
      ],
      whatChangesNow: [
        "Withdrawal window for already tendered shareholders extended to 24 Sep 2026",
        "Frank Gooch and Brendan O'Dea join the Board now",
        "Jollie, Wilson, Hamilton and Martin are expected to exit after completion",
        "Antipodes (Global SMID) to become sub-investment manager after completion",
      ],
      timeline: [
        { date: "27 Jul 2026", text: "EGM approves Buy-Back" },
        { date: "29 Jul 2026", text: "Court challenge filed" },
        { date: "31 Aug 2026", text: "Takeovers Panel application" },
        { date: "16 Sep 2026", text: "Settlement reached" },
        { date: "29 Sep 2026", text: "Anticipated Buy-Back completion" },
      ],
      risks: [
        {
          label: "Panel closure still pending",
          text: "PCG still needs Takeovers Panel consent to end its application.",
        },
        {
          label: "Buy-Back participation / scale",
          text: "PCG and its subsidiaries will not participate; final register size remains uncertain.",
        },
        {
          label: "Minimum viable entity threshold",
          text: "PIA must stay above the Board's viability threshold after the Buy-Back.",
        },
      ],
      pullQuote:
        "PIA has settled the fight over how shareholders get to choose; it hasn't yet shown what the portfolio looks like once they've chosen.",
      sourceNote: "Source: ASX announcements, 16 Sep 2026",
    },
  ],
};

/**
 * The worst case the layout is ever asked to hold.
 *
 * Every list at its maximum count and every string at its `fit.ts` character
 * cap, so the question it answers is not "does today's draft fit" but "does
 * anything the fitter will ever emit fit". That distinction matters more here
 * than on the deck: a long page in a deck wrapped onto a second sheet and
 * looked wrong, whereas a long one-pager drops its last band off the bottom and
 * says nothing. If this renders two sheets, the type is too big or the caps are
 * too loose — those are the only two dials.
 *
 *   npm run report:preview -- stress out/stress.pdf
 */
const pad = (text: string, length: number) =>
  text.length >= length ? text.slice(0, length) : text.padEnd(length, " word");

const STRESS_FIXTURE: ReportDoc = {
  ticker: "STRS",
  companyName: "Stress Test Holdings International Limited",
  moveDate: "2026-09-17",
  analystName: "Prasham Doshi",
  movePct: -12.4,
  reportPrice: 0.018,
  moveTime: "10:42 am",
  moveIsClose: false,
  pages: [
    {
      kind: "snapshot",
      companyName: "Stress Test Holdings International Limited",
      headline: pad("Shares Fall as Much as ~12.4% in Morning Trade After ", 110),
      kpis: [
        { value: "-12.4%", label: "Share move (intraday)" },
        { value: "$1,234.5M", label: "New FY26 EBITDA guidance range" },
        { value: "5,950-6,050MT", label: "FY26 harvest volume guidance" },
        { value: "30 Sep", label: "Anticipated completion date" },
      ],
      whyItMoved: [
        pad("First reason the stock moved today, stated as one clause ", 88),
        pad("Second reason the stock moved today, stated as one clause ", 88),
        pad("Third reason the stock moved today, stated as one clause ", 88),
      ],
      whatChangesNow: [
        pad("First thing that changes from here, stated as one clause ", 88),
        pad("Second thing that changes from here, stated as one clause ", 88),
        pad("Third thing that changes from here, stated as one clause ", 88),
        pad("Fourth thing that changes from here, stated as one clause ", 88),
      ],
      timeline: [
        { date: "17 Apr 2026", text: pad("First step in the chain ", 62) },
        { date: "26 May 2026", text: pad("Second step in the chain ", 62) },
        { date: "6 Aug 2026", text: pad("Third step in the chain ", 62) },
        { date: "17 Sep 2026", text: pad("Fourth step in the chain ", 62) },
        { date: "24 Sep 2026", text: pad("Fifth step in the chain ", 62) },
        { date: "30 Sep 2026", text: pad("Sixth step in the chain ", 62) },
      ],
      risks: [
        { label: pad("First risk label here ", 42), text: pad("The first risk, explained in one sentence ", 96) },
        { label: pad("Second risk label here ", 42), text: pad("The second risk, explained in one sentence ", 96) },
        { label: pad("Third risk label here ", 42), text: pad("The third risk, explained in one sentence ", 96) },
      ],
      /**
       * The chart shares the timeline's slot, so the stress sheet carries BOTH:
       * the renderer prefers the chart, and the worst case is whichever is
       * taller. Five points with the longest labels the fitter allows.
       */
      /**
       * Two series, four categories, negatives below a zero baseline - the
       * shape the desk actually publishes (CVB, 18 Sep 2026: revenue against
       * operating loss across four financial years). Every string at its
       * fitter cap, so this proves the worst case fits rather than a tidy one.
       */
      chart: {
        form: "columns",
        title: pad("Revenue vs Operating Loss | FY23 to FY26 ", 68),
        note: pad("FY26 revenue -28% YoY ", 46),
        unit: "A$ million",
        footnote: pad("Operating Loss is a non-IFRS measure reported by the company. ", 92),
        series: [
          {
            name: "Revenue",
            points: [
              { label: "FY23", value: 8.06, display: "$8.06m" },
              { label: "FY24", value: 6.53, display: "$6.53m" },
              { label: "FY25", value: 12.1, display: "$12.10m" },
              { label: "FY26", value: 8.67, display: "$8.67m" },
            ],
          },
          {
            name: "Operating Loss",
            points: [
              { label: "FY23", value: -15.21, display: "-$15.21m" },
              { label: "FY24", value: -16.29, display: "-$16.29m" },
              { label: "FY25", value: -11.14, display: "-$11.14m" },
              { label: "FY26", value: -13.5, display: "-$13.50m" },
            ],
          },
        ],
      },
      pullQuote: pad("The closing line of judgement, saying what the day settles and what it leaves open ", 190),
      sourceNote: pad("Source: Stress Market Update, ASX 17 Sep 2026; Stress Investor Presentation, ASX 26 May 2026 ", 150),
    },
  ],
};

async function loadDraft(id: number): Promise<ReportDoc> {
  const { getDb } = await import("../src/db");
  const { moverDrafts } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const [row] = await getDb()
    .select({ report: moverDrafts.report })
    .from(moverDrafts)
    .where(eq(moverDrafts.id, id))
    .limit(1);

  if (!row?.report) throw new Error(`draft ${id} has no stored report`);

  /**
   * Re-fitted on the way in.
   *
   * A stored draft was cut to the budget that existed when it was written, so
   * rendering it as-is answers "how did this look last week" when the question
   * is "how would this look now". `fitReportPages` is idempotent, so a document
   * already inside the current budget passes through untouched.
   */
  const doc = row.report as ReportDoc;
  return { ...doc, pages: fitReportPages(doc.pages, `${doc.ticker} (stored)`) };
}

const [target = "fixture", outArg] = process.argv.slice(2);
const doc = /^\d+$/.test(target)
  ? await loadDraft(Number(target))
  : target === "snapshot"
    ? { ...SNAPSHOT_FIXTURE, pages: fitReportPages(SNAPSHOT_FIXTURE.pages, "PIA (snapshot)") }
    : target === "stress"
      ? { ...STRESS_FIXTURE, pages: fitReportPages(STRESS_FIXTURE.pages, "stress") }
      : target === "stress-timeline"
        ? /**
           * The same worst case with the chart removed, so the TIMELINE branch
           * is tested too. The stress fixture carries both and the renderer
           * prefers the chart, which meant six full-length dated steps were
           * never actually drawn by any check.
           */
          {
            ...STRESS_FIXTURE,
            pages: fitReportPages(
              STRESS_FIXTURE.pages.map((page) =>
                page.kind === "snapshot" ? { ...page, chart: null } : page,
              ),
              "stress-timeline",
            ),
          }
        : FIXTURE;

/**
 * Validation is reported, not enforced.
 *
 * The fixture is over the page ceiling by design, and a stored draft may be
 * from before a rule changed. Both are still worth looking at, so the problems
 * are printed and the render goes ahead — the real pipeline still refuses them
 * in `renderReportPdf`.
 */
const problems = validateReportDoc(doc);
if (problems.length > 0) {
  console.warn(`not publishable as-is: ${problems.join("; ")}`);
}

const out = path.resolve(outArg ?? `preview-${doc.ticker.toLowerCase()}.pdf`);
await mkdir(path.dirname(out), { recursive: true });
const pdf = await renderToBuffer(DailyMoverReport({ doc }));
await writeFile(out, pdf);

/**
 * The page count is READ BACK OUT OF THE PDF, never computed from the document.
 *
 * This line used to print `doc.pages.length`, which is what the document asked
 * for rather than what react-pdf produced — so it reported "1 sheets" for a
 * snapshot that had in fact overflowed onto a second, blank sheet, and every
 * check run through it was worthless. A preview whose only number is a
 * restatement of its own input cannot catch the one failure this format has.
 */
const { isSnapshotDoc } = await import("../src/lib/report/types");
const { getDocumentProxy } = await import("unpdf");
const expected = isSnapshotDoc(doc) ? doc.pages.length : doc.pages.length + 1;
const rendered = (await getDocumentProxy(new Uint8Array(pdf))).numPages;

console.log(`${rendered} sheets (expected ${expected}) -> ${out}`);
if (rendered !== expected) {
  console.error(
    `OVERFLOW: rendered ${rendered} sheets, expected ${expected}. ` +
      `Content is running off the bottom of the sheet — cut a length cap or the type scale.`,
  );
  process.exitCode = 1;
}
