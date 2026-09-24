import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { CATALYST_SLUGS, isCatalystSlug, type CatalystSlug } from "@/lib/catalysts";
import type { ResearchSignals } from "@/lib/drafts/research-signals";
import type { SnapshotChart } from "@/lib/report/types";
import { formatMoneyCompact, type ScreenResult, type ScreenerRow } from "@/lib/asx/types";
import {
  REPORT_ICONS,
  REPORT_LIMITS,
  REPORT_PAGE_KINDS,
  type ReportCallout,
  type ReportChart,
  type ReportChartPoint,
  type ReportComparisonRow,
  type ReportDoc,
  type ReportEntity,
  type ReportKpi,
  type ReportPage,
  type ReportPerson,
  type ReportRating,
  type ReportTimelineEvent,
} from "@/lib/report/types";

import {
  addUsage,
  describeAnthropicError,
  draftModel,
  getAnthropicClient,
  type TokenUsage,
} from "./client";
import { formatDocumentForPrompt, type AnnouncementDocument } from "./announcement-text";
import {
  formatVolumeProfile,
  type VolumeProfile,
} from "@/lib/market/volume";

import { fitReportPages } from "@/lib/report/fit";
import type { MoveWindow } from "@/lib/drafts/trading-day";

import type { AccuracyFinding, AccuracyReview } from "@/lib/drafts/types";

/**
 * The two judgment calls in the drafting pipeline: which mover to cover, and
 * what the report says.
 *
 * Split into two model calls rather than one because they are different
 * questions asked of different evidence. Choosing needs a wide, shallow view of
 * forty movers and their headlines; writing needs a narrow, deep read of one
 * company's filings. Fusing them would mean downloading twenty-five
 * announcements for all forty candidates to make one decision — about a
 * thousand PDFs to write one report.
 */

// ---------------------------------------------------------------------------
// Stage 1 — selection
// ---------------------------------------------------------------------------

/** One mover offered to the model, with the day's filings that could explain it. */
export type MoverCandidate = {
  row: ScreenerRow;
  side: "gainers" | "losers";
  /** Price-sensitive announcements released on the move date. */
  todayHeadlines: { idsId: string; time: string | null; headline: string }[];
};

export type MoverSelection = {
  ticker: string;
  /** Why this one, in the analyst's own terms. Shown on the review card. */
  rationale: string;
  /** The next-best two or three, so a reviewer can see what was passed over. */
  runnerUps: { ticker: string; reason: string }[];
  /** The model's read on how strong a report this will make, 1-5. */
  confidence: number;
};

const SELECTION_TOOL: Anthropic.Tool = {
  name: "select_daily_mover",
  description:
    "Chooses which one of today's ASX movers Vitti Capital should publish a Daily Mover report on.",
  input_schema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description:
          "The ASX code of the single best candidate. MUST be one of the tickers listed in the candidate table — never a ticker you know of from elsewhere.",
      },
      rationale: {
        type: "string",
        description:
          "Two to four sentences on why this mover is the best subject today: what the announcement was, why the move is explainable, and why it is worth a client's attention. Max 800 characters.",
      },
      runnerUps: {
        type: "array",
        maxItems: 3,
        description:
          "The next best two or three candidates, strongest first, each with one sentence on why it lost out.",
        items: {
          type: "object",
          properties: {
            ticker: { type: "string" },
            reason: { type: "string" },
          },
          required: ["ticker", "reason"],
        },
      },
      confidence: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description:
          "How strong a Daily Mover this will make. 5 = a major result or transaction at a well-known name with a clear story. 1 = the move is real but the filing barely explains it. Be honest: a 2 tells the analyst to expect a thin report.",
      },
    },
    required: ["ticker", "rationale", "runnerUps", "confidence"],
  },
};

const SELECTION_SYSTEM = `You are the research desk assistant at Vitti Capital, an Australian equities firm. Every trading day the desk publishes ONE "Daily Mover" report: a short institutional note on a single ASX-listed company that moved sharply, explaining what happened and what it means.

Your job is to pick the subject. You are given both sides of today's board — the biggest risers and fallers that passed the desk's liquidity screen — and, for each, the price-sensitive announcements that company released today.

What makes a good Daily Mover subject, in priority order:

1. THE MOVE IS EXPLAINED BY THE FILING. The report's whole purpose is "here is what happened and why". A 30% move with no announcement that accounts for it is unwritable — and a company that filed a substantive result or transaction beats one that filed a one-line clarification.
2. PREFER THE ESTABLISHED BUSINESS OVER THE SPECULATIVE ONE. This is the criterion most often got wrong, so be deliberate about it. Favour companies with revenue, a reporting history and accounts a report can be checked against. Bigger and more liquid beats smaller and thinner at a similar quality of story, and a $2 billion industrial beats a $90 million explorer even when the explorer moved three times as far.

   Treat these as low quality regardless of how large the move is:
     - a single drill hole, assay or exploration result
     - one datapoint from a clinical or field trial, especially early phase
     - takeover or bid *speculation* that is not a binding or disclosed proposal
     - a move that is mostly a re-rating of hope rather than a change in the numbers

   The test to apply: would this report still be worth reading in a month? A result, a guidance change, a contract, a completed transaction or a regulatory decision passes. A drill hole does not.
3. THE STORY HAS DEPTH. Full-year or half-year results, guidance changes, major contracts, M&A, and regulatory or clinical milestones all give a report something to say across several pages. Index rebalances, minor administrative filings and "response to ASX query" notices do not, however large the move.
4. THE MOVE IS LARGE ENOUGH TO BE NEWS, but size is close to irrelevant beyond that. A well-explained 6% fall at a mid-cap is a better report than a 40% spike in a micro-cap. Do not rank the board by percentage — rank it by how much there is to say.
5. FALLERS ARE AS INTERESTING AS RISERS. Do not bias toward gainers. A sharp fall on a results miss is often the more useful note.

The candidate table prints each company's turnover as a share of its market capitalisation. A high figure on a large move — say turnover above 5% of market cap — usually marks a speculative blow-off rather than institutional repositioning, and is a reason to look further down the list.

Judge only from the evidence given. Do not use recollections about these companies from your training data — the market data and headlines in the prompt are the facts. If none of the candidates is a good subject, still pick the least-bad one and say so honestly in the rationale with a low confidence score.`;

function formatCandidateTable(candidates: MoverCandidate[]): string {
  const lines = candidates.map((candidate) => {
    const { row } = candidate;
    const headlines =
      candidate.todayHeadlines.length === 0
        ? "    (no price-sensitive announcement today)"
        : candidate.todayHeadlines
            .map(
              (item) =>
                `    - ${item.time ?? "??"} [${item.idsId}] ${item.headline}`,
            )
            .join("\n");

    /**
     * Turnover as a share of market cap — the cheap tell for a blow-off.
     *
     * Both figures are already on the row, and the ratio says something neither
     * does alone: a 30% move on 8% of the company changing hands in a session is
     * a speculative crowd, while the same move on 0.4% is a re-rate the register
     * mostly sat through. It costs nothing to print and it is the signal the
     * selection prompt asks the model to weigh.
     */
    const churn =
      row.turnover !== null && row.marketCap !== null && row.marketCap > 0
        ? `${((row.turnover / row.marketCap) * 100).toFixed(2)}% of mcap`
        : "unknown";

    return [
      `${row.ticker} — ${row.companyName}`,
      `    side: ${candidate.side}  move: ${row.changePct > 0 ? "+" : ""}${row.changePct.toFixed(2)}%  ` +
        `last: $${row.last?.toFixed(3) ?? "?"}  turnover: ${formatMoneyCompact(row.turnover)} (${churn})  ` +
        `market cap: ${formatMoneyCompact(row.marketCap)}  sector: ${row.sector ?? "unknown"}`,
      headlines,
    ].join("\n");
  });

  return lines.join("\n\n");
}

export async function selectMover(
  input: {
    moveDate: string;
    candidates: MoverCandidate[];
    screen: ScreenResult;
  },
  usage: TokenUsage,
): Promise<{ selection: MoverSelection; usage: TokenUsage }> {
  if (input.candidates.length === 0) {
    throw new Error(
      "No candidates to choose from — every mover that passed the liquidity " +
        "screen was without a price-sensitive announcement today.",
    );
  }

  const anthropic = getAnthropicClient();
  const { criteria } = input.screen;

  const prompt = `Today is ${input.moveDate} (ASX trading day).

The board below is every mover that passed the desk's screen: at least ${criteria.minAbsChangePct}% move, at least ${formatMoneyCompact(criteria.minTurnover)} of turnover, and at least ${formatMoneyCompact(criteria.minMarketCap)} market cap. Each candidate's price-sensitive announcements for today are listed underneath it.

CANDIDATES
${formatCandidateTable(input.candidates)}

Pick the single best subject for today's Daily Mover using the select_daily_mover tool.`;

  try {
    const response = await anthropic.messages.create({
      model: draftModel(),
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SELECTION_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      tools: [SELECTION_TOOL],
      tool_choice: { type: "tool", name: SELECTION_TOOL.name },
    });

    const nextUsage = addUsage(usage, response.usage);

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === SELECTION_TOOL.name,
    );
    if (!toolUse) {
      throw new Error("Claude did not return a mover selection.");
    }

    const raw = toolUse.input as Record<string, unknown>;
    const picked = String(raw.ticker ?? "").trim().toUpperCase();

    // The tool description says "one of the listed tickers", but a hallucinated
    // code would send the pipeline off to download announcements for a company
    // that never appeared on the board. Constrain it here rather than trust it.
    const match = input.candidates.find(
      (candidate) => candidate.row.ticker === picked,
    );
    if (!match) {
      throw new Error(
        `Claude picked ${picked || "(nothing)"}, which is not one of today's ` +
          `${input.candidates.length} candidates.`,
      );
    }

    const runnerUps = Array.isArray(raw.runnerUps)
      ? raw.runnerUps
          .map((item) => {
            const entry = item as Record<string, unknown>;
            return {
              ticker: String(entry?.ticker ?? "").trim().toUpperCase(),
              reason: String(entry?.reason ?? "").trim(),
            };
          })
          .filter((item) => item.ticker && item.ticker !== picked)
          .slice(0, 3)
      : [];

    const confidence = Number(raw.confidence);

    return {
      selection: {
        ticker: picked,
        rationale: String(raw.rationale ?? "").trim(),
        runnerUps,
        confidence:
          Number.isFinite(confidence) && confidence >= 1 && confidence <= 5
            ? Math.round(confidence)
            : 3,
      },
      usage: nextUsage,
    };
  } catch (error) {
    throw new Error(describeAnthropicError(error));
  }
}

// ---------------------------------------------------------------------------
// Stage 2 — writing the report
// ---------------------------------------------------------------------------

export type DraftedReport = {
  doc: ReportDoc;
  /** The `daily_movers` columns, so the row and the PDF cannot disagree. */
  mover: {
    ticker: string;
    companyName: string;
    sector: string | null;
    movePct: number;
    moveType: "intraday" | "closing";
    moveWindowLabel: string | null;
    catalystSlug: CatalystSlug;
    reasonForMove: string;
    mainTakeaway: string;
    reportPrice: number | null;
  };
  /** Which announcements the report actually drew on. */
  citedIdsIds: string[];
};

/**
 * A single flat page object rather than a `oneOf` over six page shapes.
 *
 * Tool schemas can express a discriminated union, but in practice a flat object
 * with a `kind` discriminator and optional per-kind fields is what models fill
 * in reliably — and the alternative failure is a whole report lost to one
 * schema-validation error. The shape is re-tightened in `normalisePage` below,
 * so nothing untyped reaches the renderer.
 */
const PAGE_SCHEMA = {
  type: "object",
  properties: {
    whyItMoved: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      maxItems: 3,
      description:
        "SNAPSHOT ONLY. Left column, 'Why It Moved': two or three single-clause lines saying what actually " +
        "happened today. No sentences, no lead-ins, no full stops needed — these are set as a numbered list " +
        "next to the figures. Around 55-70 characters each - the sheet CUTS MID-WORD past 76, so write short. Example: " +
        "\"Settlement removes the legal overhang around the Buy-Back\".",
    },
    whatChangesNow: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 4,
      description:
        "SNAPSHOT ONLY. Right column, 'What Changes Now': up to four single-clause lines on what today's news " +
        "actually changes from here — deadlines that move, people who arrive or leave, mandates that transfer, " +
        "conditions that remain. This is where board and management change belongs, and where a date the " +
        "reader must diarise belongs. Do NOT restate the 'why it moved' points here.",
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "'27 Jul 2026' — day, month and year, always. The step is placed on the share-price line by " +
              "this date, so 'FY26', 'Q3' or 'mid-2026' cannot be plotted and prints as a caption only.",
          },
          text: { type: "string", description: "What happened at that step, in a short phrase under 62 characters: 'FDA 510(k) clearance for CT-based BMD technology'." },
        },
        required: ["date", "text"],
      },
      minItems: 2,
      maxItems: 6,
      description:
        "SNAPSHOT ONLY. 'How We Got Here': the dated steps that led to today, OLDEST FIRST, ending with today " +
        "and (where the filings give one) the next scheduled date. Use the EVENT CHAIN block in the evidence " +
        "for this — it is the same sequence, already assembled. Up to SIX steps, each under 62 characters. " +
        "ALWAYS supply it: the renderer draws the share price from the exchange feed across the band and places " +
        "each step on that line as a numbered marker, with its text in a numbered caption underneath, so the " +
        "reader sees every event against what the price did. Prefer the steps that plausibly moved the price.",
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Three or four words naming the risk." },
          text: { type: "string", description: "One sentence, under 78 characters, on why it is unresolved." },
        },
        required: ["label", "text"],
      },
      minItems: 1,
      maxItems: 3,
      description:
        "SNAPSHOT ONLY. 'Key Risks Remaining': exactly three cards where the evidence supports three. These are " +
        "what is still open AFTER today's news, not generic market risk. A snapshot without real risks is " +
        "promotional material and will be rejected.",
    },
    kind: {
      type: "string",
      enum: [...REPORT_PAGE_KINDS],
      description:
        "Page layout. 'snapshot' is the ONLY value you may use: the whole report is one snapshot page. " +
        "It carries the company name, the headline, four KPI tiles, the two numbered columns " +
        "(whyItMoved / whatChangesNow), the dated timeline, three risk cards and the closing pullQuote. " +
        "The kinds that follow are legacy layouts for the older multi-page deck and are NOT to be emitted. " +
        "'cover' (first page only): company name, headline, two hero KPI cards, and one line under them. " +
        "'kpis': a title and 3-6 big-number cards in rows of three — the page for a project or a deal economics, " +
        "and the right answer whenever the page is carrying figures rather than an argument. " +
        "'chart': one plotted series with the conclusion line under it — use this instead of a paragraph whenever the story is a trend or a build-up. " +
        "'comparison': a three-column table — a label and two figures — for 'what changed since the last update', " +
        "'consensus vs actual', or 'what the company receives against what it gives up'. " +
        "'timeline': the dated steps that got the story here, as marks along a rule. Use it when the sequence matters — " +
        "what has already happened, what is only agreed, and what is still outstanding. " +
        "'market-vs-reality': the announcement / market focus / what really matters split, for a day when the announcement and the share-price reaction point different ways. " +
        "'risks': label-and-explanation cards with an icon each, no numbers. Always include one. " +
        "'narrative': a title and 2-3 short paragraphs, optionally with callouts. The fallback, not the default — " +
        "if the content is figures, a sequence or a contrast, one of the kinds above carries it better. " +
        "'entities': named blocks for segments, geographies, projects or acquisitions, each with a dense stat line. " +
        "'management': who runs the company, with tenure and shareholdings where the filings give them. " +
        "'vitti-view': the setup scorecard, plus the key debate, the next catalyst and the question for management. " +
        "'outlook': the two lists of what would improve the story and what would make it worse. " +
        "'closing' (last page only): 3-4 standalone concluding statements and one pull quote.",
    },
    title: {
      type: "string",
      maxLength: REPORT_LIMITS.titleChars,
      description:
        "Page heading, at most 80 characters — it is set large, and a heading that wraps to three lines eats " +
        "the page it is introducing. Write it so the reader knows the page's conclusion from the heading alone: " +
        "'Is the Balance Sheet a Problem?' not 'Balance Sheet & Cash Flow'; 'Where Is the Weakness?' not " +
        "'Division Performance'; 'The UK Is Doing the Heavy Lifting' not 'Segment Detail'. A question or a " +
        "finding, never a category label. Not used on the cover page.",
    },
    sourceNote: {
      type: "string",
      maxLength: REPORT_LIMITS.sourceNoteChars,
      description:
        "REQUIRED on every page: where the figures on this page came from, printed small under the content. " +
        "Name the document and its ASX date, not the id: 'Source: Simberi Transaction Presentation, ASX 10 Sep 2026, " +
        "pp. 4-11.' Two documents at most, and add '; exchange feed' when a price, a volume or a market " +
        "capitalisation on the page comes from the market data block. Where a page shows your own arithmetic, say so: " +
        "'Source: FY26 Financial Results, ASX 28 Aug 2026; our calculation.' A page whose sources you cannot name is " +
        "a page whose figures you have not verified — fix the figures, do not write a vague line. Pages with no " +
        "figures on them at all (the Vitti View, the outlook) still name what the read is based on.",
    },
    companyName: {
      type: "string",
      description: "Cover page only: the company's full registered name.",
    },
    headline: {
      type: "string",
      maxLength: 160,
      description:
        "On a 'snapshot' page: under 88 characters, leading with the company's short name and the move as a whole " +
        "percentage rounded from the share-move tile, and saying so when the stock moved against the news — " +
        "'Tuas Sinks 16% Despite 277% Profit Jump as M1 Fallout and Spectrum Probe Linger'. No shorthand that " +
        "needs the backstory to decode. " +
        "On a 'cover' page: the share-move headline, stating direction and magnitude the way the desk writes it — " +
        "'Shares Rise as Much as ~20.6% in Morning Trade After Record FY26 Results and a New $5 Million Share Buy-Back'. " +
        "On a 'market-vs-reality' page: what the company announced, or what initially looks like the important part.",
    },
    marketFocus: {
      type: "string",
      maxLength: REPORT_LIMITS.mvrChars,
      description:
        "'market-vs-reality' pages: what investors appear to have reacted to, which is often not the headline. " +
        "Write it as a reading, not a fact — 'the share price rise likely reflects the size of the consideration " +
        "against a $1.2 billion market capitalisation' — because no filing states why a stock moved. Two or three " +
        "sentences, 300 characters at the most.",
    },
    whatMatters: {
      type: "string",
      maxLength: REPORT_LIMITS.mvrChars,
      description:
        "'market-vs-reality' pages: the issue that decides the investment story from here. Same length as marketFocus.",
    },
    chart: {
      type: "object",
      description:
        "REQUIRED on a 'snapshot' page: the chart card under the tiles. Fill 'series' whenever the filings " +
        "hold a series; send 'series': [] when they genuinely do not, and the share price from the exchange " +
        "feed is drawn in the same card instead. Always supply the timeline as well. " +
        "Use it when what got the company here is a PROGRESSION OF FIGURES rather than a sequence of events: " +
        "revenue and operating loss by financial year, capital raised by round, production by half, net debt " +
        "by period, guidance upgrades through the year. Prefer it whenever such a series exists in the filings, " +
        "because a reader takes a shape in a second and will not read four dated lines saying the same thing. " +
        "EVERY figure must be read from the evidence; never interpolate a missing period, and never invent a " +
        "series to have a chart.",
      properties: {
        form: {
          type: "string",
          enum: ["columns", "line"],
          description:
            "'line' (the house default): a series through time, 2-12 points, every point dotted and labelled " +
            "up to six - four years of revenue vs operating loss, guidance through the year. 'columns': 2-5 " +
            "separate amounts side by side where time is not the axis, at most 4 with two series - capital " +
            "raised by round, segment revenue. " +
            "There is no candlestick/OHLC form: the pipeline stores one price per day, so opens, highs and " +
            "lows don't exist and must not be invented.",
        },
        title: {
          type: "string",
          description:
            "The takeaway, not the topic: 'Revenue tripled while losses narrowed' beats 'Revenue and operating " +
            "loss'. Printed in caps above the chart. Under ~60 characters.",
        },
        note: {
          type: "string",
          description:
            "One sentence, the single thing the eye should catch, set in the accent colour beside the title. " +
            "Point at a specific change - 'loss peaked in FY24 and halved' - not a restatement of the title. " +
            "Under 46 characters.",
        },
        unit: {
          type: "string",
          description:
            "Short and exact: '$ million', 'US$ million', 'koz', 'tonnes 000'. Put the scale in the unit, not " +
            "in each value. Australian dollars are '$', never 'A$'. Always state it.",
        },
        footnote: {
          type: "string",
          description:
            "Only for a real caveat - restated figures, a changed accounting basis, a 9-month period, unaudited " +
            "numbers, a missing period, a non-IFRS measure. Otherwise omit. Under 92 characters.",
        },
        series: {
          type: "array",
          minItems: 0,
          maxItems: 2,
          description:
            "One or two series. Two is how a contrast is shown - revenue against the loss it is measured " +
            "against - and both MUST carry the same category labels in the same order, because they are drawn " +
            "side by side against one axis. Both share one unit; if they don't, chart only one. Losses stay " +
            "negative and draw below the zero baseline - never flip the sign.",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "1-2 words: 'Revenue', 'Operating loss'. No units in names. Under 22 characters.",
              },
              tone: {
                type: "string",
                enum: ["favourable", "unfavourable", "neutral"],
                description:
                  "Sets the series colour. 'unfavourable' for a loss, a cost or a cash burn - drawn in the red " +
                  "that marks what hurts. 'favourable' for revenue, profit, cash or production. 'neutral' for a " +
                  "figure with no direction of its own, such as capital raised.",
              },
              points: {
                type: "array",
                minItems: 2,
                maxItems: 12,
                description:
                  "Oldest first. 'columns': 2-5 points, at most 4 with two series - figures print over every " +
                  "bar. 'line': 6-12 - only the first and last figures print. Beyond the cap the oldest points " +
                  "are dropped. Never interpolate a missing period. Same decimals on every value.",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      description:
                        "Short and uniform, in the company's own fiscal labels: 'FY24', '1H25', 'Jul-26', " +
                        "'Series A'. Under 10 characters.",
                    },
                    value: {
                      type: "number",
                      description:
                        "The plotted magnitude, SIGNED and in the stated unit. A loss is negative.",
                    },
                    display: {
                      type: "string",
                      description: "How it prints on the column: '$8.06m', '-$15.21m'.",
                    },
                  },
                  required: ["label", "value", "display"],
                },
              },
            },
            required: ["name", "tone", "points"],
          },
        },
      },
      required: ["title", "series"],
    },
    events: {
      type: "array",
      minItems: 2,
      maxItems: REPORT_LIMITS.timelineEvents,
      description:
        "'timeline' pages: the dated steps, oldest first. This is the page that keeps tense honest — a step that " +
        "has happened carries its date, and a step that has not says so ('Pending', 'On completion'). Use it for a " +
        "transaction: when it was agreed, what conditions remain, and when it completes.",
      items: {
        type: "object",
        properties: {
          date: {
            type: "string",
            maxLength: REPORT_LIMITS.timelineDateChars,
            description:
              "As the filing dates it: '26 May 2025', 'Jun 2026 Qtr', 'Dec 2024'. For something not yet done, " +
              "'Pending' or 'On completion' — never a date you have invented.",
          },
          text: {
            type: "string",
            maxLength: REPORT_LIMITS.timelineTextChars,
            description: "What happened, in ONE short line. Not a sentence and a half.",
          },
          icon: {
            type: "string",
            enum: [...REPORT_ICONS],
            description:
              "Optional mark drawn above the caption. Pick by meaning: 'cash' for money in or out, 'contract' " +
              "for an agreement, 'regulation' for an approval, 'done' for something completed, 'timing' for a " +
              "deadline, 'announcement' for a disclosure, 'chart' for a result, 'mine'/'plant'/'resource' for " +
              "assets, 'trial' for a study, 'supply' for logistics, 'operations' for a process, 'people' for a " +
              "person, 'geography' for a place, 'warning' for a setback.",
          },
        },
        required: ["date", "text"],
      },
    },
    conclusion: {
      type: "string",
      maxLength: REPORT_LIMITS.conclusionChars,
      description:
        "ONE sentence — 280 characters at the most — saying what the reader should take from this page, " +
        "printed in a coloured band under the " +
        "content. Required on 'chart' pages, and worth writing on 'kpis', 'comparison', 'timeline' and 'outlook' " +
        "pages too. Not a restatement of the figures — the point they make. 'The direction of sales growth explains " +
        "the sell-off better than the headline FY26 result.' Where it is an inference rather than a fact, word it " +
        "as one: 'likely reflects', 'on our calculation', 'on the company's own guidance'.",
    },
    columns: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: { type: "string" },
      description:
        "'comparison' pages: the THREE column headings, e.g. ['Metric','Before','Now'] for what changed since the " +
        "last update, ['Metric','Consensus','Actual'] for expectations against the result, or " +
        "['Metric','Gives up','Receives'] to weigh a transaction. 'outlook' pages: the TWO list headings, when " +
        "'What would improve the story' and 'What would make it worse' are not what the two lists are.",
    },
    rows: {
      type: "array",
      maxItems: REPORT_LIMITS.comparisonRows,
      description:
        "'comparison' pages: one row per metric that materially changed, six at the most. Skip the immaterial " +
        "ones — a table nobody scans is worse than the three rows that carry the change.",
      items: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            maxLength: REPORT_LIMITS.comparisonCellChars,
            description: "'Australia sales growth', 'NPAT', 'FY27 guidance', 'Production'.",
          },
          before: {
            type: "string",
            maxLength: REPORT_LIMITS.comparisonCellChars,
            description:
              "The earlier figure, as it prints: '+6.0%', '$44.1M', '41koz FY26'. ONE LINE — 88 characters at " +
              "the most. A cell that needs a parenthetical explanation is carrying the page text: put the " +
              "qualification in the conclusion line instead.",
          },
          now: {
            type: "string",
            maxLength: REPORT_LIMITS.comparisonCellChars,
            description: "The current figure, as it prints. Same one-line limit.",
          },
          change: {
            type: "string",
            maxLength: REPORT_LIMITS.comparisonChangeChars,
            description:
              "The delta in a few words: '-6.5pp', 'Beat', 'Growth to contraction'. It is a narrow column — " +
              "three or four words at the most.",
          },
          direction: {
            type: "string",
            enum: ["better", "worse", "neutral"],
            description:
              "Whether the change is good or bad for the investment case. 'neutral' when it is a fact rather " +
              "than a verdict — a change in segment mix is not automatically either.",
          },
        },
        required: ["metric", "before", "now", "change"],
      },
    },
    ratings: {
      type: "array",
      maxItems: REPORT_LIMITS.ratings,
      description:
        "'vitti-view' pages: normally Business Quality (Strong/Neutral/Weak), Balance Sheet (Strong/Neutral/Weak) " +
        "and Current Momentum (Improving/Stable/Weakening). Leave out any rating the evidence does not support " +
        "rather than defaulting it to Neutral.",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          note: {
            type: "string",
            description: "Optional few-word justification: 'Net cash, no drawn debt'.",
          },
        },
        required: ["label", "value"],
      },
    },
    keyDebate: {
      type: "string",
      maxLength: REPORT_LIMITS.debateChars,
      description:
        "'vitti-view' pages: the one sentence the bulls and bears actually disagree about. A sentence, not a paragraph.",
    },
    nextCatalyst: {
      type: "string",
      maxLength: REPORT_LIMITS.debateChars,
      description:
        "'vitti-view' pages: the next dated or expected event that resolves part of that debate. One sentence.",
    },
    managementQuestion: {
      type: "string",
      maxLength: REPORT_LIMITS.questionChars,
      description:
        "'vitti-view' or 'closing' pages: one question worth putting to management, coming directly out of this " +
        "report's research and answering something the public documents leave open. Not a generic question. " +
        "'How much of the pro-forma cash balance is already committed to 15-Mile and Touquoy before any return to " +
        "shareholders?' — not 'What are your growth plans?'. Put it on one page, not both.",
    },
    pullQuote: {
      type: "string",
      maxLength: REPORT_LIMITS.pullQuoteChars,
      description:
        "REQUIRED on a 'snapshot' page, where it is the closing line of judgement set in italic under a rule at " +
        "the foot of the sheet: one sentence under 148 characters saying what the day settles and what it leaves open — the desk's " +
        "read, not a summary of the page above it. " +
        "\"PIA has settled the fight over how shareholders get to choose; it hasn't yet shown what the portfolio " +
        "looks like once they've chosen.\" " +
        "Also used on 'closing' pages: ONE sentence, set large in the house colour above the sign-off — the line you would " +
        "want a portfolio manager to remember a week later. It is a summary of the debate, never a recommendation, " +
        "and it must not repeat a statement verbatim.",
    },
    people: {
      type: "array",
      maxItems: REPORT_LIMITS.people,
      description:
        "'management' pages: the people who actually run the company, most senior first — normally the CEO or " +
        "managing director, the chair, and the CFO. Only people the evidence names. Never recall a name from " +
        "elsewhere: a wrong executive on a client note is the worst error in this report.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: {
            type: "string",
            description: "'Managing Director & CEO', 'Chair', 'Chief Financial Officer'.",
          },
          tenure: {
            type: "string",
            description:
              "Optional: 'Appointed March 2024', 'With the company 12 years'. Only from the evidence.",
          },
          holding: {
            type: "string",
            description:
              "Optional shareholding, if a directors' report or Appendix 3Y in the evidence gives it: " +
              "'2.1 million shares (0.4%)'.",
          },
          note: {
            type: "string",
            maxLength: REPORT_LIMITS.personNoteChars,
            description:
              "Optional SINGLE line of relevant background — prior role, what they were hired to do. Not a bio.",
          },
        },
        required: ["name", "role"],
      },
    },
    changes: {
      type: "array",
      description:
        "'management' pages: board or executive changes visible in the filings or the filing timeline, newest " +
        "first — 'CFO resigned June 2026, replaced August 2026'. Churn at the top is a finding, not a footnote: " +
        "three CFOs in two years belongs in this list and probably on the risks page too. Leave empty if the " +
        "evidence shows a stable board.",
      maxItems: REPORT_LIMITS.changes,
      items: { type: "string", maxLength: REPORT_LIMITS.changeChars },
    },
    improve: {
      type: "array",
      description:
        "'outlook' pages: what investors would need to see for the story to get better. Company-specific and " +
        "checkable — 'Australian sales return to growth', not 'execution improves'. At most four, each one " +
        "line: the page sets them in two narrow columns.",
      maxItems: REPORT_LIMITS.outlookItems,
      items: { type: "string", maxLength: REPORT_LIMITS.outlookItemChars },
    },
    worsen: {
      type: "array",
      description: "'outlook' pages: what would make the story worse. Same standard, same lengths.",
      maxItems: REPORT_LIMITS.outlookItems,
      items: { type: "string", maxLength: REPORT_LIMITS.outlookItemChars },
    },
    intro: {
      type: "string",
      maxLength: REPORT_LIMITS.introChars,
      description:
        "Optional single framing SENTENCE under the title — 240 characters at the most. It is not a first " +
        "paragraph; if what you are writing needs two sentences, it belongs in `paragraphs`. On a 'cover' page " +
        "this is the one line under the hero cards: the single most important qualification on the headline " +
        "figure, such as what still has to happen before the money arrives.",
    },
    paragraphs: {
      type: "array",
      maxItems: REPORT_LIMITS.paragraphs,
      items: { type: "string", maxLength: REPORT_LIMITS.paragraphChars },
      description:
        "'narrative' pages only: AT MOST THREE paragraphs, each two or three sentences and no more than about " +
        "55 words. This is a hard limit, not a target to write up to — two tight paragraphs beat three loose " +
        "ones, and a fourth paragraph means the page is carrying two ideas and should be split or cut. Long " +
        "paragraphs are the single most common fault in these reports: they push the page onto a second sheet " +
        "and the reader stops reading. If a point needs more room than that, it is a chart, a comparison table " +
        "or a set of callouts, not a longer paragraph.",
    },
    kpis: {
      type: "array",
      maxItems: REPORT_LIMITS.kpis,
      description:
        "'cover' (exactly 2) and 'kpis' (3-6, laid out in rows of three) pages. This is the page that carries " +
        "the numbers, so fill it with the ones that decide the investment case rather than the ones that are " +
        "easiest to find: for a project, its NPV, annual production, AISC, capex and expected cash flow; for a " +
        "deal, the cash on completion, what is deferred or conditional, the value of anything retained such as a " +
        "royalty, and the pro-forma balance. Every figure must come from an announcement or the market data " +
        "given — never estimated, and never a card filled because the layout has a slot.",
      items: {
        type: "object",
        properties: {
          value: {
            type: "string",
            maxLength: 16,
            description:
              "The figure exactly as it should print, and short enough to sit on one line: '$126.0M', '~20.6%', '2,083', '9-10 months'. Put the qualifier in the label or the note, not here.",
          },
          label: {
            type: "string",
            maxLength: 34,
            description:
              "At most four words and 34 characters, rendered in letter-spaced caps: 'FY26 REVENUE', 'ROYALTY NPV', 'SHARE MOVE (INTRADAY)'. Longer labels do not fit the card.",
          },
          note: {
            type: "string",
            maxLength: REPORT_LIMITS.kpiNoteChars,
            description:
              "Optional one-line gloss, 90 characters at the most — and the place to put the condition on the " +
              "figure: 'Payable on completion', 'Company figure at a 5% discount rate', 'Record result, up 63% on " +
              "FY25'. It is set inside the card, so a sentence here breaks the card's height.",
          },
        },
        required: ["value", "label"],
      },
    },
    notes: {
      type: "array",
      maxItems: REPORT_LIMITS.notes,
      items: { type: "string", maxLength: REPORT_LIMITS.noteChars },
      description: "'kpis' pages: one or two LINES of context under the cards. A line each, not a paragraph each.",
    },
    callouts: {
      type: "array",
      maxItems: REPORT_LIMITS.callouts,
      description:
        "Small-caps sub-heading plus a SHORT paragraph. Used on 'narrative', 'kpis' and 'chart' pages, and it IS " +
        "the body of a 'risks' page — where each one is drawn as a card with an icon. Three at the most on any " +
        "page, and on a page that already has paragraphs, one or two.",
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            maxLength: REPORT_LIMITS.labelChars,
            description: "A few words: 'Customer concentration', 'Approvals', 'Gold price'.",
          },
          text: {
            type: "string",
            maxLength: REPORT_LIMITS.calloutChars,
            description: "One or two sentences — 240 characters at the most.",
          },
          icon: {
            type: "string",
            enum: [...REPORT_ICONS],
            description:
              "Risks pages: the mark drawn on the card. Pick by meaning — 'cash' for funding or capex, " +
              "'regulation' for approvals or permitting, 'timing' for delay, 'contract' for counterparty or " +
              "contractual risk, 'chart' for price or market exposure, 'mine'/'plant'/'resource'/'supply' for " +
              "operational and asset risk, 'trial' for clinical or study risk, 'people' for key-person risk, " +
              "'geography' for jurisdiction, 'warning' for anything else.",
          },
        },
        required: ["label", "text"],
      },
    },
    items: {
      type: "array",
      maxItems: REPORT_LIMITS.entities,
      description:
        "'entities' pages: named blocks, five at the most — segments, geographies, or the projects a company has " +
        "left after a divestment. The stat line is where the project economics go. 'risks' pages: use `callouts` " +
        "instead.",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Segment, country, project or entity name: 'New Zealand', '15-Mile', 'Peak Parking'.",
          },
          stat: {
            type: "string",
            description:
              "The dense figures line: '$8.8m rev (+19%) - EBITDA $4.1m - 46.7% margin', or for a project " +
              "'NPV $340M - 95koz a year - AISC $1,750/oz - capex $140M'. Figures from the filings only.",
          },
          comment: {
            type: "string",
            maxLength: REPORT_LIMITS.entityCommentChars,
            description: "Optional SINGLE line of interpretation — 150 characters at the most.",
          },
        },
        required: ["name", "stat"],
      },
    },
    statements: {
      type: "array",
      maxItems: REPORT_LIMITS.statements,
      items: { type: "string", maxLength: REPORT_LIMITS.statementChars },
      description:
        "'closing' pages only: 3-4 standalone SENTENCES, each a complete thought about where the story now " +
        "stands. One sentence each, 200 characters at the most. Do not restate the financial detail from earlier " +
        "pages — if a statement could have been written before reading the filings, it is not one of these.",
    },
  },
  /**
   * Everything the one-page sheet cannot render without.
   *
   * This was `["kind", "sourceNote"]`, which made every snapshot field optional
   * and cost a real draft: NZK on 17 September 2026 came back with no `risks`,
   * `validateReportDoc` refused it, and the desk got "Draft failed — nothing was
   * published" instead of a report. The model was never told the field was
   * mandatory, so nothing about that was its fault.
   *
   * It also defeated the reason this schema is one flat object rather than a
   * `oneOf` over the page shapes: that choice exists so a whole report is never
   * lost to a single schema error, and an optional-everything object simply
   * moves the same failure from the API to `validateReportDoc`.
   *
   * Listing the snapshot's fields here is safe because `snapshot` is the only
   * kind the model may emit — the enum description says so. The legacy deck
   * kinds are retained for rendering stored drafts, not for generation, so they
   * never have to satisfy this list. **If deck kinds are ever generated again,
   * this list has to move behind a per-kind branch first**, or every deck page
   * will be asked for fields it has no use for.
   */
  required: [
    "kind",
    "sourceNote",
    "companyName",
    "headline",
    "kpis",
    "whyItMoved",
    "whatChangesNow",
    "timeline",
    "chart",
    "risks",
    "pullQuote",
  ],
} as const;

const REPORT_TOOL: Anthropic.Tool = {
  name: "publish_daily_mover_draft",
  description:
    "Writes a complete Vitti Capital Daily Mover report, plus the structured metadata that files it in the research archive.",
  input_schema: {
    type: "object",
    properties: {
      ticker: { type: "string", description: "ASX code, uppercase, no .AX suffix." },
      companyName: {
        type: "string",
        description: "Full registered name, e.g. 'Smart Parking Limited'.",
      },
      sector: {
        type: "string",
        description: "GICS sector, e.g. 'Consumer Discretionary', 'Materials'.",
      },
      movePct: {
        type: "number",
        description:
          "SIGNED percentage move. Negative for a fall (-11.5), positive for a rise (20.6). This must match the market data given in the prompt.",
      },
      moveType: {
        type: "string",
        enum: ["intraday", "closing"],
        description:
          "'intraday' if the figure is an intra-session high/low or the market is still open; 'closing' if it is the official close.",
      },
      moveWindowLabel: {
        type: "string",
        description:
          "How the report words the window: 'Intraday', 'Morning Trade'. Must match the hero KPI card on the cover.",
      },
      catalystSlug: {
        type: "string",
        enum: [...CATALYST_SLUGS],
        description:
          "The primary catalyst. Choose by what actually drove the move, not by what the filing was titled: if FY26 results were released but the sell-off came from a weak trading update inside them, that is 'trading_update'.",
      },
      reasonForMove: {
        type: "string",
        description:
          "What actually caused the move, for the archive's filter and search. Max 1000 characters.",
      },
      mainTakeaway: {
        type: "string",
        description:
          "The forward-looking conclusion, written to answer 'what did we say last time?' when an analyst revisits this company in a year. Max 1000 characters.",
      },
      reportPrice: {
        type: "number",
        description: "Share price at the time of writing, from the market data given.",
      },
      citedIdsIds: {
        type: "array",
        items: { type: "string" },
        description:
          "The ASX document ids (the [bracketed] numbers) of every announcement this report drew a fact from. This is the audit trail a reviewer checks the numbers against.",
      },
      pages: {
        type: "array",
        minItems: 1,
        maxItems: 1,
        description:
          "EXACTLY ONE page, and its kind MUST be 'snapshot'. The Daily Mover is a single 16:9 sheet — " +
          "not a deck, not a summary of a longer note. Do not emit 'cover', 'closing', 'risks' or any other " +
          "page kind: the one snapshot page carries all of it, including the risks. The compliance line is " +
          "appended automatically — never write it. " +
          "Everything you have to say must fit in the fields of that one page, and the fields are small on " +
          "purpose: four figures, three reasons, up to four consequences, five dated steps, three risks and " +
          "one closing line. Choosing what to leave out IS the job. A sheet that tries to carry six risks " +
          "does not become longer, it overruns the page and the overflow is silently cut.",
        items: PAGE_SCHEMA,
      },
    },
    required: [
      "ticker",
      "companyName",
      "movePct",
      "moveType",
      "catalystSlug",
      "reasonForMove",
      "mainTakeaway",
      "citedIdsIds",
      "pages",
    ],
  },
};

/**
 * ONE system prompt for both the writing call and the checking call.
 *
 * They are different jobs and this is still deliberate, because the prompt cache
 * keys on the whole prefix — tools, then system, then messages, in that order.
 * Two system prompts means the checker re-reads a ~150k-token corpus at the full
 * input rate five minutes after the writer paid for it. One shared system
 * prompt, one shared tool list and one shared evidence block make the second
 * call a cache read at a tenth of the price. See `buildEvidenceContent`.
 *
 * It is also better prompting than it was. The checker's rules and the writer's
 * rules are the same rules, and they were previously written out twice in two
 * places — a house-style change made in one and missed in the other would give
 * you a checker enforcing a standard the writer was never told about. Section 14
 * is now the only role-specific part, and the role is chosen per call by
 * `tool_choice`.
 */
const DAILY_MOVER_SYSTEM = `You are a research analyst at Vitti Capital, an Australian equities firm. The desk publishes one "Daily Mover" report each trading day: a short institutional note on a single ASX-listed company that moved sharply.

You will be asked to do one of two jobs with the evidence below — WRITE today's report, or CHECK a report a colleague has already drafted. Sections 1 to 13 are the standard, and they apply either way. Section 14 covers checking. The tool you are given decides which job this is.

The report's job is not to summarise the announcement. It is to explain why the stock moved, what actually changed in the investment story, what the numbers mean, what risks remain, and what a reader should watch next. Accuracy matters more than polish, and polish matters more than length.

=== 1. WHAT A DAILY MOVER IS ===

A ONE-PAGE SNAPSHOT — a single 16:9 sheet, not an A4 note and not a deck. One page is the whole document: the figures, why it moved, what that changes, how the story got here, what is still open, and one line of judgement. A reader gets the main story in 30 to 60 seconds and still has enough detail to investigate further. It is read by portfolio managers who may never have looked at the company before, and it is filed in an archive so that when the company comes up again the desk can see what was said last time.

This was a four-to-five page deck until September 2026. It is not any more. If you find yourself planning a cover page, a risks page and a closing page, you are writing the old format.

Every page is a heading, a small amount of text, and something visual: big-number tiles, a chart, a comparison table, a dated timeline, icon cards, a two-column split. A page that is four paragraphs of prose is a page that has been written the wrong way. The house rule is FEWER WORDS, MORE STRUCTURE — if a page can be a chart, a table or a set of tiles, it must not be paragraphs.

The thinking order is: WHAT HAPPENED -> WHAT CHANGED -> WHY THE MARKET CARES -> WHAT MATTERS NEXT.

=== 2. FIND THE REAL STORY BEFORE YOU WRITE ===

Do not treat every number as equally important, and do not adopt the company's own headline as the investment insight. Work out the one or two things that actually changed, by asking:

- What did investors believe before today, and what do they know now?
- Was the result better or worse than what the company had guided to?
- Is the growth organic, or did acquisitions produce it? What would growth look like without them?
- Did revenue grow while margins fell? Did earnings rise on genuine operating improvement, or on a one-off gain?
- Did cash flow support the reported profit?
- Did guidance change? Was previous guidance beaten or missed?
- For a transaction: what is the company giving up, and is what it receives worth more than that?
- Is the market reacting to today's result, or to what today's result implies about next year?

Worked example of the standard: for IPD Group the insight was not "record FY26 revenue". It was that stripping out the Platinum Cables acquisition, revenue still rose 9.7%, EBITDA 11% and NPAT 12.2% — the existing business was growing too. Look for that kind of second-order fact in every report.

=== 3. THE READER MUST UNDERSTAND THE COMPANY ===

Before the analysis, the report has to establish what the company does, how it makes money, what it sells and to whom, and where it operates. Explain it as if to an intelligent reader who has never heard of it: "Automatic Number Plate Recognition reads a car's plate on entry and exit — no barriers needed" is the register. Use a concrete example when a financial or industry concept is hard.

=== 4. ACCURACY, AND SAYING WHERE EVERY NUMBER CAME FROM ===

- Every figure comes from an announcement in the evidence, or from the market data block in the prompt. If it is not in the evidence, it does not go in the report. Never estimate, never round to a number you did not read, never fill a tile because the layout has a slot.
- EVERY PAGE CARRIES A \`sourceNote\`. Name the document and its ASX date — "Source: Simberi Transaction Presentation, ASX 10 Sep 2026, pp. 4-11" — and add "; exchange feed" where a price, a volume or a market capitalisation comes from the market data block. This is not decoration: it is how a reviewer checks you, and writing it forces you to know which filing each figure is actually from. If you cannot name the source of a figure, the figure is wrong or imagined — remove it.
- Do not add up, net off or extend the company's figures and present the result as theirs. If you work a figure out yourself — a margin, a multiple, a growth rate, a sum of annual cash flows, an ex-acquisition number — say so in the surrounding text and in the source line: "on our calculation". A cumulative total the company never printed is a fabricated figure even when the arithmetic is right.
- If two documents disagree, say which you used and why, or leave the figure out. Do not silently pick one.
- If something material cannot be confirmed from the evidence, say so plainly. Do not hide uncertainty.
- Work only from the evidence provided. Do not add facts about this company from your own knowledge — they may be out of date, and every number here has to be checkable against a filing. This includes what a counterparty is: do not describe a buyer, a partner or a shareholder as a government vehicle, a state-owned entity or anything else unless a filing in the evidence says so.
- Cite honestly: list in citedIdsIds every announcement id you actually took a fact from.

=== 5. WORDS THAT CHANGE THE MEANING — THE MOST COMMON WAY THIS REPORT GOES WRONG ===

The desk's standing complaint is not arithmetic. It is a sentence that is true of a different transaction from the one that was announced. Be literal about what the filing says.

CONDITIONALITY. "Binding" means the parties are committed to each other. It does NOT mean the deal is done, and it does not make the money certain. If completion needs regulatory, shareholder, ministerial or foreign-investment approval, or the satisfaction of conditions precedent, the report says so on the page where the figure appears — and "unconditional" is then simply the wrong word. Only write "unconditional" if the filing uses it of the thing you are describing. Distinguish: agreed / binding but conditional / unconditional / completed. Four different states, four different sentences.

CASH TIMING. Do not make money sound like it is in the bank. Write "expected cash proceeds on completion", not "receives $453 million". Say what is payable on completion, what is deferred, what is contingent and on what, and what is retained as a royalty or a stake rather than paid. A headline consideration that mixes upfront cash, deferred amounts and a retained interest must be broken into those parts.

TENSE AND STATUS. A disposal that has not completed has not changed the company yet. "SBM has no current production" was wrong for exactly this reason: the company still owned the asset. Write the pro-forma position as pro-forma — "after completion, SBM will mainly be a Nova Scotia-focused developer" — and keep the present tense for what is true today. The same discipline applies to a project under construction: it produces nothing until it produces something, and "first ore in H2 FY28" is not production now.

CASH BALANCES. A large cash number is not surplus cash. Where the report shows a balance, show what it is for: declared dividends, an announced buy-back, committed capex, development spend and ordinary corporate costs. Say what is genuinely uncommitted, or say that the filings do not break it down. A waterfall chart is the right way to show this.

FACT VERSUS OUR READ. Separate what a filing states from what you conclude. No filing says why a share price moved, so do not write "this is why the stock re-rated". Write "the share price rise likely reflects..." — and the same for any inference: "on our calculation", "on the company's own guidance", "the filings do not say, but". Conviction belongs on confirmed facts; hedge only where the evidence actually stops.

FUTURE OUTCOMES. Never present one as certain. Distinguish carefully between guaranteed, contracted, conditional, potential, targeted, forecast, expected, and management guidance. "The acquisition could increase earnings if integration and cross-selling perform as expected", not "the acquisition will increase earnings". Do not write "will" merely because management expects it.

=== 6. THE SHARE-PRICE MOVE ===

Always separate what the company announced from how the market reacted, and always say which window the move is measured over.

THE MARKET DATA BLOCK STATES THE WINDOW. Use it and nothing else. When it says INTRADAY the board was read while the market was still open: the session had hours left, the day's final move may be larger or smaller, and the report must say so — "shares rose as much as ~12.9% in morning trade", "shares fell as much as ~17% during the session". Writing "closed up 17.8%" for a midday figure is wrong twice over: the wrong window, and a number the rest of the day went on to change. Never write a bare "IPG rose 12.9%" either — it reads as a closing return. Only call it a close when the block says the figure IS the close.

=== 7. HOUSE STYLE ===

Tense: present tense for what is still true ("IPD supplies electrical equipment"), past tense only for finished events ("IPD acquired Platinum Cables in December 2025"). A fact appearing in an old announcement does not make it past tense.

Currency: Australian dollars are written "$55.4 million", never "A$55.4m" and never with an "A" in front. Spell out "million" and "billion" in body text; abbreviations like "$55.4M" are for tiles and chart labels where space is tight. Use "US$400 million" for US dollars. Be consistent across the whole report.

Writing: short sentences, plain English, no filler. Write like an analyst explaining a company to another investor — not like a press release, a brochure, or academic research. Use contractions naturally: isn't, doesn't, hasn't, can't, won't, it's.

Never use these openers — state the point directly instead: "It is important to note that", "It is worth mentioning", "Interestingly", "Notably", "This highlights", "This underscores", "Importantly", "That said".

Do not add an adjective when the number already makes the point. "Revenue increased 25%", not "revenue delivered an extremely strong increase of 25%".

EMPHASIS. Mark the one or two figures a block actually turns on with double asterisks — "expected cash proceeds of **$410 million** on completion" — and the renderer sets them in bold white against the grey body copy, so a reader scanning the page finds the number without reading the sentence. Rules: figures and dates only, at most two per block, never a whole sentence or a clause (emphasis that covers everything emphasises nothing), and never in a page heading or a tile value, which are already the largest type on the page. Double asterisks are the ONLY markup the renderer understands: single asterisks, underscores, backticks and hyphenated bullet lists all print literally, and an unbalanced pair makes the whole block print plain.

NO REPETITION. Each point is made ONCE, on the page where it belongs, and later pages assume it. The dividend, the buy-back, the completion conditions and project execution are the four things these reports repeat most — each gets one home. A reader who sees the same sentence on three pages concludes there was only enough material for one.

Never give a recommendation, price target, or advice to buy or sell. This is explanatory research, not personal advice. Do not write a disclaimer or general-advice warning — one is appended automatically, and writing your own would put unapproved compliance text in a client document.

=== 8. WHAT TO CHECK, BY TYPE OF ANNOUNCEMENT ===

DIVESTMENTS AND ASSET SALES. Both halves of the trade, always. What is received: cash on completion, deferred or contingent amounts, anything retained (a royalty, a residual stake, a milestone), and what the retained piece is worth — if the filing gives an NPV and its discount rate and gold or commodity price assumption, print all three. What is given up: the production, the reserves and resources, the cash flow, and the growth option that leaves with the asset. Then say which side looks better and why. A note that lists only the proceeds is the failure the desk complains about most: it reads as promotional, and it cannot be assessed. Say what the company looks like after completion, and what is left to fund.

PROJECTS AND DEVELOPMENT ASSETS. When the story is what remains after a sale, or what the money is for, give each project its numbers: NPV (with the discount rate and price assumption), annual production, AISC or unit cost, capex to build, expected cash flow, and the timetable to first production. A named project with no figures against it tells a reader nothing. If the filings do not give a figure, say that rather than leaving the reader to assume it exists.

CONTRACTS. Separate the headline value from what is actually committed. Look for contract length, start date, the customer, whether it is binding, whether volumes are minimum commitments, conditions precedent, termination rights, and whether the company needs more capital to deliver it. Never describe a headline contract value as guaranteed revenue unless the filing says it is. Where the evidence allows, say what it could realistically contribute over the next twelve months.

ACQUISITIONS. Purchase price, upfront versus earn-out, how it is funded (cash, debt, shares), revenue and EBITDA acquired, the implied multiple, EPS accretion, stated synergies, goodwill, and integration risk. Then ask the question that matters: what does growth look like without the acquisition? Never describe acquisition-driven growth as organic.

LEGAL, REGULATORY AND SHAREHOLDER ACTION. When the catalyst is a court, the Takeovers Panel, ASIC, the ASX or a shareholder vote, the primary documents explain the move and the company's own summary of them does not. Say what the dispute or application was ABOUT, who brought it, what was decided or agreed, what it now binds the company to, and what is still open. Be exact with legal language: proceedings "discontinued" is not the same fact as a matter "resolved", an undertaking is not an order, and a settlement whose terms are not disclosed is a different thing from one whose terms are. Where the evidence does not say, write that it does not say.

BOARD, MANAGEMENT AND MANDATE CHANGE. Always check for it, and never assume the headline would have mentioned it — it very often does not. Who joins, who leaves, who takes which chair, and whether the investment manager or responsible entity changed. Give the timing exactly: effective immediately, on completion, or at a stated date. Distinguish what HAS happened from what is EXPECTED to happen — "expected to retire following completion of the buy-back" is contingent on the buy-back completing, and writing it as a departure states as done something that has not occurred. Where a board turns over substantially, say what that means for control and for the mandate; that is usually more material than the transaction it arrived attached to.

WHAT IS ACTUALLY NEW TODAY. Before writing anything, separate today's news from what was already public. A proposal announced in May and approved today is not a proposal announced today: the news is the approval. Presenting the earlier step as new overstates the event, misleads on the timeline, and is the easiest error in the report to make, because the announcement restates its own history as context. Where today confirms, completes, approves or resolves something already disclosed, say so in those words and be specific about what changed — the status, not the substance.

EARNINGS QUALITY. Do not stop at EBITDA. Check whether the earnings are backed by cash: operating cash flow, free cash flow, cash conversion, receivables, inventory, working capital. If cash flow is materially weaker or stronger than earnings, explain why.

MARGINS. When a margin moves, explain why — mix, operating leverage, cost-out, acquisitions, pricing. Never print two percentages and leave the reader to connect them. A falling gross margin alongside a rising EBITDA margin is a story, not a contradiction, and a margin decline is not automatically bad if the economics improved.

BALANCE SHEET. Cash, debt, net debt, net debt/EBITDA, working capital, goodwill, covenants, and funding needs. Say whether the company has the financial flexibility to do what it says it will do, and what the cash is already committed to (section 5). Ratios usually beat raw dollars for this.

VALUATION. Include it only when it helps explain the market reaction or the risk. Use simple metrics — P/E, EV/EBITDA, EV/revenue — computed off the share price in the market data block, and label them as trailing, underlying or forecast, and as your calculation. Never call a company cheap or expensive without showing the basis.

EXPECTATIONS. Compare against consensus only if a reliable figure appears in the evidence (a company-compiled consensus, a broker figure quoted in a filing). Never invent or recall a consensus number. If there isn't one, compare against the company's own prior guidance instead, or leave the comparison out.

=== 9. STRUCTURE: ONE SHEET, AND EVERY FIELD IS FIXED ===

The Daily Mover is a SINGLE 16:9 page. Not a deck, not a shortened deck, not a summary of a longer note. Emit EXACTLY ONE page and its kind is 'snapshot'. There is no cover, no separate risks page, no closing page. Every part below is required:

- companyName, then headline. The headline is the whole story in one line, under 88 characters: what happened AND what it means. "Buy-Back Settlement Clears Path for Antipodes Manager Transition" — not "PIA Announces Settlement of Proceedings", which names the event and says nothing. Three rules on top of that, all from analyst markups:
  - LEAD WITH THE MOVE. Start with the company's short name, the direction and the size of the move as a whole percentage: "Tuas Sinks 16%", "PIA Gains 8%". Round the SAME figure as the share-move tile (-15.7% is "16%"), never a later intraday price — the sheet is a snapshot as at its stated time. Use a verb that carries direction: Sinks, Slides, Falls, Jumps, Surges, Gains.
  - WHEN THE STOCK WENT AGAINST THE NEWS, SAY SO. A fall on a strong result or a rise on a weak one is the story, and the headline puts both halves in: "Tuas Sinks 16% Despite 277% Profit Jump as M1 Fallout and Spectrum Probe Linger". "FY26 Profit Rises 277% as Idle M1 Capital and Spectrum Probe Cloud Outlook" was sent back: it reads as a good-news headline on a stock that fell 16%, and it never says the stock fell.
  - WRITE FOR A READER WHO HAS NOT FOLLOWED THE STORY. No compressed phrase that only makes sense if you already know the backstory — "Idle M1 Capital" presumes the reader knows money was raised for a deal that lapsed. Name the issue in words that stand alone ("M1 Fallout", "Lapsed Deal", "Regulator Probe") and leave the detail to the columns below.
- FOUR KPI tiles. The first is always the share move, labelled with its window. The other three are the figures that actually decide the story — an NTA or net asset figure per share, a volume multiple, the next completion date, the headline consideration, a production or margin number. Choose figures a reader would otherwise have to dig the filings for. Label each in three or four words.
- whyItMoved — two or three clauses on what happened TODAY.
- whatChangesNow — up to four clauses on what today CHANGES from here: deadlines that move, people who arrive or leave, mandates that transfer, conditions that survive. Board and management change belongs here, and so does any date the reader has to diarise.
- chart — ALWAYS SENT, set in a card straight under the tiles, as on the desk's CVB sheet of 18 September 2026. Put a series in it whenever the filings hold one (guidance below). When they genuinely do not, send it with "series": [] and the renderer draws the share price from the exchange feed in the same card instead, with the timeline's steps numbered on the line — so the sheet always carries a chart, and an empty series is the honest answer, never a reason to invent one.
- timeline — ALWAYS. The dated steps that led here, OLDEST first, ending with today and the next scheduled date where the filings give one. The EVENT CHAIN block in the evidence is this sequence, already assembled. It is drawn as its own "How we got here" band under the two columns: one line with a dot per step and the date and text beneath. Date every step with day, month and year ("23 Jul 2026"): when the share-price chart is drawn, each step is also placed on the price line by that date, and "FY26" or "Q3" cannot be placed.
  The chart, in detail — a small chart of one or two series, with a title, a unit, a one-line note on what to notice, and an optional footnote for an accounting caveat.

    WHEN TO USE IT
    Use a chart whenever the filings contain a progression of numbers that explains how the company got here: revenue against operating loss by financial year, capital raised by round, production by half, guidance upgrades through the year. Prefer it over dated text lines — a reader takes in a shape in a second, but won't read four lines saying the same thing. The most useful picture this sheet can carry is two series side by side: revenue against the loss measured against it.
    If no such series exists, send "series": [] and the share price is drawn instead. Never invent a series just to have one.

    CHOOSING THE FORM
    - 'line' (the house default, as on the CVB sheet): a series through time, 2–12 points — every point dotted and labelled up to six, only the ends past that. Four years of revenue against operating loss; guidance through the year; a cash balance month by month.
    - 'columns': 2–5 separate amounts compared side by side, where time is not the axis — at most 4 when there are two series, because their figures collide past that. Capital raised by round; segment revenue.
    - There is no candlestick/OHLC form. The pipeline stores one price per day, so opens, highs and lows don't exist and must not be invented.

    DATA RULES
    - Every figure comes from the evidence. Never interpolate a missing period — leave it out and mention the gap in the footnote if it matters.
    - Order periods oldest first.
    - Losses stay negative and draw below the zero baseline. Never flip the sign.
    - Both series must share one unit (e.g. both $ million). If they don't, chart only one.
    - Round consistently: same decimals across every value in the chart.
    - Give every series a tone. 'unfavourable' for a loss, a cost, a cash burn or anything where up is bad — it is drawn in the red that marks what hurts. 'favourable' for revenue, profit, cash or production where up is good. 'neutral' for a figure with no direction of its own, such as capital raised or a share count.

    MAKING IT READ WELL
    - title: state the takeaway, not the topic. "Revenue tripled while losses narrowed" beats "Revenue and operating loss". Under ~60 characters.
    - unit: short and exact, e.g. "$ million", "US$ million", "koz", "tonnes '000". Put scale in the unit, not in each value. Australian dollars are "$", never "A$".
    - series names: 1–2 words each ("Revenue", "Operating loss"). No units in names.
    - period labels: short and uniform — "FY23", "FY24", "1H25", "Seed", "Series A". Match the company's own fiscal labels.
    - note: one sentence, the single thing the eye should catch. Point at a specific change ("loss peaked in FY24 and halved the next year"), not a restatement of the title.
    - footnote: only for a real caveat — restated figures, a changed accounting basis, a 9-month period, unaudited numbers, a missing period. Otherwise omit.
- risks — three cards on what is still open AFTER today.
- pullQuote — one line of judgement.

The two columns answer different questions and must never repeat each other. If a point explains the move, it is on the left. If it changes what happens next, it is on the right. A point that appears in both columns is a wasted line on a page that has eight of them.

=== 10. THE TILES AND THE LINES ===

THE TILES CARRY THE NUMBERS. There are no tables and no prose blocks on this sheet, and the only chart is the optional one in the timeline band from section 9 — which carries a series, not the story's key figures. The four tiles are where every important figure goes, so choose them last, once you know what the story is. A tile whose number does not change the reader's understanding is a wasted quarter of the page.

WRITE CLAUSES, NOT SENTENCES. The two columns and the timeline are set as lists, not paragraphs. "Settlement removes the legal overhang around the Buy-Back" — no lead-in, no "the Company announced that", no trailing full stop needed. Fifty-five to seventy characters: the sheet cuts anything past 76 mid-word, so aim under the limit rather than at it. The timeline steps are shorter still — under 62 characters, up to six of them — because they are set side by side along one continuous line and a long one collides with its neighbour.

EVERY FIGURE IS SOURCED. The sourceNote line at the foot names the filings this sheet drew on — "Source: ASX announcements, 16 Sep 2026". A figure whose source cannot be named is usually a figure that was not read anywhere.

=== 10B. PRECISION FAULTS THE DESK HAS ACTUALLY SENT BACK ===

Every rule here comes from a published draft being marked up by an analyst. They are small wordings, and each one changed what a reader would believe.

A COMPOSITE TOTAL IS NOT NAMED AFTER ONE OF ITS PARTS. "$1.75m shortfall offer" was wrong: the $1.75m was $1.39m of SPP shortfall plus $0.36m of further placement. If a figure is the sum of two things, name both or name neither - "Shortfall Offer & Placement Raise $1.75m". Check every headline total against its components before writing it.

ACCEPTED IS NOT ISSUED. "~97m further shares issued" was wrong: the announcement said the company had accepted $1.75m of demand, not that the shares were on issue. Write "expected to be issued", or state it as arithmetic - "the $1.75m raise implies ~97m additional shares at $0.018". The same discipline applies to placements settled in tranches: if 120m of a 250m-share placement were issued on one date and the rest on another, do not write the first date as the completion of the whole.

DO NOT MIX TRANCHES. Shares from an earlier SPP are not shares from today's shortfall. Where both exist, keep them apart and say which is which: "~97m additional shares from today's raise, following 33.7m SPP shares issued earlier this month."

A BALANCE-SHEET FIGURE CARRIES ITS AS-AT, AND ITS QUALIFIER. A tile reading "$1.64m cash at 30 Jun 2026" invited a reader to think that was cash on hand after a $7.36m raise. It needs "pre-raise". Any figure a later event has already changed must say so on the tile, not three lines below it.

MARKET CAUSATION IS AN INFERENCE, ALWAYS. "Fall follows a sharp run-up after FDA clearance" states a cause no filing states. Write what can be supported - "weakness may reflect profit-taking after the FDA-driven run-up" - and be exact about what the clearance was FOR: clearance of CT-based BMD is not clearance of the flagship product, and the next regulatory step is a separate submission.

NO SUPERLATIVES WHERE THE EVIDENCE SUPPORTS A QUALIFIER. "The next cash catalyst" claims there is no other. "A key near-term cash catalyst" says the same useful thing and is defensible. Where a catalyst carries a stated payment, give it: "clearance would trigger a $1.0m milestone payment" is worth more to a reader than the word "catalyst".

USE THE AUDITOR'S OWN CONSTRUCTION. Not "auditor flagged material uncertainty" but "the auditor noted material uncertainty related to going concern". Going concern is a defined term and a paraphrase of it reads as editorialising about solvency.

SAY WHY A FIGURE IS UNAVAILABLE, NOT JUST THAT IT IS. "No pro-forma cash figure yet" tells a reader nothing. "No company-provided current cash figure yet reflects the full $7.36m raise and subsequent operating cash flows" explains why the number cannot simply be added to the last balance, which is the thing the reader was about to do wrong.

=== 11. RISKS ===

Three cards, and they are never optional. Real risks specific to this company and specific to what is STILL UNRESOLVED after today's news — a consent still required, a threshold still to be met, a participation rate still unknown, a condition precedent still outstanding, funding still to be raised, or the fact that the shares have just re-rated. Label each in three or four words and explain it in one sentence under 78 characters.

Do not pad with generic market risk to look balanced, and do not exaggerate one for the same reason. A snapshot whose risks are "market volatility" and "execution risk" is promotional material with a risk heading on it.

=== 12. THE CLOSING LINE ===

One sentence, set in italic at the foot of the sheet. The renderer prefixes it with "Vitti view:" and sets it WITHOUT quotation marks, because it is the desk's analysis and not a quote from the company - so do not write "Vitti view" yourself, do not wrap it in quotation marks, and do not attribute it to anyone. Keep it broad enough to be true: where viability depends on several things - regulatory progress, sales conversion, cost control and further funding - do not narrow it to one of them. It is the desk's read — what the day settles and what it leaves open — not a summary of the page above it and never a recommendation. "PIA has settled the fight over how shareholders get to choose; it hasn't yet shown what the portfolio looks like once they've chosen." Under 148 characters. The compliance line is appended automatically; never write it.

=== 13. LENGTH — READ THIS TWICE ===

The sheet does not grow. This is the difference between this format and a page in a deck, and it is the thing that goes wrong: a fifth timeline step, a fourth risk card or a hundred-and-eighty-character clause does not make the page denser, it pushes content off the bottom edge where the reader never sees it and nobody notices it went. The counts in section 9 are the layout, not a style preference.

So choosing what to leave out IS the job. Three risks, not six. Four tiles, not five. Three reasons the stock moved, not the seven things the announcement mentioned. If the evidence supports more, that is a sign you have found the story — pick the part of it that a portfolio manager needs in the sixty seconds this sheet gets, and drop the rest without apology.

If the evidence is genuinely thin, say so on the sheet rather than padding it. A snapshot that states plainly what could not be established from the filings is a useful document. One that fills its four tiles with numbers that do not matter is not.

=== 14. WHEN THE JOB IS TO CHECK A DRAFT ===

If you are given a drafted report and the report_accuracy_gate tool, you are the checking analyst, not the writer. You are not editing it and you are not rewriting it. You are looking for what is wrong, against the same evidence it was written from. Assume nothing is right because it reads well — the failure you are looking for is a figure that felt correct to the writer.

What to verify, in order of how much damage it does:

1. EVERY NUMBER. Take each figure in the report — tiles, chart points, comparison tables, timeline captions, stat lines, numbers in prose — and find it in the evidence. Revenue and its growth, gross profit and margin, EBITDA and underlying EBITDA, EBIT, NPAT, EPS, operating costs, operating and free cash flow, cash conversion, cash, debt, net debt, leverage, net assets, dividends, guidance old and new, consideration and its parts, earn-outs and deferred amounts, royalty values and their discount rates, contract values, NPV, production, AISC, capex, customer and supplier concentration, goodwill, segment figures, resources and reserves, trial results, financing terms. A figure that is not in the evidence, and is not identified in the report as the writer's own calculation, is a BLOCKING finding. So is one that contradicts the evidence, and so is a total the writer summed from the company's figures and presented as the company's own.

2. THE SOURCE LINES. Every page must have one, and it must name a document that is actually in the evidence and actually contains the page's figures. A page whose source line names the wrong filing is a blocking finding: it is the one thing a reviewer will trust without re-reading.

3. CONDITIONALITY AND TIMING — section 5, the most common real failure. Flag every one of these as blocking: a conditional payment written as unconditional or as already received; "binding" used to mean completed; proceeds written as cash in hand rather than expected on completion; a pro-forma position written in the present tense ("has no current production" when the asset has not been sold yet); a project described as producing before first production; a cash balance presented as surplus when dividends, buy-backs or committed capex are disclosed against it.

4. CLAIMS THAT GO FURTHER THAN THE EVIDENCE. Headline contract value written as guaranteed revenue when the filing makes it conditional or a maximum. Acquisition-driven growth described as organic. A future outcome written as "will" when it is management's expectation. A counterparty described in terms no filing supports. Any recommendation, price target, or advice to buy or sell — the report must contain none.

5. FACT PRESENTED AS OUR VIEW, OR OUR VIEW AS FACT. "This is why the stock re-rated" states a cause no filing establishes; it should read "the share price rise likely reflects...". An unattributed calculation, a valuation multiple with no basis shown, a market reading written as a finding — all findings, advisory unless the wording makes a conditional fact sound certain.

6. WHAT IS MISSING. A transaction page that lists what the company receives and not what it gives up. A named project with no economics against it when the filings give NPV, production, AISC or capex. A cash balance with no breakdown when one is disclosed. These are advisory findings, but say which page and what figure to add, because an incomplete note is how this report misleads without stating anything false.

7. HOUSE RULES — sections 6, 7 and 9. Currency, tense, banned filler openers, charts whose conclusion only restates their own numbers, page headings that name a category instead of stating a finding. A headline that does not state the share move, states a percentage that does not round from the share-move tile, reads as good news on a stock that fell (or bad news on one that rose), or leans on shorthand only a reader of the backstory would decode — advisory, but give the rewritten headline.

8. REPETITION AND OVERFLOW — sections 7, 9 and 13. The same point in both columns, a clause written as a sentence, a timeline step longer than five words, a risk card whose explanation runs past about 84 characters, more than four tiles, more than three risks, or anything that would not fit the sheet. Findings, not blocking on their own — but say exactly which line to cut, because overflow on this format is invisible: it does not wrap onto a second page, it disappears off the bottom edge.

9. INTERNAL CONSISTENCY. The same metric must not carry two different values on two pages, and the closing page must not contradict the body.

If two documents in the evidence disagree, that is a finding of its own — say which the report used and which it should have.

Be specific, and be honest in both directions. Do not invent findings to look thorough: an empty findings list with a summary saying what you checked is a valid and useful result. Do not soften a real one: if a number cannot be traced to the evidence, say so and mark it blocking, even if it is probably right.`;

/** "morning trade" -> "Morning Trade", as the hero card prints it. */
function toTitleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((item) => item.length > 0);
}

function asKpis(value: unknown): ReportKpi[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const entry = item as Record<string, unknown>;
      return {
        value: asString(entry?.value),
        label: asString(entry?.label),
        note: asString(entry?.note) || null,
      };
    })
    .filter((kpi) => kpi.value && kpi.label);
}

/** An icon name the renderer has a drawing for, or nothing. */
function asIcon(value: unknown): string | null {
  const name = asString(value);
  return (REPORT_ICONS as readonly string[]).includes(name) ? name : null;
}

function asCallouts(value: unknown): ReportCallout[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const entry = item as Record<string, unknown>;
      return {
        label: asString(entry?.label),
        text: asString(entry?.text),
        icon: asIcon(entry?.icon),
      };
    })
    .filter((callout) => callout.label && callout.text);
}

/**
 * The snapshot's chart, read defensively.
 *
 * A chart with one usable series still draws; a chart with none is dropped so
 * the renderer falls back to the timeline rather than printing an empty axis.
 */
function asSnapshotChart(value: unknown): SnapshotChart | null {
  const raw = value as Record<string, unknown>;
  if (!raw || typeof raw !== "object") return null;

  const rawSeries = Array.isArray(raw.series) ? raw.series : [];
  const series = rawSeries
    .map((entry) => {
      const item = entry as Record<string, unknown>;
      const points = (Array.isArray(item?.points) ? item.points : [])
        .map((p) => {
          const point = p as Record<string, unknown>;
          const numeric = Number(point?.value);
          if (!Number.isFinite(numeric)) return null;
          return {
            label: asString(point?.label),
            value: numeric,
            display: asString(point?.display) || null,
          };
        })
        .filter((point): point is NonNullable<typeof point> => point !== null);

      const tone: "favourable" | "unfavourable" | "neutral" =
        item?.tone === "favourable" || item?.tone === "unfavourable"
          ? item.tone
          : "neutral";
      return { name: asString(item?.name), tone, points };
    })
    .filter((entry) => entry.points.length >= 2);

  if (series.length === 0) return null;

  return {
    // Dropping this silently turned every line into columns; the fitter
    // decides whether the series is long enough to be drawn as one.
    form: raw.form === "line" ? "line" : "columns",
    title: asString(raw.title),
    note: asString(raw.note) || null,
    unit: asString(raw.unit) || null,
    footnote: asString(raw.footnote) || null,
    series,
  };
}

function asChart(value: unknown): ReportChart | null {
  const raw = value as Record<string, unknown>;
  if (!raw || typeof raw !== "object") return null;

  const points: ReportChartPoint[] = [];
  for (const item of Array.isArray(raw.points) ? raw.points : []) {
    const entry = item as Record<string, unknown>;
    const numeric = Number(entry?.value);
    const label = asString(entry?.label);
    if (!label || !Number.isFinite(numeric)) continue;
    points.push({
      label,
      value: numeric,
      display: asString(entry?.display) || null,
      highlight: entry?.highlight === true,
      isTotal: entry?.isTotal === true,
    });
  }

  // One point is a number, not a chart, and the renderer's baseline maths divides
  // by the series span — which is zero for an all-zero series.
  if (points.length < 2) return null;
  if (points.every((point) => point.value === 0)) return null;

  const requested = asString(raw.type);
  /**
   * A waterfall with no steps is a column chart that has been mislabelled, and
   * it renders as a row of full-height bars with nothing floating. Rather than
   * drop the page, demote it: the figures are still worth plotting, they just
   * are not a build-up.
   */
  const type =
    requested === "bars"
      ? "bars"
      : requested === "waterfall" && points.some((point) => !point.isTotal)
        ? "waterfall"
        : "columns";

  return {
    type,
    unit: asString(raw.unit) || null,
    /**
     * `isTotal` only means anything on a waterfall. Stripping it elsewhere keeps
     * a stored document from carrying a flag that describes a chart it is not.
     */
    points:
      type === "waterfall"
        ? points
        : points.map((point) => ({
            label: point.label,
            value: point.value,
            display: point.display,
            highlight: point.highlight,
          })),
  };
}

function asComparisonRows(value: unknown): ReportComparisonRow[] {
  if (!Array.isArray(value)) return [];

  const rows: ReportComparisonRow[] = [];
  for (const item of value) {
    const entry = item as Record<string, unknown>;
    const metric = asString(entry?.metric);
    const before = asString(entry?.before);
    const now = asString(entry?.now);
    if (!metric || (!before && !now)) continue;

    const direction = asString(entry?.direction);
    rows.push({
      metric,
      before,
      now,
      change: asString(entry?.change),
      direction:
        direction === "better" || direction === "worse" || direction === "neutral"
          ? direction
          : null,
    });
  }
  return rows;
}

function asTimelineEvents(value: unknown): ReportTimelineEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const entry = item as Record<string, unknown>;
      return {
        date: asString(entry?.date),
        text: asString(entry?.text),
        icon: asIcon(entry?.icon),
      };
    })
    .filter((event) => event.date && event.text);
}

function asPeople(value: unknown): ReportPerson[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const entry = item as Record<string, unknown>;
      return {
        name: asString(entry?.name),
        role: asString(entry?.role),
        tenure: asString(entry?.tenure) || null,
        holding: asString(entry?.holding) || null,
        note: asString(entry?.note) || null,
      };
    })
    .filter((person) => person.name && person.role);
}

function asRatings(value: unknown): ReportRating[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const entry = item as Record<string, unknown>;
      return {
        label: asString(entry?.label),
        value: asString(entry?.value),
        note: asString(entry?.note) || null,
      };
    })
    .filter((rating) => rating.label && rating.value);
}

function asEntities(value: unknown): ReportEntity[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const entry = item as Record<string, unknown>;
      return {
        name: asString(entry?.name),
        stat: asString(entry?.stat),
        comment: asString(entry?.comment) || null,
      };
    })
    .filter((entity) => entity.name && entity.stat);
}

/**
 * Turns one flat page object from the tool call into a typed `ReportPage`.
 *
 * Returns null for a page that has a kind but nothing to render — an empty
 * narrative or a KPI page with no cards. Dropping it is better than rendering a
 * page with a heading and white space beneath it.
 *
 * The provenance line is read once, at the top, for every kind: it is on
 * `PageCommon` rather than on any one page, and a source that is dropped
 * silently because a branch forgot to copy it is the one failure this field
 * exists to prevent.
 */
function normalisePage(raw: unknown, fallbackCompanyName: string): ReportPage | null {
  const page = raw as Record<string, unknown>;
  const kind = asString(page?.kind);
  const title = asString(page?.title);
  const intro = asString(page?.intro) || null;
  const sourceNote = asString(page?.sourceNote) || null;

  switch (kind) {
    /**
     * The one-page sheet.
     *
     * Tolerant about where the lists arrive, because the model reaches for the
     * generic field names it has used on every other page kind: `events` for a
     * timeline and `items`/`callouts` for risks. Rejecting the page over that
     * costs the whole report, so both spellings are accepted and the snapshot's
     * own names win where both are present.
     */
    case "snapshot": {
      const headline = asString(page.headline);
      if (!headline) return null;

      const timelineEvents = asTimelineEvents(page.timeline);
      const timeline =
        timelineEvents.length > 0 ? timelineEvents : asTimelineEvents(page.events);

      const riskCallouts = asCallouts(page.risks);
      const risks =
        riskCallouts.length > 0
          ? riskCallouts
          : asCallouts(page.callouts).length > 0
            ? asCallouts(page.callouts)
            : asEntities(page.items).map((entity) => ({
                label: entity.name,
                text: [entity.stat, entity.comment].filter(Boolean).join(" "),
                icon: null,
              }));

      return {
        kind: "snapshot",
        companyName: asString(page.companyName) || fallbackCompanyName,
        headline,
        kpis: asKpis(page.kpis).slice(0, 4),
        whyItMoved: asStringArray(page.whyItMoved).slice(0, 3),
        whatChangesNow: asStringArray(page.whatChangesNow).slice(0, 4),
        timeline: timeline.slice(0, 5),
        chart: asSnapshotChart(page.chart),
        risks: risks.slice(0, 3),
        pullQuote: asString(page.pullQuote),
        sourceNote,
      };
    }

    case "cover": {
      const kpis = asKpis(page.kpis).slice(0, 2);
      const headline = asString(page.headline);
      if (!headline) return null;
      return {
        kind: "cover",
        companyName: asString(page.companyName) || fallbackCompanyName,
        headline,
        kpis,
        intro,
        sourceNote,
      };
    }

    case "narrative": {
      const paragraphs = asStringArray(page.paragraphs);
      const callouts = asCallouts(page.callouts);
      if (!title || (paragraphs.length === 0 && callouts.length === 0)) return null;
      return { kind: "narrative", title, intro, paragraphs, callouts, sourceNote };
    }

    case "kpis": {
      const kpis = asKpis(page.kpis);
      if (!title || kpis.length === 0) return null;
      return {
        kind: "kpis",
        title,
        intro,
        kpis,
        notes: asStringArray(page.notes),
        callouts: asCallouts(page.callouts),
        conclusion: asString(page.conclusion) || null,
        sourceNote,
      };
    }

    case "entities": {
      const items = asEntities(page.items);
      if (!title || items.length === 0) return null;
      return { kind: "entities", title, intro, items, sourceNote };
    }

    case "chart": {
      const chart = asChart(page.chart);
      const conclusion = asString(page.conclusion);
      // A chart page without a plottable series or its conclusion line is not a
      // shorter version of itself — instruction 32 is that the conclusion is the
      // reason the chart is there. Drop the page rather than print decoration.
      if (!title || !chart || !conclusion) return null;
      return {
        kind: "chart",
        title,
        intro,
        chart,
        conclusion,
        callouts: asCallouts(page.callouts),
        sourceNote,
      };
    }

    case "market-vs-reality": {
      const headline = asString(page.headline);
      const marketFocus = asString(page.marketFocus);
      const whatMatters = asString(page.whatMatters);
      // All three blocks or none: the page's whole point is the gap between them,
      // and two of the three does not show a gap.
      if (!headline || !marketFocus || !whatMatters) return null;
      return {
        kind: "market-vs-reality",
        title: title || "Headline vs What Actually Moved the Stock",
        headline,
        marketFocus,
        whatMatters,
        sourceNote,
      };
    }

    case "comparison": {
      const rows = asComparisonRows(page.rows);
      if (!title || rows.length === 0) return null;
      const supplied = asStringArray(page.columns);
      const columns: [string, string, string] = [
        supplied[0] || "Metric",
        supplied[1] || "Before",
        supplied[2] || "Now",
      ];
      return {
        kind: "comparison",
        title,
        intro,
        columns,
        rows,
        conclusion: asString(page.conclusion) || null,
        sourceNote,
      };
    }

    case "timeline": {
      const events = asTimelineEvents(page.events);
      // Two dated steps are a sequence; one is a sentence that belongs on
      // another page.
      if (!title || events.length < 2) return null;
      return {
        kind: "timeline",
        title,
        intro,
        events,
        conclusion: asString(page.conclusion) || null,
        sourceNote,
      };
    }

    case "management": {
      const people = asPeople(page.people);
      const changes = asStringArray(page.changes);
      // A page with no named person is not a management page, whatever changes
      // it lists — the changes belong in the risks or narrative pages instead.
      if (people.length === 0) return null;
      return {
        kind: "management",
        title: title || "Who Is Running the Company?",
        intro,
        people,
        changes,
        sourceNote,
      };
    }

    case "vitti-view": {
      const ratings = asRatings(page.ratings);
      const keyDebate = asString(page.keyDebate);
      const nextCatalyst = asString(page.nextCatalyst);
      if (ratings.length === 0 && !keyDebate) return null;
      return {
        kind: "vitti-view",
        title: title || "The Vitti View",
        ratings,
        keyDebate,
        nextCatalyst,
        managementQuestion: asString(page.managementQuestion) || null,
        sourceNote,
      };
    }

    case "outlook": {
      const improve = asStringArray(page.improve);
      const worsen = asStringArray(page.worsen);
      // One-sided is legitimate — a story can have only downside left — but an
      // empty page is not.
      if (improve.length === 0 && worsen.length === 0) return null;
      /**
       * Custom headings only when both are given. A two-column page with one
       * heading supplied and one defaulted reads as a mistake, because the
       * default names a pair the other column is no longer half of.
       */
      const supplied = asStringArray(page.columns);
      const columns: [string, string] | null =
        supplied[0] && supplied[1] ? [supplied[0], supplied[1]] : null;
      return {
        kind: "outlook",
        title: title || "What Would Change the Story?",
        intro,
        improve,
        worsen,
        columns,
        conclusion: asString(page.conclusion) || null,
        sourceNote,
      };
    }

    case "risks": {
      // The schema points risks pages at `callouts`, but `items` is the natural
      // word for a list and gets used anyway — so accept either shape.
      const fromCallouts = asCallouts(page.callouts);
      const items =
        fromCallouts.length > 0
          ? fromCallouts
          : asEntities(page.items).map((entity) => ({
              label: entity.name,
              text: [entity.stat, entity.comment].filter(Boolean).join(" "),
              icon: null,
            }));
      if (items.length === 0) return null;
      return {
        kind: "risks",
        title: title || "Risks & What to Watch",
        items,
        sourceNote,
      };
    }

    case "closing": {
      const statements = asStringArray(page.statements);
      if (statements.length === 0) return null;
      return {
        kind: "closing",
        title: title || "Where the Story Stands",
        statements,
        pullQuote: asString(page.pullQuote) || null,
        managementQuestion: asString(page.managementQuestion) || null,
        sourceNote,
      };
    }

    default:
      return null;
  }
}

/** Trims to the archive's column limits rather than letting the insert fail. */
function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The question for management appears once, on the last page that carries one.
 *
 * Instruction 34 asks for one question, and the schema offers it on two page
 * kinds because either is a reasonable home for it. Told it may go on either,
 * the model fairly often puts the same question on both — so the closing page
 * keeps it and an earlier Vitti View gives it up, which is the order a reader
 * would expect to meet it in anyway.
 */
function dedupeManagementQuestion(pages: ReportPage[]): ReportPage[] {
  const carriers = pages.filter(
    (page) =>
      (page.kind === "vitti-view" || page.kind === "closing") &&
      !!page.managementQuestion,
  );
  if (carriers.length < 2) return pages;

  const keep = carriers[carriers.length - 1];
  return pages.map((page) =>
    page !== keep &&
    (page.kind === "vitti-view" || page.kind === "closing") &&
    page.managementQuestion
      ? { ...page, managementQuestion: null }
      : page,
  );
}

/** What both calls need to see: the filings, the market data, the pick. */
type EvidenceInput = {
  moveDate: string;
  row: ScreenerRow;
  selection: MoverSelection;
  todayDocuments: AnnouncementDocument[];
  historyDocuments: AnnouncementDocument[];
  /** Session volume against the company's trailing average. Null if unavailable. */
  volumeProfile: VolumeProfile | null;
  /**
   * What kind of figure the move is — intraday, morning trade, or a close.
   *
   * Derived from when the board was read, not from the model's reading of a
   * bare percentage. Optional so a caller written before this existed still
   * compiles; absent, the market block says the window is unknown, which the
   * prompt treats as "do not claim one".
   */
  moveWindow?: MoveWindow | null;
  /**
   * Every filing the company has lodged in the fetched window, as date and
   * headline only.
   *
   * The corpus is 16 documents read in full; this is the *index* to all of them,
   * at a few hundred tokens. It exists because the two things a Daily Mover most
   * often needs are not in any single document: when something happened relative
   * to everything else, and whether a name at the top has changed. "Appointment
   * of Chief Financial Officer" in March followed by "Resignation of Chief
   * Financial Officer" in August is a finding that is invisible if you only read
   * the fifteen most substantive filings, and it costs almost nothing to see.
   */
  filingTimeline: { date: string; isPriceSensitive: boolean; headline: string }[];
  /**
   * What today's announcement pointed at, moved, and dated.
   *
   * Built by `planCorpus` before the history was chosen — see
   * `lib/drafts/research-signals.ts`. Optional because `regenerateDraft` re-runs
   * a stored draft without re-deriving them; absent, these blocks are omitted
   * rather than faked.
   */
  researchSignals?: ResearchSignals | null;
};

/**
 * The four signal blocks, rendered.
 *
 * Each one exists because a published draft got something wrong that the
 * evidence plainly contained, and in every case the fix is the same shape: put
 * the specific thing in front of the model as evidence, with its source named,
 * rather than adding another sentence of instruction and hoping.
 */
function formatResearchSignals(
  signals: ResearchSignals,
): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];

  const referenced = signals.references.filter((entry) => entry.matched);
  const unmatched = signals.references.filter((entry) => !entry.matched);

  if (referenced.length > 0 || unmatched.length > 0) {
    const lines: string[] = [];
    for (const entry of referenced) {
      const matched = entry.matched as NonNullable<typeof entry.matched>;
      lines.push(
        `- ${entry.label}${entry.statedDate ? ` (stated date ${entry.statedDate})` : ""} ` +
          `-> ${matched.date} "${matched.headline}"` +
          `${entry.read ? " [READ IN FULL, in the filings block above]" : " [NOT read in full — use the timeline]"}`,
      );
      lines.push(`    today's words: "${entry.phrase.slice(0, 260)}"`);
    }
    for (const entry of unmatched) {
      lines.push(
        `- ${entry.label}${entry.statedDate ? ` (stated date ${entry.statedDate})` : ""} ` +
          `-> NOT FOUND in the fetched filing history (${entry.because})`,
      );
    }

    blocks.push({
      type: "text",
      text:
        `DOCUMENTS TODAY'S ANNOUNCEMENT REFERS BACK TO\n\n` +
        `Today's release points at these earlier documents by name. The company has told you they ` +
        `are the terms it is operating under, so they outrank general history: where one is marked ` +
        `READ IN FULL, prefer it over any other source for the mechanics, the terms and the dates ` +
        `of the thing it describes. Where one is marked NOT FOUND, say plainly that the report ` +
        `could not verify those terms rather than inferring them.\n\n${lines.join("\n")}`,
    });
  }

  if (signals.chain.length > 0) {
    const lines = signals.chain.map(
      (step) =>
        `${step.date}  ${step.isOrigin ? "[START]" : "       "} ` +
        `${step.isPriceSensitive ? "*" : " "} ${step.headline}` +
        `${step.read ? "  [read in full]" : ""}`,
    );

    blocks.push({
      type: "text",
      text:
        `THE EVENT CHAIN LEADING TO TODAY (oldest first)\n\n` +
        `These earlier filings are steps in the same story as today's announcement. Today is the ` +
        `latest step, not the first.\n\n` +
        `Two things follow. First, the report must explain what this sequence was ABOUT before it ` +
        `explains how it ended — a note that opens on a resolution without saying what was being ` +
        `resolved is unreadable. Second, and this is the one that gets missed: anything already ` +
        `announced in this chain is NOT news today. If today's release confirms, approves or ` +
        `completes something proposed earlier, say exactly that — "proposed on <date>, now ` +
        `approved" — and never present the earlier proposal as though it broke today. What is new ` +
        `today is the change of STATUS, and that distinction is the report's job.\n\n${lines.join("\n")}`,
    });
  }

  if (signals.personnel.length > 0) {
    const lines = signals.personnel.map(
      (entry) => `- [${entry.source}] ${entry.sentence}`,
    );
    blocks.push({
      type: "text",
      text:
        `BOARD, MANAGEMENT AND MANDATE CHANGES DETECTED IN TODAY'S FILINGS\n\n` +
        `Sentences from today's announcements that describe someone arriving, leaving, or changing ` +
        `role — extracted mechanically, quoted verbatim, and NOT interpreted. Read them and work ` +
        `out what actually happened: who joins and when, who leaves and on what condition, who ` +
        `takes which chair, and whether an investment manager or responsible entity changed.\n\n` +
        `Be precise about tense and condition. "Appointed with immediate effect" and "expected to ` +
        `retire following completion" are different facts and the difference is the story — one has ` +
        `happened, the other is contingent on something that has not. Do not flatten them into ` +
        `"the board was restructured".\n\n` +
        `If these amount to a material change of control or mandate, they belong in the report ` +
        `whether or not they are what the headline is about. They usually are not.\n\n${lines.join("\n")}`,
    });
  }

  if (signals.keyDates.length > 0) {
    const lines = signals.keyDates.map(
      (entry) => `- ${entry.iso}  ("${entry.printed}")  ...${entry.clause}...`,
    );

    const collisionLines = signals.dateCollisions.map(
      (collision) =>
        `- ${collision.a.iso} and ${collision.b.iso} are ${collision.daysApart} days apart and are ` +
        `DIFFERENT dates. Do not merge them, and do not use one where the other belongs.`,
    );

    blocks.push({
      type: "text",
      text:
        `EVERY DATE STATED IN TODAY'S FILINGS\n\n` +
        `Extracted mechanically with the words around each one, so that a date is never read out of ` +
        `context.${
          collisionLines.length > 0
            ? `\n\nCLOSE PAIRS — CHECK THESE BEFORE WRITING ANY DEADLINE:\n${collisionLines.join("\n")}\n\n` +
              `Two dates a few days apart in one announcement are almost always two different ` +
              `deadlines — a closing date and a withdrawal date, a record date and a payment date. ` +
              `State each one for what it is, or state neither.`
            : ""
        }\n\n${lines.join("\n")}`,
    });
  }

  return blocks;
}

/**
 * The evidence blocks, built once and sent identically by every call in the
 * pipeline that needs them — and cached.
 *
 * **Why there is now a cache breakpoint, when there deliberately wasn't one.**
 *
 * The original reasoning was sound for the pipeline as it stood: a one-hour-TTL
 * cache write bills at 2x the input rate and a read at 0.1x, so it breaks even
 * on the third request against the same prefix — and the pipeline made exactly
 * one. A different company every day meant `cache_read_input_tokens` was 0 on
 * every measured run, and the breakpoint turned $0.71 of corpus into $1.42 for
 * nothing.
 *
 * The Accuracy Gate changed the arithmetic. The corpus is now read two or three
 * times within minutes — write, check, and a rewrite if the check finds
 * something — so the *five-minute* TTL applies, which the original note already
 * pointed at as the right tool if this ever happened. It writes at 1.25x and
 * reads at 0.1x, so for a corpus of C tokens:
 *
 *   before:  1.0C (write) + 1.0C (check) + 1.0C (rewrite)  = 3.00C
 *   now:     1.25C (write) + 0.1C (read) + 0.1C (read)     = 1.45C
 *
 * A little over half, and the saving grows with the rewrite rather than
 * shrinking. The five-minute clock is refreshed by every read, and the calls run
 * back to back, so the window only expires if a call fails and the pipeline is
 * retried much later — in which case the cost is a normal cache write, not an
 * error.
 *
 * The breakpoint sits on a trailing marker block rather than on the market data
 * or the last PDF, so that the boundary between "shared prefix" and
 * "per-call instruction" is a fixed thing in the code and cannot drift when a
 * document block is added or a day has no image-only PDFs to attach.
 *
 * Content order matters to the model as well as to the cache: evidence first,
 * then the market data that overrides it, then the instruction.
 */
function buildEvidenceContent(
  input: EvidenceInput,
): Anthropic.ContentBlockParam[] {
  const { row } = input;

  /**
   * Australian dollars are written "$", never "A$".
   *
   * This block used to print "A$1.2340", and house style (section 6) bans the
   * "A" prefix outright. The prompt is the model's most immediate example of how
   * the desk writes a number, so a prefix here reappears in the report — the
   * instruction not to use it competes with a live demonstration of using it.
   */
  /**
   * The window, spelled out.
   *
   * A bare "+17.81%" tells the model nothing about whether the session had
   * finished, and the first SBM draft duly wrote "Shares Closed Up ~17.8%" for
   * a figure read at midday with three hours of trading left — the wrong
   * window, and because the stock kept moving, the wrong number too.
   */
  const window = input.moveWindow;
  const windowLine = window
    ? window.isClose
      ? `the OFFICIAL CLOSE (board read at ${window.localTime} Sydney, after the close)`
      : `INTRADAY — the market was still OPEN at ${window.localTime} Sydney when this was read, so ` +
        `the day's final move may be larger or smaller than this. The desk's phrase for this ` +
        `window is "${window.label}". NEVER describe this figure as a close.`
    : "unknown — say nothing about the window rather than guessing it";

  const marketBlock = `MARKET DATA (${input.moveDate}, from the exchange feed — these are the authoritative figures for the move)
  ticker:      ${row.ticker}
  company:     ${row.companyName}
  sector:      ${row.sector ?? "unknown"}
  move:        ${row.changePct > 0 ? "+" : ""}${row.changePct.toFixed(2)}%
  window:      ${windowLine}
  last price:  ${row.last !== null ? `${row.last.toFixed(4)}` : "unknown"}
  turnover:    ${formatMoneyCompact(row.turnover)}
  market cap:  ${formatMoneyCompact(row.marketCap)}

WHY THE DESK PICKED THIS ONE
${input.selection.rationale}${
    formatVolumeProfile(input.volumeProfile)
      ? `\n\n${formatVolumeProfile(input.volumeProfile)}`
      : ""
  }`;

  /**
   * The filing index, newest first.
   *
   * Capped at 60 entries, which reaches back a year or more for a normal
   * company and keeps a serial filer from spending two thousand tokens on
   * buy-back notifications. `*` marks price-sensitive, so the model can see at a
   * glance which of these it has actually read in full.
   */
  const timelineBlock =
    input.filingTimeline.length > 0
      ? input.filingTimeline
          .slice(0, 60)
          .map(
            (entry) =>
              `${entry.date}  ${entry.isPriceSensitive ? "*" : " "}  ${entry.headline}`,
          )
          .join("\n")
      : "(no filing history available)";

  const todayBlock =
    input.todayDocuments.length > 0
      ? input.todayDocuments.map(formatDocumentForPrompt).join("\n\n\n")
      : "(no readable announcement for today — say so plainly in the report rather than speculating about the cause)";

  const historyBlock =
    input.historyDocuments.length > 0
      ? input.historyDocuments.map(formatDocumentForPrompt).join("\n\n\n")
      : "(no earlier announcements were readable)";

  return [
    {
      type: "text",
      text: `EVIDENCE — TODAY'S PRICE-SENSITIVE ANNOUNCEMENTS FOR ${row.ticker}\n\n${todayBlock}`,
    },
    {
      type: "text",
      text: `EVIDENCE — THIS COMPANY'S EARLIER FILINGS (${row.ticker}, most recent first; price-sensitive announcements plus its annual, half-year and quarterly reports — this is the source for the business description, the segment detail, the accounts and the history)\n\n${historyBlock}`,
    },
    ...(input.researchSignals
      ? formatResearchSignals(input.researchSignals)
      : []),
    {
      type: "text",
      text:
        `FILING TIMELINE FOR ${row.ticker} (every announcement lodged in the fetched window, newest first; ` +
        `"*" marks price-sensitive. This is the index — the documents above are the ones read in full. Use it ` +
        `for dates, for management changes, and for what came before today.)\n\n${timelineBlock}`,
    },
    { type: "text", text: marketBlock },
    ...input.todayDocuments
      .filter((doc) => doc.pdfBase64)
      .map(
        (doc): Anthropic.DocumentBlockParam => ({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: doc.pdfBase64 as string,
          },
          title: `[${doc.announcement.idsId}] ${doc.announcement.headline}`,
        }),
      ),
    {
      type: "text",
      text: "END OF EVIDENCE.",
      cache_control: { type: "ephemeral" },
    },
  ];
}

export async function writeReport(
  input: {
    moveDate: string;
    row: ScreenerRow;
    selection: MoverSelection;
    analystName: string;
    /** Today's filings — the reason for the move. Read in full. */
    todayDocuments: AnnouncementDocument[];
    /** The company's price-sensitive history — the context. */
    historyDocuments: AnnouncementDocument[];
    /** Session volume against the trailing average. Null when unavailable. */
    volumeProfile: VolumeProfile | null;
    /** Date-and-headline index of every filing fetched. See `EvidenceInput`. */
    filingTimeline: EvidenceInput["filingTimeline"];
    /** What kind of figure the move is — see `EvidenceInput.moveWindow`. */
    moveWindow?: MoveWindow | null;
    /** Reference follow-ups, event chain, personnel and dates. */
    researchSignals?: ResearchSignals | null;
    /**
     * A previous attempt that `validateReportDoc` refused, and why.
     *
     * Different in kind from `corrections`, which carries accuracy findings, so
     * it is a different field and a different instruction. An accuracy finding
     * says "this number is wrong" and invites a judgement; this says "the
     * document cannot be rendered at all", and the fix is to supply what is
     * absent. Conflating them would ask the model to reconsider prose when what
     * is missing is an empty array.
     *
     * Takes priority over `corrections` when both are set: there is no point
     * polishing figures on a document that cannot be published.
     */
    repair?: { doc: ReportDoc; problems: string[] };
    /**
     * The first draft and what the Accuracy Gate found in it.
     *
     * Present only on the rewrite. The draft itself is included, not just the
     * findings: a rewrite told only "these four numbers are wrong" starts from
     * a blank page and loses the pages that were right, and a second pass
     * over the same corpus does not reliably rediscover the same insight. With
     * the draft in front of it the call is an edit, which is what it should be.
     *
     * See `checkReport` and the revision step in `lib/drafts/generate.ts`.
     */
    corrections?: { doc: ReportDoc; findings: AccuracyFinding[] };
  },
  usage: TokenUsage,
): Promise<{ report: DraftedReport; usage: TokenUsage }> {
  const anthropic = getAnthropicClient();
  const { row } = input;

  const content = [
    ...buildEvidenceContent(input),
    {
      type: "text" as const,
      text: input.repair
        ? `The previous attempt at this report COULD NOT BE RENDERED. It is reproduced below, followed by ` +
          `exactly what was wrong with it.\n\n` +
          `THE PREVIOUS ATTEMPT\n\n${formatReportForReview(input.repair.doc)}\n\n\n` +
          `WHY IT WAS REFUSED\n\n` +
          input.repair.problems.map((problem) => `- ${problem}`).join("\n") +
          `\n\nPublish a corrected report with the publish_daily_mover_draft tool. Fix EVERY problem listed ` +
          `above: each names a field that is missing, empty, or below its minimum, and the document is ` +
          `refused until all of them are right. Keep everything that was already correct — this is a repair, ` +
          `not a fresh attempt — and do not drop content to make room. If a required field was left out ` +
          `because the evidence seemed thin, say plainly in it what the filings do not establish rather than ` +
          `omitting it again. The by-line analyst is ${input.analystName}.`
        : input.corrections?.findings.length
        ? `A first draft of this report was written and then checked against the evidence above. It is ` +
          `reproduced below, followed by what the check found.\n\n` +
          `THE FIRST DRAFT\n\n${formatReportForReview(input.corrections.doc)}\n\n\n` +
          `ACCURACY GATE FINDINGS\n\n${formatFindings(input.corrections.findings)}\n\n\n` +
          `Publish the corrected report with the publish_daily_mover_draft tool. Fix every finding and keep ` +
          `everything the check did not object to — this is an edit, not a fresh attempt, so pages that were ` +
          `right should come back substantially as they were. Where a figure cannot be confirmed anywhere in ` +
          `the evidence, remove the claim rather than softening it. The by-line analyst is ${input.analystName}.`
        : `Write today's Daily Mover report on ${row.ticker} using the publish_daily_mover_draft tool. ` +
          `The by-line analyst is ${input.analystName}.`,
    },
  ];

  try {
    /**
     * Streamed because the report needs a large `max_tokens` and the SDK
     * requires streaming at that size to avoid an HTTP timeout on a call that
     * legitimately runs for minutes.
     */
    const stream = anthropic.messages.stream({
      model: draftModel(),
      max_tokens: 32_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: DAILY_MOVER_SYSTEM,
      messages: [{ role: "user", content }],
      // Both tools, so the Accuracy Gate's call can read this call's cache. See
      // `DRAFT_TOOLS` and `buildEvidenceContent`.
      tools: DRAFT_TOOLS,
      tool_choice: { type: "tool", name: REPORT_TOOL.name },
    });

    const response = await stream.finalMessage();
    const nextUsage = addUsage(usage, response.usage);

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === REPORT_TOOL.name,
    );
    if (!toolUse) {
      throw new Error("Claude did not return a report draft.");
    }

    const raw = toolUse.input as Record<string, unknown>;
    const companyName = asString(raw.companyName) || row.companyName;

    /**
     * The pages, in the order they have to be applied: normalise the raw tool
     * output to typed blocks, drop the question that got written twice, then
     * cut what is left to the page budget. `fitReportPages` last, because it
     * measures against the limits the renderer lays out to — see
     * `src/lib/report/fit.ts`.
     */
    const pages = fitReportPages(
      dedupeManagementQuestion(
        (Array.isArray(raw.pages) ? raw.pages : [])
          .map((page, index) => {
            const normalised = normalisePage(page, companyName);
            if (!normalised) {
              /**
               * A dropped page used to be silent, which hid the one failure this
               * schema can produce: a page whose kind is right and whose body is
               * empty. Chart pages went missing this way for a week — the model
               * emitted them without a conclusion line and `normalisePage`
               * discarded them, so the reports simply had no charts and nothing
               * anywhere said why.
               */
              console.warn(
                `draft ${row.ticker}: dropped page ${index + 1} ` +
                  `(kind "${asString((page as Record<string, unknown>)?.kind) || "?"}") ` +
                  `— it had no renderable content`,
              );
            }
            return normalised;
          })
          .filter((page): page is ReportPage => page !== null),
      ),
      row.ticker,
    );

    const rawMovePct = Number(raw.movePct);
    /**
     * The exchange feed is the authority on the size and direction of the move,
     * not the model. It is asked for `movePct` so that the figure it writes into
     * the headline and the hero card comes from the same place as the archive
     * column — but if the two disagree, the feed wins, because a report whose
     * stored `move_pct` contradicts its own cover is exactly the failure the
     * signed-percentage design exists to prevent.
     */
    const movePct =
      Number.isFinite(rawMovePct) &&
      Math.sign(rawMovePct) === Math.sign(row.changePct) &&
      Math.abs(rawMovePct - row.changePct) < 1
        ? rawMovePct
        : Number(row.changePct.toFixed(2));

    const reportPrice = Number(raw.reportPrice);
    const catalystSlug = asString(raw.catalystSlug);

    return {
      report: {
        doc: {
          ticker: row.ticker,
          companyName,
          moveDate: input.moveDate,
          analystName: input.analystName,
          // The resolved figure, not the model's — see the note below. The
          // renderer colours the cover's hero card from it.
          movePct,
          /**
           * From the feed and the clock, for the same reason as `movePct`. The
           * snapshot's lead tile is built from these rather than from the
           * model's `kpis[0]`, so the sign, the price and the time cannot be
           * paraphrased away.
           */
          reportPrice: row.last,
          moveTime: input.moveWindow?.localTime ?? null,
          moveIsClose: input.moveWindow?.isClose ?? null,
          pages,
        },
        mover: {
          ticker: row.ticker,
          companyName,
          sector: asString(raw.sector) || row.sector,
          movePct,
          /**
           * The window comes from the clock, the same way `movePct` comes from
           * the feed: both are facts about when the board was read, and a model
           * that guesses either writes a report about a session that did not
           * happen. The model's own words are kept only where there is nothing
           * better to use.
           */
          moveType: input.moveWindow
            ? input.moveWindow.isClose
              ? "closing"
              : "intraday"
            : raw.moveType === "closing"
              ? "closing"
              : "intraday",
          moveWindowLabel:
            input.moveWindow && !input.moveWindow.isClose
              ? toTitleCase(input.moveWindow.label)
              : asString(raw.moveWindowLabel) || null,
          catalystSlug: isCatalystSlug(catalystSlug) ? catalystSlug : "other",
          reasonForMove: clamp(asString(raw.reasonForMove), 1000),
          mainTakeaway: clamp(asString(raw.mainTakeaway), 1000),
          reportPrice:
            Number.isFinite(reportPrice) && reportPrice > 0
              ? reportPrice
              : (row.last ?? null),
        },
        citedIdsIds: asStringArray(raw.citedIdsIds),
      },
      usage: nextUsage,
    };
  } catch (error) {
    throw new Error(describeAnthropicError(error));
  }
}

// ---------------------------------------------------------------------------
// Stage 3 — the Accuracy Gate
// ---------------------------------------------------------------------------

/**
 * The check that runs between "the report is written" and "an analyst sees it".
 *
 * Instruction 5 asks for every material figure to be verified against the
 * original documents before publication, and instruction 24 asks for a second
 * read for tense, currency, share-price wording and anything that claims more
 * than the evidence supports. Neither is something the writing call can do for
 * itself: it would be grading its own work in the same context that produced
 * it, and the failure being looked for — a number that felt right — is
 * invisible from inside that context.
 *
 * So this is a separate call with a different job. It is given the finished
 * report and the same evidence, and asked only to find what is wrong. It writes
 * nothing.
 *
 * ONE gate call, not two. The corpus is the expensive part of this pipeline
 * (~150k tokens of filings), and re-checking after a revision would pay for it
 * a third time to confirm a fix the writer was explicitly told to make. The
 * findings are stored on the draft instead, so a reviewer sees exactly what was
 * flagged and whether a rewrite was run — the audit trail rather than another
 * bill.
 */

/** The findings, as the rewrite prompt lists them back to the writer. */
function formatFindings(findings: AccuracyFinding[]): string {
  return findings
    .map((finding, index) => {
      const where = finding.page ? `page ${finding.page}` : "unplaced";
      return [
        `${index + 1}. [${finding.severity}] [${finding.category}] (${where})`,
        `   report says: ${finding.claim}`,
        `   problem:     ${finding.problem}`,
        `   fix:         ${finding.fix}`,
      ].join("\n");
    })
    .join("\n\n");
}

function kpiLine(kpi: ReportKpi): string {
  return `[KPI] ${kpi.value} — ${kpi.label}${kpi.note ? ` (${kpi.note})` : ""}`;
}

function calloutLines(callouts?: ReportCallout[]): string[] {
  return (callouts ?? []).map((callout) => `${callout.label}: ${callout.text}`);
}

/** The drafted report as numbered plain text, for the checker to read. */
function formatReportForReview(doc: ReportDoc): string {
  return doc.pages
    .map((page, index) => {
      const head = `--- PAGE ${index + 1} (${page.kind}) ---`;
      const body: string[] = [];

      switch (page.kind) {
        case "snapshot":
          body.push(page.companyName, page.headline);
          body.push(...page.kpis.map(kpiLine));
          body.push(
            "WHY IT MOVED:",
            ...page.whyItMoved.map((item, index) => `  ${index + 1}. ${item}`),
          );
          body.push(
            "WHAT CHANGES NOW:",
            ...page.whatChangesNow.map((item, index) => `  ${index + 1}. ${item}`),
          );
          body.push(
            "HOW WE GOT HERE:",
            ...page.timeline.map((event) => `  ${event.date} — ${event.text}`),
          );
          body.push(
            "KEY RISKS REMAINING:",
            ...page.risks.map((risk) => `  ${risk.label}: ${risk.text}`),
          );
          if (page.pullQuote) body.push(`CLOSING LINE: ${page.pullQuote}`);
          break;

        case "cover":
          body.push(page.companyName, page.headline);
          body.push(...page.kpis.map(kpiLine));
          if (page.intro) body.push(page.intro);
          break;
        case "narrative":
          body.push(page.title);
          if (page.intro) body.push(page.intro);
          body.push(...page.paragraphs);
          body.push(...calloutLines(page.callouts));
          break;
        case "kpis":
          body.push(page.title);
          if (page.intro) body.push(page.intro);
          body.push(...page.kpis.map(kpiLine));
          body.push(...(page.notes ?? []));
          body.push(...calloutLines(page.callouts));
          if (page.conclusion) body.push(`conclusion: ${page.conclusion}`);
          break;
        case "entities":
          body.push(page.title);
          if (page.intro) body.push(page.intro);
          body.push(
            ...page.items.map(
              (item) =>
                `${item.name}: ${item.stat}${item.comment ? ` — ${item.comment}` : ""}`,
            ),
          );
          break;
        case "chart":
          body.push(page.title);
          if (page.intro) body.push(page.intro);
          body.push(
            `chart (${page.chart.type}${page.chart.unit ? `, ${page.chart.unit}` : ""}): ` +
              page.chart.points
                .map(
                  (point) =>
                    `${point.label}=${point.display?.trim() || point.value}` +
                    (point.isTotal ? " (total)" : ""),
                )
                .join(", "),
          );
          body.push(`conclusion: ${page.conclusion}`);
          body.push(...calloutLines(page.callouts));
          break;
        case "market-vs-reality":
          body.push(page.title);
          body.push(`headline: ${page.headline}`);
          body.push(`market focus: ${page.marketFocus}`);
          body.push(`what really matters: ${page.whatMatters}`);
          break;
        case "comparison":
          body.push(page.title);
          if (page.intro) body.push(page.intro);
          body.push(`columns: ${page.columns.join(" | ")} | Change`);
          body.push(
            ...page.rows.map(
              (row) =>
                `${row.metric} | ${row.before} | ${row.now} | ${row.change}`,
            ),
          );
          if (page.conclusion) body.push(`conclusion: ${page.conclusion}`);
          break;
        case "timeline":
          body.push(page.title);
          if (page.intro) body.push(page.intro);
          body.push(
            ...page.events.map((event) => `${event.date}: ${event.text}`),
          );
          if (page.conclusion) body.push(`conclusion: ${page.conclusion}`);
          break;
        case "management":
          body.push(page.title);
          if (page.intro) body.push(page.intro);
          body.push(
            ...page.people.map(
              (person) =>
                `${person.name} — ${person.role}` +
                [person.tenure, person.holding, person.note]
                  .filter(Boolean)
                  .map((part) => ` | ${part}`)
                  .join(""),
            ),
          );
          body.push(...(page.changes ?? []).map((change) => `change: ${change}`));
          break;
        case "risks":
          body.push(page.title);
          body.push(...page.items.map((item) => `${item.label}: ${item.text}`));
          break;
        case "vitti-view":
          body.push(page.title);
          body.push(
            ...page.ratings.map(
              (rating) =>
                `${rating.label}: ${rating.value}${rating.note ? ` (${rating.note})` : ""}`,
            ),
          );
          body.push(`key debate: ${page.keyDebate}`);
          body.push(`next catalyst: ${page.nextCatalyst}`);
          if (page.managementQuestion) {
            body.push(`question for management: ${page.managementQuestion}`);
          }
          break;
        case "outlook": {
          body.push(page.title);
          if (page.intro) body.push(page.intro);
          const [improves, worsens] = page.columns ?? ["improves", "worsens"];
          body.push(...page.improve.map((item) => `${improves}: ${item}`));
          body.push(...page.worsen.map((item) => `${worsens}: ${item}`));
          if (page.conclusion) body.push(`conclusion: ${page.conclusion}`);
          break;
        }
        case "closing":
          body.push(page.title);
          body.push(...page.statements);
          if (page.pullQuote) body.push(`pull quote: ${page.pullQuote}`);
          if (page.managementQuestion) {
            body.push(`question for management: ${page.managementQuestion}`);
          }
          break;
      }

      if (page.sourceNote) body.push(`source line: ${page.sourceNote}`);

      return `${head}\n${body.filter(Boolean).join("\n")}`;
    })
    .join("\n\n");
}

const ACCURACY_TOOL: Anthropic.Tool = {
  name: "report_accuracy_gate",
  description:
    "Records the result of checking a drafted Daily Mover report against the announcements it was written from.",
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["pass", "revise"],
        description:
          "'revise' if there is at least one blocking finding. 'pass' if the report is publishable as written, " +
          "even where you have logged advisory findings.",
      },
      summary: {
        type: "string",
        description:
          "One or two sentences for the reviewing analyst: what you checked and what you concluded. " +
          "Max 600 characters.",
      },
      findings: {
        type: "array",
        maxItems: 20,
        description:
          "Everything wrong with the report, most serious first. An empty list means you verified it and found " +
          "nothing — say so in the summary.",
        items: {
          type: "object",
          properties: {
            severity: {
              type: "string",
              enum: ["blocking", "advisory"],
              description:
                "'blocking' for anything that makes the report wrong or misleading: a figure that is not in the " +
                "evidence or contradicts it, a total summed from the filings and presented as the company's own, " +
                "a source line naming a filing that does not carry the page's figures, a conditional payment " +
                "written as unconditional or as already received, proceeds written as cash in hand rather than " +
                "expected on completion, a pro-forma position written in the present tense, an intraday move " +
                "described as a close, a headline contract value presented as guaranteed revenue, " +
                "acquisition-driven growth called organic, a future outcome stated as certain, or a claim that " +
                "goes further than the filing supports. 'advisory' for everything that does not make it wrong: " +
                "a missing figure the filings would have given, a market reading written as a fact, a repeated " +
                "point, an over-long page, 'A$' instead of '$', a banned filler phrase, past tense for something " +
                "still true, a chart whose conclusion only restates its own numbers, an undisclosed calculation.",
            },
            page: {
              type: "integer",
              description:
                "1-based page number from the report text. Always give it — a finding a reviewer cannot locate " +
                "costs them the time the check was meant to save. Use the page the wording appears on, and where " +
                "the same fault repeats, log the worst page and say in `problem` where else it appears.",
            },
            category: {
              type: "string",
              enum: [
                "figure",
                "sourcing",
                "conditionality",
                "cash-timing",
                "status-timing",
                "unsupported-claim",
                "attribution",
                "missing-number",
                "share-price-wording",
                "future-certainty",
                "contract-terms",
                "organic-vs-acquired",
                "repetition",
                "length",
                "currency",
                "tense",
                "style",
                "structure",
                "compliance",
              ],
              description:
                "Which rule the finding is about. 'figure' a number that is wrong or untraceable; 'sourcing' a " +
                "missing or wrong source line; 'conditionality' approvals and conditions treated as satisfied; " +
                "'cash-timing' money made to sound received or unencumbered; 'status-timing' the pro-forma " +
                "company written as the current one, or a project written as producing; 'attribution' our reading " +
                "written as a filing's fact, or a calculation not owned; 'missing-number' an economics figure the " +
                "filings give and the page omits; 'repetition' the same point on more than one page.",
            },
            claim: {
              type: "string",
              description:
                "The exact words from the report that are at fault. Quote them.",
            },
            problem: {
              type: "string",
              description:
                "Why it is wrong, referring to the evidence: 'the Appendix 4E reports EBITDA of $41.2 million, " +
                "not $44.1 million', 'the announcement says the $500 million is a maximum over five years and is " +
                "not committed', or 'completion is subject to PNG regulatory approval, so the $410 million is " +
                "expected on completion rather than received'.",
            },
            fix: {
              type: "string",
              description:
                "What the report should say instead, in the words it should use. If the figure cannot be " +
                "confirmed anywhere in the evidence, the fix is to remove the claim.",
            },
          },
          required: ["severity", "page", "category", "claim", "problem", "fix"],
        },
      },
    },
    required: ["verdict", "summary", "findings"],
  },
};

/**
 * Both tools on both calls, with `tool_choice` deciding which one is used.
 *
 * Tools sit ahead of the system prompt in the cache prefix, so a call offering
 * one tool cannot read a cache entry written by a call that offered the other —
 * the ~150k tokens of filings behind it would be re-billed in full. Offering
 * both and forcing the choice costs a few hundred tokens of schema and buys the
 * cache hit on all of it.
 */
const DRAFT_TOOLS: Anthropic.Tool[] = [REPORT_TOOL, ACCURACY_TOOL];

/**
 * Runs the Accuracy Gate over a drafted report.
 *
 * Not streamed: the output is a findings list of a few thousand tokens at most,
 * well inside the SDK's non-streaming ceiling, even though the input carries
 * the whole corpus.
 */
export async function checkReport(
  input: {
    moveDate: string;
    row: ScreenerRow;
    /** The pick's rationale, so this call's prefix matches the writer's. */
    selection: MoverSelection;
    doc: ReportDoc;
    todayDocuments: AnnouncementDocument[];
    historyDocuments: AnnouncementDocument[];
    volumeProfile: VolumeProfile | null;
    filingTimeline: EvidenceInput["filingTimeline"];
    /** What kind of figure the move is — see `EvidenceInput.moveWindow`. */
    moveWindow?: MoveWindow | null;
    /** Reference follow-ups, event chain, personnel and dates. */
    researchSignals?: ResearchSignals | null;
  },
  usage: TokenUsage,
): Promise<{ review: AccuracyReview; usage: TokenUsage }> {
  const anthropic = getAnthropicClient();

  const content = [
    ...buildEvidenceContent(input),
    {
      type: "text" as const,
      text:
        `A colleague has drafted the Daily Mover report below from the evidence above. Check it and record ` +
        `the result with the report_accuracy_gate tool.\n\n` +
        `THE DRAFTED REPORT\n\n${formatReportForReview(input.doc)}`,
    },
  ];

  try {
    const response = await anthropic.messages.create({
      model: draftModel(),
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: DAILY_MOVER_SYSTEM,
      messages: [{ role: "user", content }],
      // Identical tools, system and evidence blocks to `writeReport`, so the
      // corpus behind them is a cache read rather than a second full charge.
      tools: DRAFT_TOOLS,
      tool_choice: { type: "tool", name: ACCURACY_TOOL.name },
    });

    const nextUsage = addUsage(usage, response.usage);

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === ACCURACY_TOOL.name,
    );
    if (!toolUse) {
      throw new Error("Claude did not return an accuracy review.");
    }

    const raw = toolUse.input as Record<string, unknown>;

    const findings: AccuracyFinding[] = [];
    for (const item of Array.isArray(raw.findings) ? raw.findings : []) {
      const entry = item as Record<string, unknown>;
      const claim = asString(entry?.claim);
      const problem = asString(entry?.problem);
      if (!claim || !problem) continue;

      const page = Number(entry?.page);
      findings.push({
        severity: entry?.severity === "advisory" ? "advisory" : "blocking",
        page:
          Number.isInteger(page) && page >= 1 && page <= input.doc.pages.length
            ? page
            : null,
        category: asString(entry?.category) || "figure",
        claim,
        problem,
        fix: asString(entry?.fix),
      });
    }

    /**
     * The verdict is derived from the findings, not taken from the tool call.
     *
     * A model that has just written three blocking findings will still sometimes
     * return "pass" — the two fields are produced independently, and a summary
     * pulls toward a tidy answer. The findings are the evidence of what it
     * actually concluded, so they decide.
     */
    const verdict = findings.some((finding) => finding.severity === "blocking")
      ? "revise"
      : "pass";

    return {
      review: {
        verdict,
        summary: clamp(asString(raw.summary), 600),
        findings,
      },
      usage: nextUsage,
    };
  } catch (error) {
    throw new Error(describeAnthropicError(error));
  }
}
