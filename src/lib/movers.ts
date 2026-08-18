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
  asxAnnouncementUrl: string | null;
  analystId: number | null;
  analystName: string | null;
};

export type CompanyOption = { id: number; ticker: string; name: string };
export type CatalystOption = { id: number; label: string; slug: string };
export type AnalystOption = { id: number; name: string };

/** Lookups needed by the Add/Edit form. */
export type FormOptions = {
  companies: CompanyOption[];
  catalysts: CatalystOption[];
  analysts: AnalystOption[];
};
