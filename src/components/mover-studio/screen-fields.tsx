import { SCREEN_LIMITS, type ScreenCriteria } from "@/lib/asx/types";

/**
 * The screen controls, described once.
 *
 * `SCREEN_LIMITS` is a plain object in a client-safe module, so importing it
 * here does not drag the board fetcher into the browser bundle, and the bounds
 * the inputs advertise are the same ones `readCriterion` clamps to on the
 * server.
 *
 * The *values* the form starts with are no longer here. They are the stored
 * screen, read per-request in the Studio page and passed down — the compiled
 * `DEFAULT_SCREEN` is only the fallback when nothing has been saved.
 */

export type ScreenField = {
  name: keyof ScreenCriteria;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
};

export const SCREEN_FIELDS: ScreenField[] = [
  {
    name: "minTurnover",
    label: "Min turnover (A$)",
    hint: "Dollar value traded today. Currently 0: turnover accrues from the open, and the 10:30 screen is too early for a dollar floor to mean much.",
    ...SCREEN_LIMITS.minTurnover,
  },
  {
    name: "minMarketCap",
    label: "Min market cap (A$)",
    hint: "Keeps shells and nano-caps off the shortlist. With no turnover floor this is the only structural filter left.",
    ...SCREEN_LIMITS.minMarketCap,
  },
  {
    name: "minAbsChangePct",
    label: "Min move (%)",
    hint: "Absolute move, so it applies to both sides of the board.",
    ...SCREEN_LIMITS.minAbsChangePct,
  },
  {
    name: "perSide",
    label: "Rows per side",
    hint: "How many gainers and how many losers Claude gets to choose between. Above 25 a side, raise CANDIDATE_LOOKUP_LIMIT too or the extra rows are never looked up.",
    ...SCREEN_LIMITS.perSide,
  },
];
