import { DbNotConfigured, DbUnreachable } from "@/components/db-not-configured";
import { FilterBar } from "@/components/daily-movers/filter-bar";
import { MoverDialog } from "@/components/daily-movers/mover-dialog";
import { MoversTable } from "@/components/daily-movers/movers-table";
import { Pagination } from "@/components/daily-movers/pagination";
import { Card, CardContent } from "@/components/ui/card";
import { isDbConfigured } from "@/db";
import { describeDbError } from "@/lib/db-error";
import {
  DEFAULT_PER_PAGE,
  PER_PAGE_OPTIONS,
  SORT_KEYS,
  type MoverFilters,
  type SortDir,
  type SortKey,
} from "@/lib/movers";
import { getFormOptions, getSummary, listDailyMovers } from "@/lib/queries";

// Every render depends on searchParams + live data, so there's nothing to
// prerender at build time.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  const found = Array.isArray(value) ? value[0] : value;
  return found && found.trim() !== "" ? found.trim() : undefined;
}

function parseFilters(
  params: Record<string, string | string[] | undefined>,
): MoverFilters {
  const catalystRaw = one(params, "catalyst");
  const catalystId = catalystRaw ? Number(catalystRaw) : undefined;

  const directionRaw = one(params, "direction");
  const direction =
    directionRaw === "up" || directionRaw === "down" ? directionRaw : undefined;

  const sortRaw = one(params, "sort") as SortKey | undefined;
  const sort = sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : "date";

  const dirRaw = one(params, "dir");
  const dir: SortDir = dirRaw === "asc" ? "asc" : "desc";

  const perPageRaw = Number(one(params, "perPage"));
  const perPage = (PER_PAGE_OPTIONS as readonly number[]).includes(perPageRaw)
    ? perPageRaw
    : DEFAULT_PER_PAGE;

  const pageRaw = Number(one(params, "page"));

  return {
    q: one(params, "q"),
    from: one(params, "from"),
    to: one(params, "to"),
    catalystId:
      Number.isInteger(catalystId) && catalystId! > 0 ? catalystId : undefined,
    direction,
    sort,
    dir,
    page: Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1,
    perPage,
  };
}

export default async function DailyMoversPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  if (!isDbConfigured()) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <DbNotConfigured />
      </div>
    );
  }

  const filters = parseFilters(params);

  let result: Awaited<ReturnType<typeof listDailyMovers>>;
  let options: Awaited<ReturnType<typeof getFormOptions>>;
  let summary: Awaited<ReturnType<typeof getSummary>>;

  try {
    [result, options, summary] = await Promise.all([
      listDailyMovers(filters),
      getFormOptions(),
      getSummary(),
    ]);
  } catch (error) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <DbUnreachable detail={describeDbError(error)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeading />
        <MoverDialog options={options} mode="create" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Daily Movers saved" value={summary.totalMovers} />
        <SummaryCard
          label="Companies covered"
          value={summary.companiesCovered}
        />
        <SummaryCard label="Showing" value={result.total} suffix="results" />
      </div>

      <FilterBar catalysts={options.catalysts} />

      <MoversTable
        rows={result.rows}
        options={options}
        sort={filters.sort ?? "date"}
        dir={filters.dir ?? "desc"}
      />

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        perPage={result.perPage}
        total={result.total}
      />
    </div>
  );
}

function PageHeading() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Daily Movers</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Search, filter and review every Daily Mover we&apos;ve published.
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">
          {value}
          {suffix ? (
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">
              {suffix}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
