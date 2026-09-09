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
  /**
   * The session's volume against the company's trailing average, as the report
   * was told it. Stored so a reviewer checking "traded on 6x average volume"
   * can see the figures behind it rather than re-deriving them.
   *
   * Optional: null when the provider had no usable history, and absent on
   * drafts made before the profile existed.
   */
  volumeProfile?: {
    sessionVolume: number | null;
    averageVolume: number | null;
    multiple: number | null;
    averagedSessions: number;
    recent: { date: string; volume: number }[];
  } | null;
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

/**
 * Blocking categories where a single finding is enough to rewrite the report.
 *
 * These are the ones that put a *wrong fact* on a client document — a figure
 * that isn't in the filings, a move described as a close when it was intraday,
 * a conditional contract value presented as committed, or anything that reads as
 * advice. There is no version of those a reviewer can leave standing, and the
 * review UI does not allow editing the report body, so the alternative to a
 * rewrite is a rejection and no Daily Mover that day.
 *
 * The categories deliberately *not* here — `unsupported-claim`,
 * `future-certainty`, `organic-vs-acquired`, `structure` — are over-reach in
 * the wording rather than a wrong number. One of those on its own is a judgment
 * call worth an analyst's eye, not $0.16 of rewrite; two or more of anything
 * blocking says the draft has a pattern and gets rewritten regardless.
 */
const HARD_FACT_CATEGORIES = new Set([
  "figure",
  "share-price-wording",
  "contract-terms",
  "compliance",
]);

/**
 * Whether the Accuracy Gate's findings justify spending a rewrite.
 *
 * Every blocking finding still reaches the reviewer either way; this only
 * decides whether the pipeline pays to fix them itself. See
 * `HARD_FACT_CATEGORIES` for where the line sits and why.
 */
export function warrantsRewrite(findings: AccuracyFinding[]): boolean {
  const blocking = findings.filter((finding) => finding.severity === "blocking");
  if (blocking.length === 0) return false;
  if (blocking.length >= 2) return true;
  return HARD_FACT_CATEGORIES.has(blocking[0].category);
}

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
 * how this function once understated a draft by half: a 5-minute-TTL write bills
 * at 1.25x and a one-hour-TTL write at **2x**, and the pipeline used the hour
 * while this estimate assumed the five minutes.
 *
 * They now agree. `buildEvidenceContent` caches the announcement corpus on the
 * **5-minute** TTL, because the pipeline reads it back two or three times within
 * minutes — write the report, check it, and rewrite it if the check finds
 * something — rather than once a day as it did when caching was removed. So
 * 1.25x is the rate actually being paid.
 *
 * Historical rows are unaffected either way: `cacheWriteTokens` is 0 on every
 * draft made while there was no breakpoint at all.
 */
const RATE_PER_MTOK = {
  input: 3,
  /** 5-minute TTL write, matching the breakpoint the pipeline actually sets. */
  cacheWrite: 3 * 1.25,
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
