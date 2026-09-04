import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { CATALYST_SLUGS, isCatalystSlug, type CatalystSlug } from "@/lib/catalysts";
import { formatMoneyCompact, type ScreenResult, type ScreenerRow } from "@/lib/asx/types";
import {
  REPORT_PAGE_KINDS,
  REPORT_PAGE_TARGET,
  type ReportCallout,
  type ReportDoc,
  type ReportEntity,
  type ReportKpi,
  type ReportPage,
} from "@/lib/report/types";

import {
  addUsage,
  describeAnthropicError,
  draftModel,
  getAnthropicClient,
  type TokenUsage,
} from "./client";
import { formatDocumentForPrompt, type AnnouncementDocument } from "./announcement-text";

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
2. THE COMPANY IS WORTH A CLIENT'S ATTENTION. Prefer recognisable names, real businesses, and companies with enough disclosure history to write a substantive report about. A larger and more liquid name beats a smaller one at a similar quality of story.
3. THE STORY HAS DEPTH. Full-year or half-year results, guidance changes, major contracts, M&A, and regulatory or clinical milestones all give a report something to say across several pages. Index rebalances, minor administrative filings and "response to ASX query" notices do not, however large the move.
4. THE MOVE IS LARGE ENOUGH TO BE NEWS, but size alone is not the criterion — a well-explained 9% fall at a mid-cap is a far better report than a 40% spike in a micro-cap on a single drilling hole.
5. FALLERS ARE AS INTERESTING AS RISERS. Do not bias toward gainers. A sharp fall on a results miss is often the more useful note.

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

    return [
      `${row.ticker} — ${row.companyName}`,
      `    side: ${candidate.side}  move: ${row.changePct > 0 ? "+" : ""}${row.changePct.toFixed(2)}%  ` +
        `last: $${row.last?.toFixed(3) ?? "?"}  turnover: ${formatMoneyCompact(row.turnover)}  ` +
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
        "'risks': label-and-explanation pairs, no numbers. " +
        "'closing' (last page only): 3-4 standalone concluding statements.",
    },
    title: {
      type: "string",
      description:
        "Page heading, sentence-style title case, e.g. 'The UK Is Doing the Heavy Lifting'. Not used on the cover page.",
    },
    companyName: {
      type: "string",
      description: "Cover page only: the company's full registered name.",
    },
    headline: {
      type: "string",
      description:
        "Cover page only. Must state direction and magnitude the way the desk writes it: " +
        "'Shares Rise as Much as ~20.6% in Morning Trade After Record FY26 Results and a New $5 Million Share Buy-Back'.",
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
          `The report body, ${REPORT_PAGE_TARGET.min}-${REPORT_PAGE_TARGET.max} pages. ` +
          "The first page MUST be 'cover' and the last MUST be 'closing'. The compliance " +
          "disclaimer is appended automatically — never write one.",
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

const REPORT_SYSTEM = `You are a research analyst at Vitti Capital, an Australian equities firm, writing today's "Daily Mover" report on an ASX-listed company that has moved sharply.

WHAT A DAILY MOVER IS

A ${REPORT_PAGE_TARGET.min}-${REPORT_PAGE_TARGET.max} page institutional note, one idea per page, that answers three questions in order: what does this company do, what changed today, and what happens next. It is read by portfolio managers who may never have looked at the company before, and it is filed in an archive so that when the company comes up again the desk can see what was said last time.

THE HOUSE STRUCTURE

Page 1 is the cover: company name, a headline stating direction and magnitude, and exactly two hero KPI cards — the share move, and the single most important number from the announcement.

The middle pages each take one idea and give it a page. In roughly this order, using only what the filings support:
  - what the business actually does and how it makes money
  - the headline results or transaction, as a KPI page
  - the segment, geographic or divisional detail
  - the balance sheet and cash position
  - "Risks & What to Watch" — a risks page, always included

The last page is the closing: three or four standalone statements on where the story now stands, ending on the open question a PM should keep an eye on.

HOW IT IS WRITTEN

- Plain English. Short sentences. Explain the business as if to an intelligent reader who has never heard of it. "Automatic Number Plate Recognition reads a car's plate on entry and exit — no barriers needed" is the register.
- Numbers carry the report. Every KPI card and every stat line comes from an announcement in the evidence you were given, or from the market data in the prompt. If a figure is not in the evidence, it does not go in the report. Never estimate, never round to something you did not read, never fill a card because the layout has a slot.
- Be specific over general: "1,525 sites, +302 in FY26" beats "strong site growth".
- Balanced, not promotional. The risks page is not a formality — say what could go wrong, including that the shares have just re-rated.
- Never give a recommendation, price target, or advice to buy or sell. This is explanatory research, not personal advice.
- Do not write a disclaimer or any general advice warning. One is appended automatically, and writing your own would put unapproved compliance text in a client document.
- Work only from the evidence provided. Do not add facts about this company from your training data — they may be out of date, and every number in this report has to be checkable against a filing.
- Cite honestly: list in citedIdsIds every announcement id you actually took a fact from.

If the evidence is thin — a small filing with little detail and no results history — write a shorter, honest report rather than padding it. ${REPORT_PAGE_TARGET.min} pages of substance is a good note; ${REPORT_PAGE_TARGET.max} pages of filler is not.`;

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
  },
  usage: TokenUsage,
): Promise<{ report: DraftedReport; usage: TokenUsage }> {
  const anthropic = getAnthropicClient();
  const { row } = input;

  const marketBlock = `MARKET DATA (${input.moveDate}, from the exchange feed — these are the authoritative figures for the move)
  ticker:      ${row.ticker}
  company:     ${row.companyName}
  sector:      ${row.sector ?? "unknown"}
  move:        ${row.changePct > 0 ? "+" : ""}${row.changePct.toFixed(2)}%
  last price:  ${row.last !== null ? `A$${row.last.toFixed(4)}` : "unknown"}
  turnover:    ${formatMoneyCompact(row.turnover)}
  market cap:  ${formatMoneyCompact(row.marketCap)}

WHY THE DESK PICKED THIS ONE
${input.selection.rationale}`;

  const todayBlock =
    input.todayDocuments.length > 0
      ? input.todayDocuments.map(formatDocumentForPrompt).join("\n\n\n")
      : "(no readable announcement for today — say so plainly in the report rather than speculating about the cause)";

  const historyBlock =
    input.historyDocuments.length > 0
      ? input.historyDocuments.map(formatDocumentForPrompt).join("\n\n\n")
      : "(no earlier price-sensitive announcements were readable)";

  /**
   * There is deliberately **no cache breakpoint** on the corpus, because it was
   * costing money rather than saving it.
   *
   * Caching the announcement corpus looks obviously right — it is the large,
   * stable-looking part of the prompt. It is wrong for this workload. A
   * one-hour-TTL cache write bills at **2x** the input rate and a read at 0.1x,
   * so the break-even is three requests against the same prefix. This pipeline
   * makes one: a different company every day, so the corpus is never read back
   * (`cache_read_input_tokens` was 0 on every measured run). The breakpoint
   * turned $0.71 of corpus into $1.42 for no benefit.
   *
   * Even the re-draft case doesn't recover it: two drafts of the same company
   * cost ~$1.65 cached against ~$1.58 uncached.
   *
   * If a "re-draft this one" button is ever added and used routinely, the thing
   * to reach for is the *5-minute* TTL (`{ type: "ephemeral" }` with no `ttl`),
   * which writes at 1.25x and breaks even on the second request.
   *
   * Content order still matters for the model: evidence first, then the market
   * data that overrides it, then the instruction.
   */
  const content: Anthropic.MessageParam["content"] = [
    {
      type: "text",
      text: `EVIDENCE — TODAY'S PRICE-SENSITIVE ANNOUNCEMENTS FOR ${row.ticker}\n\n${todayBlock}`,
    },
    {
      type: "text",
      text: `EVIDENCE — EARLIER PRICE-SENSITIVE ANNOUNCEMENTS FOR ${row.ticker} (most recent first; this is your source for the business description, the segment detail and the history)\n\n${historyBlock}`,
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
      text: `Write today's Daily Mover report on ${row.ticker} using the publish_daily_mover_draft tool. The by-line analyst is ${input.analystName}.`,
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
      system: REPORT_SYSTEM,
      messages: [{ role: "user", content }],
      tools: [REPORT_TOOL],
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

    const pages = (Array.isArray(raw.pages) ? raw.pages : [])
      .map((page) => normalisePage(page, companyName))
      .filter((page): page is ReportPage => page !== null);

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
