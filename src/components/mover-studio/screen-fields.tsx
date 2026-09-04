import {
  DEFAULT_SCREEN,
  SCREEN_LIMITS,
  type ScreenCriteria,
} from "@/lib/asx/types";

/**
 * The screen controls, described once.
 *
 * `DEFAULT_SCREEN` and `SCREEN_LIMITS` are plain objects in client-safe
 * modules, so importing them here does not drag the board fetcher into the
 * browser bundle — and the form's defaults are then guaranteed to be the same
 * numbers the server falls back to when a field is missing.
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
    hint: "Dollar value traded today. The single most useful filter — an unfiltered board is mostly stocks that traded a few thousand dollars.",
    ...SCREEN_LIMITS.minTurnover,
  },
  {
    name: "minMarketCap",
    label: "Min market cap (A$)",
    hint: "Keeps shells and nano-caps off the shortlist.",
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
    hint: "How many gainers and how many losers Claude gets to choose between.",
    ...SCREEN_LIMITS.perSide,
  },
];

export const DEFAULT_SCREEN_VALUES: Record<keyof ScreenCriteria, number> =
  DEFAULT_SCREEN;
