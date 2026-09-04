/**
 * Paging and search primitives shared by every table in the app.
 *
 * Extracted when the third table needed them. The Daily Movers archive had a
 * pager and a search box, the company directory had neither, and Post Studio
 * was about to grow its own — three implementations of "read `?page=` and clamp
 * it" is how two of them end up subtly different about what happens when a
 * filter narrows the result set under you.
 *
 * Client-safe: no imports, because the pager and the search box are client
 * components and the pages that use them are server components.
 */

export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PER_PAGE = 25;

export type PerPage = (typeof PER_PAGE_OPTIONS)[number];

/** What every paginated list takes. */
export type TableParams = {
  /** Free-text search. Meaning is per-table; each query decides the columns. */
  q?: string;
  page?: number;
  perPage?: number;
};

/** What every paginated list returns alongside its rows. */
export type Paged<T> = {
  rows: T[];
  /** Rows matching the filter, before paging. */
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
};

function one(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  const found = Array.isArray(value) ? value[0] : value;
  return found && found.trim() !== "" ? found.trim() : undefined;
}

/**
 * Reads `q`, `page` and `perPage` out of a `searchParams` object.
 *
 * An unrecognised `perPage` falls back to the default rather than being
 * honoured, so a hand-edited URL can't ask for ten thousand rows.
 */
export function parseTableParams(
  params: Record<string, string | string[] | undefined>,
): TableParams {
  const perPageRaw = Number(one(params, "perPage"));
  const pageRaw = Number(one(params, "page"));

  return {
    q: one(params, "q"),
    page: Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1,
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPageRaw)
      ? perPageRaw
      : DEFAULT_PER_PAGE,
  };
}

/**
 * Turns a requested page and a row count into a safe offset.
 *
 * The clamp is the point. A filter that narrows the result set while you are on
 * page four should land you on the last page of what is left, not on an empty
 * table that looks like the filter matched nothing — and the pager's own
 * "return to page 1 on filter change" only covers changes made through the UI,
 * not a shared or bookmarked URL.
 */
export function resolvePaging(
  params: TableParams,
  total: number,
): { page: number; perPage: number; pageCount: number; offset: number } {
  const perPage = (PER_PAGE_OPTIONS as readonly number[]).includes(
    params.perPage ?? NaN,
  )
    ? params.perPage!
    : DEFAULT_PER_PAGE;

  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(params.page ?? 1, 1), pageCount);

  return { page, perPage, pageCount, offset: (page - 1) * perPage };
}
