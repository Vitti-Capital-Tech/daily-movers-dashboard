/**
 * Types and constants shared between server and client components.
 *
 * Kept separate from `queries.ts` on purpose: that module imports the Postgres
 * driver, so a client component importing a runtime value from it pulls the
 * whole driver into the browser bundle and the build fails. Anything a client
 * component needs at runtime belongs here.
 */

export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PER_PAGE = 25;

export type SortKey = "date" | "move" | "ticker" | "company";
export type SortDir = "asc" | "desc";

export const SORT_KEYS: SortKey[] = ["date", "move", "ticker", "company"];

export type MoverFilters = {
  q?: string;
  from?: string;
  to?: string;
  catalystId?: number;
  direction?: "up" | "down";
  sort?: SortKey;
  dir?: SortDir;
  page?: number;
  perPage?: number;
};

/** Shape rendered by the table and the research-history list. */
export type MoverRow = {
  id: number;
  moveDate: string;
  ticker: string;
  companyName: string;
  companyId: number;
  catalystId: number;
  catalystLabel: string;
  movePct: number;
  moveType: "intraday" | "closing";
  moveWindowLabel: string | null;
  reasonForMove: string;
  mainTakeaway: string;
  reportPrice: number | null;
  reportUrl: string | null;
  reportStoragePath: string | null;
  asxAnnouncementUrl: string | null;
  analystId: number | null;
  analystName: string | null;

  /**
   * What the returns below are measured from: `reportPrice` when it was entered,
   * otherwise the close on the move date. Null only when we have no price data
   * for the company at all.
   */
  anchorPrice: number | null;
  /** Latest price from the market-data provider, ~20 minutes delayed. */
  currentPrice: number | null;
  /** When that price was current upstream, not when we fetched it. */
  currentPriceAt: Date | null;
};

/**
 * Percentage change between two prices, or null when either side is unknown.
 *
 * The return goes through here so "we don't know yet" (a ticker with no price
 * data, or a quote not fetched yet) stays distinguishable from a genuine 0.0%
 * and can be rendered as such.
 */
export function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null;
  return ((to - from) / from) * 100;
}

type PerformanceFields = Pick<
  MoverRow,
  "anchorPrice" | "currentPrice" | "reportPrice"
>;

/** Report price (or move-date close) to the latest price. */
export function postEventReturn(row: PerformanceFields): number | null {
  return pctChange(row.anchorPrice, row.currentPrice);
}

/**
 * True when the anchor is a close we looked up rather than a price someone
 * entered. The table marks these, so a return is never mistaken for being
 * measured from the figure printed in the report.
 */
export function anchorIsInferred(row: PerformanceFields): boolean {
  return row.reportPrice === null && row.anchorPrice !== null;
}

/** True when there's a PDF to open — uploaded file or external link. */
export function hasReport(row: {
  reportStoragePath: string | null;
  reportUrl: string | null;
}): boolean {
  return Boolean(row.reportStoragePath || row.reportUrl);
}

/** Always go via the route: it checks the session and signs a short-lived URL. */
export function reportHref(moverId: number): string {
  return `/api/reports/${moverId}`;
}

export type CompanyOption = { id: number; ticker: string; name: string };
export type CatalystOption = { id: number; label: string; slug: string };
export type AnalystOption = { id: number; name: string };

/** Lookups needed by the Add/Edit form. */
export type FormOptions = {
  companies: CompanyOption[];
  catalysts: CatalystOption[];
  analysts: AnalystOption[];
};
