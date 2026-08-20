import "server-only";

import { and, asc, count, desc, eq, gte, ilike, lt, lte, or, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  analysts,
  catalysts,
  companies,
  companyQuotes,
  dailyMovers,
} from "@/db/schema";
import {
  DEFAULT_PER_PAGE,
  type FormOptions,
  type MoverFilters,
  type MoverRow,
  type SortDir,
  type SortKey,
} from "@/lib/movers";

/**
 * The price the post-event return is measured from: the entered report price if
 * there is one, otherwise the ASX close on the mover's own date.
 *
 * Both live on the mover row, so this is a plain read -- it used to be a
 * correlated subquery over a daily price series, which was ~2,000 stored rows to
 * serve 39 values once the fixed-window returns were removed.
 */
const anchorPriceSql = sql<number | null>`coalesce(
  ${dailyMovers.reportPrice}::float8,
  ${dailyMovers.moveDateClose}::float8
)`;

const SELECTION = {
  id: dailyMovers.id,
  moveDate: dailyMovers.moveDate,
  ticker: companies.ticker,
  companyName: companies.name,
  companyId: companies.id,
  catalystId: catalysts.id,
  catalystLabel: catalysts.label,
  movePct: dailyMovers.movePct,
  moveType: dailyMovers.moveType,
  moveWindowLabel: dailyMovers.moveWindowLabel,
  reasonForMove: dailyMovers.reasonForMove,
  mainTakeaway: dailyMovers.mainTakeaway,
  reportPrice: dailyMovers.reportPrice,
  reportUrl: dailyMovers.reportUrl,
  reportStoragePath: dailyMovers.reportStoragePath,
  analystId: analysts.id,
  analystName: analysts.name,

  // Performance side of the row. Prices, not a return: the percentage is derived
  // in `movers.ts` from these, so there's one copy of each figure.
  anchorPrice: anchorPriceSql,
  currentPrice: companyQuotes.price,
  currentPriceAt: companyQuotes.asOf,
};

/**
 * Filtering happens in SQL, not in the browser — client-side filtering looks
 * fine on 20 rows and quietly dies at a few thousand.
 */
function buildWhere(filters: MoverFilters) {
  const conditions = [];

  if (filters.q) {
    const term = `%${filters.q}%`;
    conditions.push(
      or(
        ilike(companies.name, term),
        ilike(companies.ticker, term),
        ilike(catalysts.label, term),
      ),
    );
  }
  if (filters.from) conditions.push(gte(dailyMovers.moveDate, filters.from));
  if (filters.to) conditions.push(lte(dailyMovers.moveDate, filters.to));
  if (filters.catalystId) {
    conditions.push(eq(dailyMovers.catalystId, filters.catalystId));
  }
  // Direction is derived from the sign, matching how it's displayed
  // (`directionOf` treats >= 0 as up; 0 is rejected at validation anyway).
  if (filters.direction === "down") conditions.push(lt(dailyMovers.movePct, 0));
  if (filters.direction === "up") conditions.push(gte(dailyMovers.movePct, 0));

  return conditions.length ? and(...conditions) : undefined;
}

function buildOrderBy(sort: SortKey = "date", dir: SortDir = "desc") {
  const direction = dir === "asc" ? asc : desc;
  switch (sort) {
    case "move":
      return [direction(dailyMovers.movePct), desc(dailyMovers.id)];
    case "ticker":
      return [direction(companies.ticker), desc(dailyMovers.moveDate)];
    case "company":
      return [direction(companies.name), desc(dailyMovers.moveDate)];
    case "date":
    default:
      // id as a tiebreaker so same-day rows have a stable order across pages.
      return [direction(dailyMovers.moveDate), desc(dailyMovers.id)];
  }
}

export async function listDailyMovers(filters: MoverFilters = {}): Promise<{
  rows: MoverRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
}> {
  const db = getDb();
  const perPage = filters.perPage ?? DEFAULT_PER_PAGE;
  const page = Math.max(1, filters.page ?? 1);
  const where = buildWhere(filters);

  const rows = await db
    .select(SELECTION)
    .from(dailyMovers)
    .innerJoin(companies, eq(dailyMovers.companyId, companies.id))
    .innerJoin(catalysts, eq(dailyMovers.catalystId, catalysts.id))
    .leftJoin(analysts, eq(dailyMovers.analystId, analysts.id))
    .leftJoin(companyQuotes, eq(companyQuotes.companyId, companies.id))
    .where(where)
    .orderBy(...buildOrderBy(filters.sort, filters.dir))
    .limit(perPage)
    .offset((page - 1) * perPage);

  const [totals] = await db
    .select({ value: count() })
    .from(dailyMovers)
    .innerJoin(companies, eq(dailyMovers.companyId, companies.id))
    .innerJoin(catalysts, eq(dailyMovers.catalystId, catalysts.id))
    .where(where);

  const total = totals?.value ?? 0;

  return {
    rows: rows as MoverRow[],
    total,
    page,
    perPage,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function getMoverById(id: number): Promise<MoverRow | null> {
  const db = getDb();
  const [row] = await db
    .select(SELECTION)
    .from(dailyMovers)
    .innerJoin(companies, eq(dailyMovers.companyId, companies.id))
    .innerJoin(catalysts, eq(dailyMovers.catalystId, catalysts.id))
    .leftJoin(analysts, eq(dailyMovers.analystId, analysts.id))
    .leftJoin(companyQuotes, eq(companyQuotes.companyId, companies.id))
    .where(eq(dailyMovers.id, id));
  return (row as MoverRow) ?? null;
}

/**
 * The whole point of the project: everything we've ever written on one company,
 * newest first. One query, because the FK to `companies` makes it one query.
 */
export async function getResearchHistory(ticker: string): Promise<{
  company: { id: number; ticker: string; name: string; sector: string | null };
  rows: MoverRow[];
} | null> {
  const db = getDb();
  const [company] = await db
    .select({
      id: companies.id,
      ticker: companies.ticker,
      name: companies.name,
      sector: companies.sector,
    })
    .from(companies)
    .where(ilike(companies.ticker, ticker));

  if (!company) return null;

  const rows = await db
    .select(SELECTION)
    .from(dailyMovers)
    .innerJoin(companies, eq(dailyMovers.companyId, companies.id))
    .innerJoin(catalysts, eq(dailyMovers.catalystId, catalysts.id))
    .leftJoin(analysts, eq(dailyMovers.analystId, analysts.id))
    .leftJoin(companyQuotes, eq(companyQuotes.companyId, companies.id))
    .where(eq(dailyMovers.companyId, company.id))
    .orderBy(desc(dailyMovers.moveDate), desc(dailyMovers.id));

  return { company, rows: rows as MoverRow[] };
}

export async function listCompaniesWithCounts() {
  const db = getDb();
  return db
    .select({
      id: companies.id,
      ticker: companies.ticker,
      name: companies.name,
      sector: companies.sector,
      moverCount: count(dailyMovers.id),
      lastMoveDate: sql<string | null>`max(${dailyMovers.moveDate})`,
    })
    .from(companies)
    .leftJoin(dailyMovers, eq(dailyMovers.companyId, companies.id))
    .groupBy(companies.id, companies.ticker, companies.name, companies.sector)
    .orderBy(
      sql`max(${dailyMovers.moveDate}) DESC NULLS LAST`,
      asc(companies.ticker),
    );
}

/** Lookups for the Add/Edit form. */
export async function getFormOptions(): Promise<FormOptions> {
  const db = getDb();
  const [companyRows, catalystRows, analystRows] = await Promise.all([
    db
      .select({ id: companies.id, ticker: companies.ticker, name: companies.name })
      .from(companies)
      .orderBy(asc(companies.ticker)),
    db
      .select({ id: catalysts.id, label: catalysts.label, slug: catalysts.slug })
      .from(catalysts)
      .orderBy(asc(catalysts.sortOrder)),
    db
      .select({ id: analysts.id, name: analysts.name })
      .from(analysts)
      .where(eq(analysts.active, true))
      .orderBy(asc(analysts.name)),
  ]);

  return {
    companies: companyRows,
    catalysts: catalystRows,
    analysts: analystRows,
  };
}

/**
 * How current the price data is, for the "as of" stamp above the table.
 *
 * Reads `refreshed_at` (last success) rather than `attempted_at`, because the
 * stamp answers "how old are these numbers", not "when did we last try".
 */
export async function getPriceFreshness(): Promise<{
  lastRefreshedAt: Date | null;
  tracked: number;
  priced: number;
  failing: number;
}> {
  const db = getDb();
  const [row] = await db
    .select({
      /**
       * Epoch milliseconds rather than the timestamp itself. Drizzle only maps
       * column references to `Date`; a raw aggregate like `max(...)` comes back
       * as the driver's own representation, so asking for a number and building
       * the `Date` here avoids depending on how a timestamp happens to be
       * serialised.
       */
      lastRefreshedMs: sql<
        number | null
      >`(extract(epoch from max(${companyQuotes.refreshedAt})) * 1000)::float8`,
      tracked: count(),
      priced: sql<number>`count(${companyQuotes.price})::int`,
      failing: sql<number>`count(${companyQuotes.error})::int`,
    })
    .from(companyQuotes);

  if (!row) return { lastRefreshedAt: null, tracked: 0, priced: 0, failing: 0 };

  const { lastRefreshedMs, ...counts } = row;
  return {
    ...counts,
    lastRefreshedAt:
      typeof lastRefreshedMs === "number" && Number.isFinite(lastRefreshedMs)
        ? new Date(lastRefreshedMs)
        : null,
  };
}

export async function getSummary() {
  const db = getDb();
  const [row] = await db
    .select({
      totalMovers: count(dailyMovers.id),
      companiesCovered: sql<number>`count(distinct ${dailyMovers.companyId})`,
    })
    .from(dailyMovers);
  return row ?? { totalMovers: 0, companiesCovered: 0 };
}
