/**
 * Draft shapes shared between server and client components.
 *
 * Same split as `lib/movers.ts` vs `lib/queries.ts`: the modules that read and
 * generate drafts import the Postgres driver and the Anthropic SDK, so the
 * review UI takes its types from here instead.
 */

import type { MoverSide, ScreenResult } from "@/lib/asx/types";
import type { CatalystSlug } from "@/lib/catalysts";
import type { ReportDoc } from "@/lib/report/types";

export type DraftStatus =
  | "generating"
  | "pending"
  | "approved"
  | "rejected"
  | "failed";

/** Claude's pick, its reasoning, and what it passed over. */
export type DraftSelection = {
  ticker: string;
  rationale: string;
  runnerUps: { ticker: string; reason: string }[];
  confidence: number;
};

/** One announcement in the audit trail, as stored on the draft. */
export type DraftSource = {
  idsId: string;
  date: string;
  time: string | null;
  headline: string;
  isPriceSensitive: boolean;
  pageCount: number | null;
  sizeBytes: number | null;
  sourceUrl: string;
};

export type DraftSources = {
  today: DraftSource[];
  history: DraftSource[];
  /** How many were actually readable — the rest were withdrawn or image-only. */
  readToday: number;
  readHistory: number;
};

/**
 * One thing the Accuracy Gate found wrong with a drafted report.
 *
 * Declared here rather than beside the model call that produces it because the
 * review card renders these, and `lib/ai/mover-draft.ts` is `server-only`.
 */
export type AccuracyFinding = {
  /**
   * `blocking` triggers a rewrite: a wrong or unsupported number, an intraday
   * move written as a close, a conditional contract value presented as revenue.
   * `advisory` is what a reviewer should know but that does not make the report
   * wrong — house-style slips, an undisclosed calculation.
   */
  severity: "blocking" | "advisory";
  /** 1-based page the problem is on, when it can be pinned to one. */
  page: number | null;
  /** Which rule it breaks: "figure", "tense", "currency", "contract-terms". */
  category: string;
  /** The words in the report that are wrong. */
  claim: string;
  /** Why they are wrong, against the evidence. */
  problem: string;
  /** What the report should say instead. */
  fix: string;
};

/** The Accuracy Gate's verdict on a draft, as stored on the row. */
export type AccuracyReview = {
  verdict: "pass" | "revise";
  /** One or two sentences for the review card. */
  summary: string;
  findings: AccuracyFinding[];
  /**
   * True once the pipeline has rewritten the report against these findings —
   * so the list describes the draft that *was*, not the PDF on the row.
   */
  revised?: boolean;
};

/** The full row the review card renders. */
export type DraftRow = {
  id: number;
  status: DraftStatus;
  moveDate: string;
  trigger: string;

  ticker: string | null;
  companyName: string | null;
  sector: string | null;

  movePct: number | null;
  moveType: "intraday" | "closing" | null;
  moveWindowLabel: string | null;
  catalystSlug: CatalystSlug | null;
  reasonForMove: string | null;
  mainTakeaway: string | null;
  reportPrice: number | null;
  analystName: string | null;

  /** Present once the draft has a PDF to preview. */
  hasPdf: boolean;

  selection: DraftSelection | null;
  sources: DraftSources | null;
  /** Stored with the cited ids attached alongside the renderable document. */
  report: (ReportDoc & { citedIdsIds?: string[] }) | null;
  /** Null on drafts made before the gate existed, or with nothing to check. */
  accuracy: AccuracyReview | null;
  screen: ScreenResult | null;

  model: string | null;
  inputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
  outputTokens: number | null;

  progress: string | null;
  error: string | null;

  createdBy: string | null;
  createdAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;

  /** Set once approved — the archive row this became. */
  approvedMoverId: number | null;
};

/** The compact shape the queue list renders. */
export type DraftListItem = Pick<
  DraftRow,
  | "id"
  | "status"
  | "moveDate"
  | "trigger"
  | "ticker"
  | "companyName"
  | "movePct"
  | "progress"
  | "error"
  | "createdAt"
  | "approvedMoverId"
>;

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  generating: "Generating",
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
};

/** A draft in this state is still moving; the UI keeps polling. */
export function isDraftInFlight(status: DraftStatus): boolean {
  return status === "generating";
}

/** Which side of the board a draft came from, derived from the signed move. */
export function draftSide(movePct: number | null): MoverSide | null {
  if (movePct === null || movePct === 0) return null;
  return movePct > 0 ? "gainers" : "losers";
}

/**
 * Rough US-dollar cost of a draft, for the review card's footer.
 *
 * Claude Sonnet 5 list pricing: $3/MTok input, $15/MTok output, cache reads at
 * 0.1x the input rate.
 *
 * The cache **write** multiplier depends on the TTL, and getting it wrong is
 * how this function came to understate a draft by half. A 5-minute-TTL write
 * bills at 1.25x; a one-hour-TTL write bills at **2x**. The pipeline used the
 * one-hour TTL while this estimate assumed 1.25x, reporting ~$0.97 for drafts
 * that actually cost ~$1.50. The breakpoint has since been removed (see the
 * note in `lib/ai/mover-draft.ts`), so `cacheWriteTokens` should now be zero on
 * new drafts -- but the higher multiplier is kept here so historical rows, and
 * any future caching, are priced honestly rather than flatteringly.
 */
const RATE_PER_MTOK = {
  input: 3,
  /** One-hour TTL write. The conservative assumption of the two. */
  cacheWrite: 3 * 2,
  cacheRead: 3 * 0.1,
  output: 15,
} as const;

export function estimateDraftCostUsd(usage: {
  inputTokens: number | null;
  cacheWriteTokens?: number | null;
  cacheReadTokens?: number | null;
  outputTokens: number | null;
}): number | null {
  const parts = [
    [usage.inputTokens, RATE_PER_MTOK.input],
    [usage.cacheWriteTokens, RATE_PER_MTOK.cacheWrite],
    [usage.cacheReadTokens, RATE_PER_MTOK.cacheRead],
    [usage.outputTokens, RATE_PER_MTOK.output],
  ] as const;

  if (parts.every(([tokens]) => tokens === null || tokens === undefined)) {
    return null;
  }

  return parts.reduce(
    (total, [tokens, rate]) => total + ((tokens ?? 0) / 1_000_000) * rate,
    0,
  );
}

/** Total input volume across all three input kinds, for the "tokens in" label. */
export function totalInputTokens(usage: {
  inputTokens: number | null;
  cacheWriteTokens?: number | null;
  cacheReadTokens?: number | null;
}): number {
  return (
    (usage.inputTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0) +
    (usage.cacheReadTokens ?? 0)
  );
}
