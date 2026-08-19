import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { extractText } from "unpdf";

export type ExtractedMoverData = {
  ticker: string;
  companyName: string;
  sector: string | null;
  moveDate: string;
  movePct: number;
  moveType: "intraday" | "closing";
  moveWindowLabel: string | null;
  catalystSlug: string;
  reasonForMove: string;
  mainTakeaway: string;
  reportPrice: number | null;
  analystName: string | null;
  asxAnnouncementUrl: string | null;
};

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "save_daily_mover_research",
  description:
    "Extracts structured metadata and investment takeaways from a Vitti Capital Daily Mover research report.",
  input_schema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "ASX ticker symbol without .AX, uppercase (e.g. JBH, SPZ, BHP, CBA).",
      },
      companyName: {
        type: "string",
        description: "Full company name (e.g. JB Hi-Fi Limited, Smart Parking Limited).",
      },
      sector: {
        type: "string",
        description:
          "GICS industry sector if identified (e.g. Consumer Discretionary, Industrials, Materials, Financials, Healthcare, Information Technology).",
      },
      moveDate: {
        type: "string",
        description: "Date of the report/move in YYYY-MM-DD format (e.g. 2026-08-17).",
      },
      movePct: {
        type: "number",
        description:
          "SIGNED percentage move (e.g. -11.5 for a fall, +20.6 for a rise). CRITICAL: If the headline says 'Fall', 'Drop', 'Plunge', 'Tumble', or 'Down', this MUST be negative. If 'Rise', 'Gain', 'Surge', or 'Up', this MUST be positive.",
      },
      moveType: {
        type: "string",
        enum: ["intraday", "closing"],
        description:
          "Whether the move is 'intraday' (e.g. 'Morning Trade', 'Intraday') or 'closing' (official market close).",
      },
      moveWindowLabel: {
        type: "string",
        description: "Verbatim phrasing from the report's hero card (e.g. 'Morning Trade', 'Intraday').",
      },
      catalystSlug: {
        type: "string",
        enum: [
          "earnings_result",
          "trading_update",
          "quarterly_update",
          "guidance_change",
          "contract_customer_win",
          "capital_raise",
          "ma_takeover",
          "capital_management",
          "clinical_trial_result",
          "exploration_drilling_result",
          "resource_reserve_update",
          "regulatory_approval",
          "project_milestone",
          "management_board_change",
          "strategic_operational_update",
          "other",
        ],
        description: "The primary catalyst category driving the price movement.",
      },
      reasonForMove: {
        type: "string",
        description:
          "Detailed explanation of what actually caused the share price move (max 1000 chars).",
      },
      mainTakeaway: {
        type: "string",
        description:
          "Core investment takeaway or conclusion for future reference: 'What did we say last time?' (max 1000 chars).",
      },
      reportPrice: {
        type: "number",
        description: "Share price at publication if noted in the PDF, otherwise null.",
      },
      analystName: {
        type: "string",
        description:
          "Name of the research analyst author if listed (e.g. 'Prasham Doshi'), otherwise null.",
      },
      asxAnnouncementUrl: {
        type: "string",
        description: "Official ASX announcement URL if printed in report, otherwise null.",
      },
    },
    required: [
      "ticker",
      "companyName",
      "moveDate",
      "movePct",
      "moveType",
      "catalystSlug",
      "reasonForMove",
      "mainTakeaway",
    ],
  },
};

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error(
      "ANTHROPIC_API_KEY is missing. Please add your Anthropic API key to .env.local to enable automated PDF extraction.",
    );
  }
  return new Anthropic({ apiKey: apiKey.trim() });
}

export async function extractMoverFromPdfBuffer(
  pdfBuffer: Buffer,
): Promise<ExtractedMoverData> {
  const anthropic = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  // Step 1: Attempt token-efficient text extraction
  let extractedPdfText = "";
  try {
    const uint8Array = new Uint8Array(pdfBuffer);
    const parsed = await extractText(uint8Array);

    if (Array.isArray(parsed.text)) {
      extractedPdfText = parsed.text
        .map((pageText, idx) => `=== PAGE ${idx + 1} ===\n${pageText.trim()}`)
        .filter((page) => !/Disclaimer:/i.test(page))
        .join("\n\n");
    } else if (typeof parsed.text === "string") {
      extractedPdfText = parsed.text;
    }
  } catch (err) {
    console.warn("Text extraction failed, falling back to visual document mode", err);
  }

  const isTextExtracted = extractedPdfText.trim().length > 50;

  // Step 2: Construct user message (either low-cost text payload or visual PDF fallback)
  let userMessageContent:
    | string
    | Anthropic.MessageParam["content"];

  if (isTextExtracted) {
    userMessageContent = `Here is the extracted text of the Vitti Capital Daily Mover research report:\n\n${extractedPdfText}\n\nExtract all structured research metadata using the save_daily_mover_research tool.`;
  } else {
    const base64Data = pdfBuffer.toString("base64");
    userMessageContent = [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64Data,
        },
      },
      {
        type: "text",
        text: "Extract all research metadata from this Daily Mover PDF using the save_daily_mover_research tool.",
      },
    ];
  }

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      temperature: 0,
      system: `You are an expert equity research analyst assistant for Vitti Capital.
Your job is to accurately extract structured metadata from Vitti Capital 'Daily Mover' research reports.

Key rules:
1. TICKER: Extract the ASX ticker without exchange suffixes (e.g. 'JBH', not 'JBH.AX').
2. SIGN OF MOVE (%): The source reports print magnitudes like '~11.5%' while the direction is in the headline text ('Shares Fall as Much as...'). If the headline indicates a fall/drop/decline, movePct MUST be NEGATIVE (e.g. -11.5). If it indicates a rise/surge/gain, movePct MUST be POSITIVE (e.g. 20.6).
3. CATALYST: Categorize the primary price-moving catalyst into the closest matching slug. For example, if FY26 earnings results were released but the sell-off was triggered by a weak July trading update, select 'trading_update'. If a buyback or dividend was the main news, select 'capital_management'.
4. TAKEAWAY: Synthesize the key forward-looking takeaway so when an analyst reviews this company in the future, they know exactly what Vitti Capital concluded.`,
      messages: [
        {
          role: "user",
          content: userMessageContent,
        },
      ],
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "save_daily_mover_research" },
    });

    const toolUse = response.content.find(
      (c) => c.type === "tool_use" && c.name === "save_daily_mover_research",
    );

    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Claude did not return structured extraction data.");
    }

    const raw = toolUse.input as Record<string, unknown>;

    return {
      ticker: String(raw.ticker ?? "").trim().toUpperCase(),
      companyName: String(raw.companyName ?? "").trim(),
      sector: raw.sector ? String(raw.sector).trim() : null,
      moveDate: String(raw.moveDate ?? "").trim(),
      movePct: Number(raw.movePct),
      moveType: raw.moveType === "closing" ? "closing" : "intraday",
      moveWindowLabel: raw.moveWindowLabel ? String(raw.moveWindowLabel).trim() : null,
      catalystSlug: String(raw.catalystSlug ?? "other"),
      reasonForMove: String(raw.reasonForMove ?? "").trim(),
      mainTakeaway: String(raw.mainTakeaway ?? "").trim(),
      reportPrice: raw.reportPrice != null ? Number(raw.reportPrice) : null,
      analystName: raw.analystName ? String(raw.analystName).trim() : null,
      asxAnnouncementUrl: raw.asxAnnouncementUrl
        ? String(raw.asxAnnouncementUrl).trim()
        : null,
    };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error("Anthropic API Error:", error.status, error.message);
      if (error.status === 401) {
        throw new Error("Invalid ANTHROPIC_API_KEY. Please verify your API key in .env.local.");
      }
      if (error.status === 429) {
        throw new Error("Anthropic API rate limit exceeded or credit balance exhausted.");
      }
      throw new Error(`Claude API Error: ${error.message}`);
    }
    throw error;
  }
}
