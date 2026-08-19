import "server-only";

import { and, asc, count, desc, eq, gte, ilike, lt, lte, or, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  analysts,
  catalysts,
  companies,
  companyPrices,
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
 * "Today" on the ASX. `company_prices.price_date` is an exchange-local date, so
 * comparing it against the database server's `current_date` (UTC on Supabase)
 * would open and close each return window ten hours early.
 */
const asxToday = sql`(now() at time zone 'Australia/Sydney')::date`;

/**
 * The price the post-event returns are measured from: the entered report price
 * if there is one, otherwise the close on the move date. The fallback is what
 * keeps the performance columns populated across the archive, since
 * `report_price` was manual entry and is null on most historical rows.
 *
 * `<=` rather than `=`: a move date can land on a day with no close of its own
 * (a halt, or a date recorded slightly off), and the previous close is the
 * honest answer there.
 */
const anchorPriceSql = sql<number | null>`coalesce(
  ${dailyMovers.reportPrice}::float8,
  (
    select p.close::float8
    from ${companyPrices} p
    where p.company_id = ${dailyMovers.companyId}
      and p.price_date <= ${dailyMovers.moveDate}
    order by p.price_date desc
    limit 1
  )
)`;

/**
 * The close ending a return window that starts at the move date -- the last one
 * on or before `move_date + interval`.
 *
 * Null until the window has actually elapsed. Without that guard, a mover
 * published three days ago would report its three-day move as a 1W return,
 * which reads as real rather than as not-yet-known.
 */
function windowCloseSql(interval: "7 days" | "1 month") {
  const boundary = sql`(${dailyMovers.moveDate} + ${sql.raw(`interval '${interval}'`)})::date`;

  return sql<number | null>`(
    case when ${boundary} <= ${asxToday} then (
      select p.close::float8
      from ${companyPrices} p
      where p.company_id = ${dailyMovers.companyId}
        and p.price_date >= ${dailyMovers.moveDate}
        and p.price_date <= ${boundary}
      order by p.price_date desc
      limit 1
    ) end
  )`;
}

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
  asxAnnouncementUrl: dailyMovers.asxAnnouncementUrl,
  analystId: analysts.id,
  analystName: analysts.name,
  status: dailyMovers.status,

  // Performance side of the row. Prices, not returns: the percentages are
  // derived in `movers.ts` from these, so there's one copy of each figure.
  anchorPrice: anchorPriceSql,
  currentPrice: companyQuotes.price,
  currentPriceAt: companyQuotes.asOf,
  price1w: windowCloseSql("7 days"),
  price1m: windowCloseSql("1 month"),
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
