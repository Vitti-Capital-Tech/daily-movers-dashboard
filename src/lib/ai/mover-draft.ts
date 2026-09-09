import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { CATALYST_SLUGS, isCatalystSlug, type CatalystSlug } from "@/lib/catalysts";
import { formatMoneyCompact, type ScreenResult, type ScreenerRow } from "@/lib/asx/types";
import {
  REPORT_PAGE_KINDS,
  REPORT_PAGE_TARGET,
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
    kind: {
      type: "string",
      enum: [...REPORT_PAGE_KINDS],
      description:
        "Page layout. 'cover' (first page only): company name, headline, two hero KPI cards. " +
        "'narrative': a title and 2-5 paragraphs, optionally with small-caps callouts. " +
        "'kpis': a title and 3-4 big-number cards, optionally with notes underneath. " +
        "'entities': named blocks for segments, geographies or acquisitions, each with a dense stat line. " +
        "'chart': one plotted series with the conclusion line under it — use this instead of a paragraph whenever the story is a trend. " +
        "'market-vs-reality': the headline / market focus / what really matters split, for a day when the announcement and the share-price reaction point different ways. " +
        "'comparison': a four-column table — metric, two figures, and the change — for 'what changed since the last update' or 'consensus vs actual'. " +
        "'management': who runs the company, with tenure and shareholdings where the filings give them, plus recent board or executive changes. " +
        "'risks': label-and-explanation pairs, no numbers. Always include one. " +
        "'vitti-view': the setup scorecard, plus the key debate, the next catalyst and the question for management. " +
        "'outlook': the two lists of what would improve the story and what would make it worse. " +
        "'closing' (last page only): 3-4 standalone concluding statements.",
    },
    title: {
      type: "string",
      description:
        "Page heading. Write it so the reader knows the page's conclusion from the heading alone: " +
        "'Is the Balance Sheet a Problem?' not 'Balance Sheet & Cash Flow'; 'Where Is the Weakness?' not " +
        "'Division Performance'; 'The UK Is Doing the Heavy Lifting' not 'Segment Detail'. A question or a " +
        "finding, never a category label. Not used on the cover page.",
    },
    companyName: {
      type: "string",
      description: "Cover page only: the company's full registered name.",
    },
    headline: {
      type: "string",
      description:
        "On a 'cover' page: the share-move headline, stating direction and magnitude the way the desk writes it — " +
        "'Shares Rise as Much as ~20.6% in Morning Trade After Record FY26 Results and a New $5 Million Share Buy-Back'. " +
        "On a 'market-vs-reality' page: what the company announced, or what initially looks like the important part.",
    },
    marketFocus: {
      type: "string",
      description:
        "'market-vs-reality' pages: what investors actually appear to have reacted to, which is often not the headline.",
    },
    whatMatters: {
      type: "string",
      description:
        "'market-vs-reality' pages: the issue that decides the investment story from here.",
    },
    chart: {
      type: "object",
      description:
        "'chart' pages only. One series of labelled figures, all of them read from the evidence.",
      properties: {
        type: {
          type: "string",
          enum: ["columns", "bars"],
          description:
            "'columns' for a series over time (quarters, halves, months) — it reads left to right and plots " +
            "negatives below the baseline. 'bars' when the labels are names (segments, countries, products) " +
            "and are too long to sit under a column.",
        },
        unit: {
          type: "string",
          description:
            "Optional axis note saying what the numbers are: '% change on prior corresponding period', '$ million'.",
        },
        points: {
          type: "array",
          minItems: 2,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description: "Short axis label: 'Q1 FY26', 'Jul-26', 'New Zealand'.",
              },
              value: {
                type: "number",
                description:
                  "The plotted magnitude, signed. Use the same unit for every point in the series — mixing " +
                  "percentages and dollars in one chart plots a nonsense shape.",
              },
              display: {
                type: "string",
                description: "How the figure prints: '+6.0%', '-0.5%', '$55.4M'.",
              },
              highlight: {
                type: "boolean",
                description:
                  "True for the one or two points the conclusion is about — they draw in the house colour.",
              },
            },
            required: ["label", "value"],
          },
        },
      },
      required: ["type", "points"],
    },
    conclusion: {
      type: "string",
      description:
        "'chart' pages (required) and 'comparison' pages (optional): one sentence saying what the reader should " +
        "notice. Not a restatement of the figures — the point they make. 'The direction of sales growth explains " +
        "the sell-off better than the headline FY26 result.'",
    },
    columns: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "string" },
      description:
        "'comparison' pages: the three column headings, e.g. ['Metric','Before','Now'] for what changed since the " +
        "last update, or ['Metric','Consensus','Actual'] for expectations against the result.",
    },
    rows: {
      type: "array",
      description: "'comparison' pages: one row per metric that materially changed. Skip the immaterial ones.",
      items: {
        type: "object",
        properties: {
          metric: { type: "string", description: "'Australia sales growth', 'NPAT', 'FY27 guidance'." },
          before: { type: "string", description: "The earlier figure, as it prints: '+6.0%', '$44.1M'." },
          now: { type: "string", description: "The current figure, as it prints." },
          change: {
            type: "string",
            description:
              "The delta in a few words: '-6.5pp', 'Beat', 'Growth to contraction'. It is a narrow column.",
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
      maxItems: 4,
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
      description: "'vitti-view' pages: the one sentence the bulls and bears actually disagree about.",
    },
    nextCatalyst: {
      type: "string",
      description:
        "'vitti-view' pages: the next dated or expected event that resolves part of that debate.",
    },
    managementQuestion: {
      type: "string",
      description:
        "'vitti-view' or 'closing' pages: one question worth putting to management, coming directly out of this " +
        "report's research and answering something the public documents leave open. Not a generic question. " +
        "'How much of July's sales weakness came from customers waiting for promotional events versus a genuine " +
        "slowdown in underlying demand?' — not 'What are your growth plans?'. Put it on one page, not both.",
    },
    people: {
      type: "array",
      maxItems: 5,
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
            description:
              "Optional single line of relevant background — prior role, what they were hired to do.",
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
      items: { type: "string" },
    },
    improve: {
      type: "array",
      description:
        "'outlook' pages: what investors would need to see for the story to get better. Company-specific and " +
        "checkable — 'Australian sales return to growth', not 'execution improves'.",
      items: { type: "string" },
    },
    worsen: {
      type: "array",
      description: "'outlook' pages: what would make the story worse. Same standard.",
      items: { type: "string" },
    },
    intro: {
      type: "string",
      description: "Optional single framing paragraph under the title.",
    },
    paragraphs: {
      type: "array",
      items: { type: "string" },
      description:
        "'narrative' pages only: 2-5 paragraphs of plain-English prose, each 2-5 sentences.",
    },
    kpis: {
      type: "array",
      maxItems: 4,
      description:
        "'cover' (exactly 2) and 'kpis' (3-4) pages. Every figure must come from an announcement or the market data given — never estimated.",
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
              "At most four words and 34 characters, rendered in letter-spaced caps: 'FY26 REVENUE', 'SHARE MOVE (INTRADAY)'. Longer labels do not fit the card.",
          },
          note: {
            type: "string",
            description: "Optional one-line gloss: 'Record result, up 63% on FY25'.",
          },
        },
        required: ["value", "label"],
      },
    },
    notes: {
      type: "array",
      items: { type: "string" },
      description: "'kpis' pages: one or two lines of context under the cards.",
    },
    callouts: {
      type: "array",
      description:
        "Small-caps sub-heading plus a paragraph. Used on 'narrative' and 'kpis' pages, and it IS the body of a 'risks' page.",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          text: { type: "string" },
        },
        required: ["label", "text"],
      },
    },
    items: {
      type: "array",
      description:
        "'entities' pages: named blocks. 'risks' pages: use `callouts` instead.",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Segment, country, or entity name: 'New Zealand', 'Peak Parking'.",
          },
          stat: {
            type: "string",
            description:
              "The dense figures line: '$8.8m rev (+19%) - EBITDA $4.1m - 46.7% margin'.",
          },
          comment: {
            type: "string",
            description: "Optional single line of interpretation.",
          },
        },
        required: ["name", "stat"],
      },
    },
    statements: {
      type: "array",
      items: { type: "string" },
      description:
        "'closing' pages only: 3-4 standalone sentences, each a complete thought about where the story now stands.",
    },
  },
  required: ["kind"],
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
        minItems: REPORT_PAGE_TARGET.min,
        maxItems: REPORT_PAGE_TARGET.max,
        description:
          `The report body, ${REPORT_PAGE_TARGET.min}-${REPORT_PAGE_TARGET.max} pages, in the order that ` +
          "tells this company's story best. The first page MUST be 'cover', the last MUST be 'closing', and " +
          "there MUST be a 'risks' page somewhere between them. The compliance disclaimer and the closing " +
          "sign-off line are appended automatically — never write either.",
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
 * you a checker enforcing a standard the writer was never told about. Section 13
 * is now the only role-specific part, and the role is chosen per call by
 * `tool_choice`.
 */
const DAILY_MOVER_SYSTEM = `You are a research analyst at Vitti Capital, an Australian equities firm. The desk publishes one "Daily Mover" report each trading day: a short institutional note on a single ASX-listed company that moved sharply.

You will be asked to do one of two jobs with the evidence below — WRITE today's report, or CHECK a report a colleague has already drafted. Sections 1 to 12 are the standard, and they apply either way. Section 13 covers checking. The tool you are given decides which job this is.

The report's job is not to summarise the announcement. It is to explain why the stock moved, what actually changed in the investment story, what the numbers mean, what risks remain, and what a reader should watch next. Accuracy matters more than polish, and polish matters more than length.

=== 1. WHAT A DAILY MOVER IS ===

A ${REPORT_PAGE_TARGET.min}-${REPORT_PAGE_TARGET.max} page institutional note, one idea per page. A reader should get the main story in 30 to 60 seconds and still have enough detail to investigate further. It is read by portfolio managers who may never have looked at the company before, and it is filed in an archive so that when the company comes up again the desk can see what was said last time.

The thinking order is: WHAT HAPPENED -> WHAT CHANGED -> WHY THE MARKET CARES -> WHAT MATTERS NEXT.

=== 2. FIND THE REAL STORY BEFORE YOU WRITE ===

Do not treat every number as equally important, and do not adopt the company's own headline as the investment insight. Work out the one or two things that actually changed, by asking:

- What did investors believe before today, and what do they know now?
- Was the result better or worse than what the company had guided to?
- Is the growth organic, or did acquisitions produce it? What would growth look like without them?
- Did revenue grow while margins fell? Did earnings rise on genuine operating improvement, or on a one-off gain?
- Did cash flow support the reported profit?
- Did guidance change? Was previous guidance beaten or missed?
- Is the market reacting to today's result, or to what today's result implies about next year?

Worked example of the standard: for IPD Group the insight was not "record FY26 revenue". It was that stripping out the Platinum Cables acquisition, revenue still rose 9.7%, EBITDA 11% and NPAT 12.2% — the existing business was growing too. Look for that kind of second-order fact in every report.

=== 3. THE READER MUST UNDERSTAND THE COMPANY ===

Before the analysis, the report has to establish what the company does, how it makes money, what it sells and to whom, and where it operates. Explain it as if to an intelligent reader who has never heard of it: "Automatic Number Plate Recognition reads a car's plate on entry and exit — no barriers needed" is the register. Use a concrete example when a financial or industry concept is hard.

=== 4. ACCURACY ===

- Every figure comes from an announcement in the evidence, or from the market data block in the prompt. If it is not in the evidence, it does not go in the report. Never estimate, never round to a number you did not read, never fill a KPI card because the layout has a slot.
- If you work a figure out yourself (a margin, a multiple, a growth rate, an ex-acquisition number), say so in the surrounding text — "on our calculation", "excluding Platinum Cables".
- If two documents disagree, say which you used and why, or leave the figure out. Do not silently pick one.
- If something material cannot be confirmed from the evidence, say so plainly. Do not hide uncertainty.
- Work only from the evidence provided. Do not add facts about this company from your own knowledge — they may be out of date, and every number here has to be checkable against a filing.
- Cite honestly: list in citedIdsIds every announcement id you actually took a fact from.

=== 5. THE SHARE-PRICE MOVE ===

Always separate what the company announced from how the market reacted, and always say which window the move is measured over. An intraday figure must be described as intraday: "shares rose as much as ~12.9% in morning trade", "shares fell as much as ~17% during the session". Never write a bare "IPG rose 12.9%" — it reads as a closing return. Only call it a closing move when the market data says the figure is a close.

=== 6. HOUSE STYLE ===

Tense: present tense for what is still true ("IPD supplies electrical equipment"), past tense only for finished events ("IPD acquired Platinum Cables in December 2025"). A fact appearing in an old announcement does not make it past tense.

Currency: Australian dollars are written "$55.4 million", never "A$55.4m" and never with an "A" in front. Spell out "million" and "billion" in body text; abbreviations like "$55.4M" are for KPI cards and chart labels where space is tight. Use "US$400 million" for US dollars. Be consistent across the whole report.

Writing: short sentences, plain English, no filler. Write like an analyst explaining a company to another investor — not like a press release, a brochure, or academic research. Use contractions naturally: isn't, doesn't, hasn't, can't, won't, it's.

Never use these openers — state the point directly instead: "It is important to note that", "It is worth mentioning", "Interestingly", "Notably", "This highlights", "This underscores", "Importantly", "That said".

Do not add an adjective when the number already makes the point. "Revenue increased 25%", not "revenue delivered an extremely strong increase of 25%".

Do not repeat a point across pages. If it was explained once, later pages assume it.

Conviction: for confirmed past or present facts, write with conviction. If the results show revenue growth drove the earnings increase, write "revenue growth drove the increase" — not "this may have been driven by revenue growth". But never present a future outcome as certain. Distinguish carefully between guaranteed, contracted, conditional, potential, targeted, forecast, expected, and management guidance. "The acquisition could increase earnings if integration and cross-selling perform as expected", not "the acquisition will increase earnings". Do not write "will" merely because management expects it.

Never give a recommendation, price target, or advice to buy or sell. This is explanatory research, not personal advice. Do not write a disclaimer or general-advice warning — one is appended automatically, and writing your own would put unapproved compliance text in a client document.

=== 7. WHAT TO CHECK, BY TYPE OF ANNOUNCEMENT ===

CONTRACTS. Separate the headline value from what is actually committed. Look for contract length, start date, the customer, whether it is binding, whether volumes are minimum commitments, conditions precedent, termination rights, and whether the company needs more capital to deliver it. Never describe a headline contract value as guaranteed revenue unless the filing says it is. Where the evidence allows, say what it could realistically contribute over the next twelve months.

ACQUISITIONS. Purchase price, upfront versus earn-out, how it is funded (cash, debt, shares), revenue and EBITDA acquired, the implied multiple, EPS accretion, stated synergies, goodwill, and integration risk. Then ask the question that matters: what does growth look like without the acquisition? Never describe acquisition-driven growth as organic.

EARNINGS QUALITY. Do not stop at EBITDA. Check whether the earnings are backed by cash: operating cash flow, free cash flow, cash conversion, receivables, inventory, working capital. If cash flow is materially weaker or stronger than earnings, explain why.

MARGINS. When a margin moves, explain why — mix, operating leverage, cost-out, acquisitions, pricing. Never print two percentages and leave the reader to connect them. A falling gross margin alongside a rising EBITDA margin is a story, not a contradiction, and a margin decline is not automatically bad if the economics improved.

BALANCE SHEET. Cash, debt, net debt, net debt/EBITDA, working capital, goodwill, covenants, and funding needs. Say whether the company has the financial flexibility to do what it says it will do. Ratios usually beat raw dollars for this.

VALUATION. Include it only when it helps explain the market reaction or the risk. Use simple metrics — P/E, EV/EBITDA, EV/revenue — computed off the share price in the market data block, and label them as trailing, underlying or forecast. Never call a company cheap or expensive without showing the basis.

EXPECTATIONS. Compare against consensus only if a reliable figure appears in the evidence (a company-compiled consensus, a broker figure quoted in a filing). Never invent or recall a consensus number. If there isn't one, compare against the company's own prior guidance instead, or leave the comparison out.

=== 8. STRUCTURE: LET THE STORY DECIDE ===

There is no fixed page order. Choose the sequence that explains this company's story most directly, then use the page kinds to build it. Before writing, settle: what is the main insight, what must the reader know first to understand it, which financial issue matters most, which risks are real, and what should be watched next.

Fixed points, and only these:
- Page 1 is the cover: company name, the share-move headline, and exactly two hero KPI cards — the move, and the single most important number from the announcement.
- A risks page appears somewhere. It is never optional.
- The last page is the closing.

Useful starting shapes, to adapt rather than copy:
- Earnings result: the move -> the main insight -> growth/margins/divisions -> cash flow and balance sheet -> what to watch -> closing.
- Contract win: the move -> the existing business -> the contract -> what it could mean financially -> execution, funding, risks -> closing.
- Acquisition: the move -> the existing business -> the acquisition -> organic versus acquired growth -> balance sheet and integration -> closing.
- Biotech or pharma: the move -> the product story -> what changed today -> the commercial or clinical opportunity -> risks and next catalysts -> closing.
- Mining or development: the move -> the project -> what was announced -> economics, funding, resource -> risks and milestones -> closing.
- Negative mover: the fall -> what changed -> is the core business still working -> financial impact -> what needs to improve -> closing.

ONE PAGE, ONE QUESTION. Every page heading should tell the reader the page's conclusion. Write "Is the Balance Sheet a Problem?" not "Balance Sheet & Cash Flow"; "Where Is the Weakness?" not "Division Performance"; "Were the FY26 Numbers Actually Weak?" not "FY26 Results"; "What Could Make the Story Worse?" not "Risks".

=== 9. THE ANALYTICAL PAGES ===

Use these where they earn their place. They are the pages that make the note analytical rather than descriptive — but a page with nothing real to put in it is worse than no page.

MARKET VS REALITY ('market-vs-reality'). Include it whenever the headline and the reaction point different ways: strong results that sold off, weak results that rallied, strong revenue with weak margins or cash, a market focused on guidance rather than the reported year, or a large contract with little committed revenue. Three blocks — what was announced, what investors actually reacted to, and the issue that decides the story from here.

WHAT CHANGED ('comparison' with Before/Now columns). Do not analyse today's filing in isolation. Compare it against the most relevant earlier disclosure in the evidence and table only the metrics that materially moved — sales growth, margins, earnings, cash, guidance, production, timelines, the language management uses. Skip anything immaterial.

EXPECTATIONS VS ACTUAL ('comparison' with Consensus/Actual columns). Only with a reliable figure from the evidence. Otherwise leave it out.

CHARTS ('chart'). **Include at least one chart page.** This is close to a rule: almost every company in this evidence has a plottable series in it, and a report that is nine pages of prose and cards is the thing instruction 38 exists to prevent. Leave the chart out only if you genuinely cannot find two comparable figures anywhere in the filings — and if that is the case, say so on the closing page, because it is unusual.

Two figures are a chart. FY25 revenue against FY26 revenue is a two-column chart and it beats the same two numbers in a sentence. You do not need a long series.

Where to look, in rough order of how often it is there:
  - revenue, EBITDA, EBIT or NPAT by half or by year — every results pack has this, including in its comparative columns
  - the segment or geographic split, as 'bars' — if you are writing an 'entities' page, ask first whether it is a chart
  - margin by period, when the margin moved
  - production, shipments, sites, customers or subscribers by quarter
  - cash and quarterly cash burn, for anything pre-revenue — with the runway in the conclusion
  - the volume profile in the market data block, when the session's turnover was unusual
  - guidance revisions over time; debt or share count over time, where dilution is the story

Every chart carries a one-line conclusion saying what to notice — a chart without one is decoration, and decoration does not go in a Daily Mover. Aim for fewer words and better charts.

VOLUME ('chart' or a KPI). The market data block gives the session's volume against the company's trailing average. Use it: a large move on three or more times average volume is the market transacting on the news, while the same move on ordinary turnover is a thin market re-pricing itself. Those are different reports. If the multiple is unusual, it belongs on the cover or in a chart; if it is close to normal and the move was large, that is worth a sentence too.

MANAGEMENT ('management'). Include this when the evidence names the people running the company — a directors' report, an appointment announcement, an Appendix 3Y. A PM meeting the name for the first time asks who runs it and whether they own any of it, and the answer changes how the rest reads: a turnaround under a chief executive appointed four months ago is a different proposition from the same turnaround under a fifteen-year founder. List only people the evidence names, with tenure and shareholding only where a filing gives them. Never supply a name, a date or a holding from your own knowledge — a wrong executive on a client note is the worst error this report can contain. Board and executive churn goes in the 'changes' list, and if it is severe it belongs on the risks page as well. If the filings name nobody, leave the page out.

VITTI VIEW ('vitti-view'). A read of the setup, not a rating: business quality, balance sheet, current momentum, the key debate in one sentence, and the next catalyst. Only rate what the evidence supports. Keep it unpromotional.

QUESTION FOR MANAGEMENT. One question, coming directly out of your own research, about something the public documents leave open. It goes on the Vitti View page or the closing page — not both.

WHAT WOULD CHANGE THE STORY ('outlook'). The specific, checkable things that would improve or worsen the investment case. Company-specific only: "Australian sales return to growth", "the Panel declaration is set aside", "cash burn forces another raise" — never a generic bull and bear list.

=== 10. RISKS ===

Real risks, specific to this company, each with a sentence on why it matters: customer or supplier concentration, margin pressure, commodity exposure, regulation, trial failure, project delay, funding need, integration, debt, cash burn, dependence on one product or contract, and the fact that the shares have just re-rated. Do not pad with generic risks to look balanced, and do not exaggerate one for the same reason.

=== 11. THE CLOSING PAGE ===

Three or four standalone statements leaving the reader with a clear investment debate: what remains strong, what changed, what the key concern or opportunity is, and what to watch next. Do not restate the financial detail from earlier pages. The house sign-off line is appended automatically — do not write it yourself.

=== 12. LENGTH ===

${REPORT_PAGE_TARGET.min} pages of substance is a good note; ${REPORT_PAGE_TARGET.max} pages of filler is not. Do not lengthen the report because more information was available — include what changes the reader's understanding of the company or the move. If the evidence is genuinely thin, write a shorter, honest report and say what could not be established.

=== 13. WHEN THE JOB IS TO CHECK A DRAFT ===

If you are given a drafted report and the report_accuracy_gate tool, you are the checking analyst, not the writer. You are not editing it and you are not rewriting it. You are looking for what is wrong, against the same evidence it was written from. Assume nothing is right because it reads well — the failure you are looking for is a figure that felt correct to the writer.

What to verify, in order of how much damage it does:

1. EVERY NUMBER. Take each figure in the report — KPI cards, chart points, comparison tables, stat lines, numbers in prose — and find it in the evidence. Revenue and its growth, gross profit and margin, EBITDA and underlying EBITDA, EBIT, NPAT, EPS, operating costs, operating and free cash flow, cash conversion, cash, debt, net debt, leverage, net assets, dividends, guidance old and new, acquisition price and earn-outs, contract values, customer and supplier concentration, goodwill, segment figures, production, resources and reserves, trial results, financing terms. A figure that is not in the evidence, and is not identified in the report as the writer's own calculation, is a blocking finding. So is one that contradicts the evidence.

2. THE SHARE-PRICE MOVE. It must match the market data block, and the wording must match the window — section 5 above.

3. CLAIMS THAT GO FURTHER THAN THE EVIDENCE. Headline contract value written as guaranteed revenue when the filing makes it conditional or a maximum. Acquisition-driven growth described as organic. A future outcome written as "will" when it is management's expectation. A cause stated as fact when the filing does not establish it. Any recommendation, price target, or advice to buy or sell — the report must contain none.

4. HOUSE RULES — sections 6 and 8 above. Currency, tense, banned filler openers, charts whose conclusion only restates their own numbers, page headings that name a category instead of stating a finding.

5. INTERNAL CONSISTENCY. The same metric must not carry two different values on two pages, and the closing page must not contradict the body.

If two documents in the evidence disagree, that is a finding of its own — say which the report used and which it should have.

Be specific, and be honest in both directions. Do not invent findings to look thorough: an empty findings list with a summary saying what you checked is a valid and useful result. Do not soften a real one: if a number cannot be traced to the evidence, say so and mark it blocking, even if it is probably right.`;

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

function asCallouts(value: unknown): ReportCallout[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const entry = item as Record<string, unknown>;
      return { label: asString(entry?.label), text: asString(entry?.text) };
    })
    .filter((callout) => callout.label && callout.text);
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
    });
  }

  // One point is a number, not a chart, and the renderer's baseline maths
  // divides by the series span — which is zero for an all-zero series.
  if (points.length < 2) return null;
  if (points.every((point) => point.value === 0)) return null;

  return {
    type: asString(raw.type) === "bars" ? "bars" : "columns",
    unit: asString(raw.unit) || null,
    points,
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
 */
function normalisePage(raw: unknown, fallbackCompanyName: string): ReportPage | null {
  const page = raw as Record<string, unknown>;
  const kind = asString(page?.kind);
  const title = asString(page?.title);
  const intro = asString(page?.intro) || null;

  switch (kind) {
    case "cover": {
      const kpis = asKpis(page.kpis).slice(0, 2);
      const headline = asString(page.headline);
      if (!headline) return null;
      return {
        kind: "cover",
        companyName: asString(page.companyName) || fallbackCompanyName,
        headline,
        kpis,
      };
    }

    case "narrative": {
      const paragraphs = asStringArray(page.paragraphs);
      const callouts = asCallouts(page.callouts);
      if (!title || (paragraphs.length === 0 && callouts.length === 0)) return null;
      return { kind: "narrative", title, intro, paragraphs, callouts };
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
      };
    }

    case "entities": {
      const items = asEntities(page.items);
      if (!title || items.length === 0) return null;
      return { kind: "entities", title, intro, items };
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
      };
    }

    case "market-vs-reality": {
      const headline = asString(page.headline);
      const marketFocus = asString(page.marketFocus);
      const whatMatters = asString(page.whatMatters);
      // All three blocks or none: the page's whole point is the gap between
      // them, and two of the three does not show a gap.
      if (!headline || !marketFocus || !whatMatters) return null;
      return {
        kind: "market-vs-reality",
        title: title || "Headline vs What Actually Moved the Stock",
        headline,
        marketFocus,
        whatMatters,
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
      };
    }

    case "outlook": {
      const improve = asStringArray(page.improve);
      const worsen = asStringArray(page.worsen);
      // One-sided is legitimate — a story can have only downside left — but an
      // empty page is not.
      if (improve.length === 0 && worsen.length === 0) return null;
      return {
        kind: "outlook",
        title: title || "What Would Change the Story?",
        intro,
        improve,
        worsen,
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
            }));
      if (items.length === 0) return null;
      return { kind: "risks", title: title || "Risks & What to Watch", items };
    }

    case "closing": {
      const statements = asStringArray(page.statements);
      if (statements.length === 0) return null;
      return {
        kind: "closing",
        title: title || "Where the Story Stands",
        statements,
        managementQuestion: asString(page.managementQuestion) || null,
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
};

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
  const marketBlock = `MARKET DATA (${input.moveDate}, from the exchange feed — these are the authoritative figures for the move)
  ticker:      ${row.ticker}
  company:     ${row.companyName}
  sector:      ${row.sector ?? "unknown"}
  move:        ${row.changePct > 0 ? "+" : ""}${row.changePct.toFixed(2)}%
  last price:  ${row.last !== null ? `$${row.last.toFixed(4)}` : "unknown"}
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
    /**
     * The first draft and what the Accuracy Gate found in it.
     *
     * Present only on the rewrite. The draft itself is included, not just the
     * findings: a rewrite told only "these four numbers are wrong" starts from
     * a blank page and loses the eight pages that were right, and a second pass
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
      text: input.corrections?.findings.length
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

    const pages = dedupeManagementQuestion(
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
          pages,
        },
        mover: {
          ticker: row.ticker,
          companyName,
          sector: asString(raw.sector) || row.sector,
          movePct,
          moveType: raw.moveType === "closing" ? "closing" : "intraday",
          moveWindowLabel: asString(raw.moveWindowLabel) || null,
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
        case "cover":
          body.push(page.companyName, page.headline);
          body.push(...page.kpis.map(kpiLine));
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
                    `${point.label}=${point.display?.trim() || point.value}`,
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
        case "outlook":
          body.push(page.title);
          if (page.intro) body.push(page.intro);
          body.push(...page.improve.map((item) => `improves: ${item}`));
          body.push(...page.worsen.map((item) => `worsens: ${item}`));
          break;
        case "closing":
          body.push(page.title);
          body.push(...page.statements);
          if (page.managementQuestion) {
            body.push(`question for management: ${page.managementQuestion}`);
          }
          break;
      }

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
                "evidence or contradicts it, an intraday move described as a close, a conditional or headline " +
                "contract value presented as guaranteed revenue, acquisition-driven growth called organic, a " +
                "future outcome stated as certain, or a claim that goes further than the filing supports. " +
                "'advisory' for house-rule issues that do not make it wrong: 'A$' instead of '$', a banned " +
                "filler phrase, past tense for something still true, a chart whose conclusion only restates its " +
                "own numbers, an undisclosed calculation.",
            },
            page: {
              type: "integer",
              description:
                "1-based page number from the report text, when the issue sits on one page.",
            },
            category: {
              type: "string",
              enum: [
                "figure",
                "unsupported-claim",
                "share-price-wording",
                "future-certainty",
                "contract-terms",
                "organic-vs-acquired",
                "currency",
                "tense",
                "style",
                "structure",
                "compliance",
              ],
              description: "Which rule the finding is about.",
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
                "not $44.1 million', or 'the announcement says the $500 million is a maximum over five years " +
                "and is not committed'.",
            },
            fix: {
              type: "string",
              description:
                "What the report should say instead. If the figure cannot be confirmed anywhere in the evidence, " +
                "the fix is to remove the claim.",
            },
          },
          required: ["severity", "category", "claim", "problem", "fix"],
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
