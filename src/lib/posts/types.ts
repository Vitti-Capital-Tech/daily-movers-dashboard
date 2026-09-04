/**
 * Track-record and LinkedIn post shapes shared between server and client.
 *
 * Same split as `lib/movers.ts` vs `lib/queries.ts`, and `lib/drafts/types.ts`
 * vs `lib/drafts/queries.ts`: the reads import the Postgres driver, so the
 * Studio UI takes its types from here.
 */

import type { TableParams } from "@/lib/table";

export type PostVerdict = "validated" | "mixed" | "contradicted" | "too_early";
export type PostStatus = "draft" | "posted" | "discarded";

/** One drafted variant. */
export type PostVariant = {
  /** What this version leads with — "the overlooked detail", "the risk we flagged". */
  angle: string;
  text: string;
};

/**
 * The prices the post text was computed from.
 *
 * Stored because the figures in a post are only true as at the moment they were
 * written: the live quote moves daily, so a draft claiming "+18.4% since our
 * note" and a table reading "+12.1%" are both correct about different instants.
 * Keeping the snapshot lets the UI say which instant the copy refers to, and
 * warn when the live figure has drifted.
 */
export type PostSnapshot = {
  anchorPrice: number;
  currentPrice: number;
  postEventReturn: number;
  /** When the quote in `currentPrice` was current upstream, ISO. */
  priceAsOf: string | null;
  /** Calendar days from the move date to generation. */
  daysSince: number;
};

/** One row of the track-record table. */
export type TrackRecordRow = {
  moverId: number;
  moveDate: string;
  ticker: string;
  companyName: string;
  catalystLabel: string;
  /** Signed move on the day, from the note. */
  movePct: number;
  mainTakeaway: string;
  reasonForMove: string;

  anchorPrice: number | null;
  currentPrice: number | null;
  currentPriceAt: Date | null;
  /** Anchor to latest price. Null when either side is unknown. */
  postEventReturn: number | null;
  daysSince: number;

  /** Whether the price has moved the same way the note's move did. */
  continued: boolean | null;

  /** The most recent post generated for this mover, if any. */
  post: {
    id: number;
    status: PostStatus;
    verdict: PostVerdict;
    variantCount: number;
    createdAt: Date;
  } | null;
};

/** The full record the review panel renders. */
export type PostRow = {
  id: number;
  moverId: number;
  status: PostStatus;
  verdict: PostVerdict;
  verdictReason: string | null;
  evidenceQuote: string | null;
  variants: PostVariant[];
  snapshot: PostSnapshot | null;

  ticker: string | null;
  companyName: string | null;
  moveDate: string | null;
  movePct: number | null;
  mainTakeaway: string | null;

  model: string | null;
  inputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
  outputTokens: number | null;

  createdBy: string | null;
  createdAt: Date;
  postedAt: Date | null;
};

/** Which verdicts to show. `assessed`/`unassessed` filter on having a post. */
export type TrackRecordAssessed = "all" | "assessed" | "unassessed";

/**
 * Extends the shared table params rather than redeclaring `q`/`page`/`perPage`,
 * so `parseTableParams` and `resolvePaging` apply unchanged.
 */
export type TrackRecordFilters = TableParams & {
  assessed?: TrackRecordAssessed;
};

export const VERDICT_LABELS: Record<PostVerdict, string> = {
  validated: "Borne out",
  mixed: "Partly borne out",
  contradicted: "Went against us",
  too_early: "Too early to say",
};

export const VERDICT_BLURBS: Record<PostVerdict, string> = {
  validated: "The price action since publication supports what the note argued.",
  mixed: "Part of the note's view held; part of it did not.",
  contradicted: "The price action since publication runs against what the note argued.",
  too_early: "Not enough has happened since publication to judge the call.",
};

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  discarded: "Discarded",
};

/**
 * The compliance footer, appended by the app and never model-generated.
 *
 * A LinkedIn post that states a return is a past-performance representation,
 * made by a Corporate Authorised Representative under an AFSL. That is
 * regulated marketing, and the required wording is not something to let a
 * language model paraphrase — the same reasoning as the PDF disclaimer in
 * `lib/report/types.ts`. It is a constant so there is no path by which it varies.
 */
export const POST_COMPLIANCE_FOOTER =
  "Past performance is not a reliable indicator of future performance. " +
  "General information only — not personal financial advice. " +
  "Vitti Capital is a Corporate Authorised Representative of Point Capital Group Pty Ltd (AFSL 518031).";

/**
 * LinkedIn truncates a post behind a "…see more" fold at roughly this many
 * characters, so the hook has to land before it.
 */
export const LINKEDIN_FOLD_CHARS = 210;

/** LinkedIn's hard limit on post length. */
export const LINKEDIN_MAX_CHARS = 3000;

/** The post text plus the footer, which is what actually gets pasted. */
export function fullPostText(text: string): string {
  return `${text.trim()}\n\n${POST_COMPLIANCE_FOOTER}`;
}

/**
 * How far the live return has drifted from what a draft claims, in percentage
 * points. Null when either figure is unavailable.
 *
 * Shown next to a draft older than a day or two: a post saying "+18.4%" should
 * not be published once the real figure is +9%.
 */
export function returnDrift(
  snapshot: PostSnapshot | null,
  liveReturn: number | null,
): number | null {
  if (!snapshot || liveReturn === null) return null;
  return liveReturn - snapshot.postEventReturn;
}

/** Past this many percentage points of drift, the draft's numbers are stale. */
export const DRIFT_WARNING_POINTS = 3;

/** Calendar days between two YYYY-MM-DD dates (or a date and now). */
export function daysBetween(fromIso: string, to: Date = new Date()): number {
  const from = new Date(`${fromIso}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) return 0;
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
