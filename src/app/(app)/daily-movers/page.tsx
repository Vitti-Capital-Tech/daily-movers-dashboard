import { FileText, Building2, Layers, Sparkles } from "lucide-react";

import { DbNotConfigured, DbUnreachable } from "@/components/db-not-configured";
import { FilterBar } from "@/components/daily-movers/filter-bar";
import { MoverDialog } from "@/components/daily-movers/mover-dialog";
import { MoversTable } from "@/components/daily-movers/movers-table";
import { Pagination } from "@/components/daily-movers/pagination";
import { Card, CardContent } from "@/components/ui/card";
import { isDbConfigured } from "@/db";
import { getSessionUser } from "@/lib/auth";
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

  const user = await getSessionUser();

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
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-5">
        <PageHeading />
        {user.canWrite ? <MoverDialog options={options} mode="create" /> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Research Published"
          value={summary.totalMovers}
          icon={<FileText className="size-4 text-sky-500" />}
          gradient="from-sky-500/10 via-transparent to-transparent"
        />
        <SummaryCard
          label="Companies Covered"
          value={summary.companiesCovered}
          icon={<Building2 className="size-4 text-emerald-500" />}
          gradient="from-emerald-500/10 via-transparent to-transparent"
        />
        <SummaryCard
          label="Filtered Results"
          value={result.total}
          suffix="entries"
          icon={<Layers className="size-4 text-purple-500" />}
          gradient="from-purple-500/10 via-transparent to-transparent"
        />
      </div>

      <FilterBar catalysts={options.catalysts} />

      <MoversTable
        rows={result.rows}
        options={options}
        sort={filters.sort ?? "date"}
        dir={filters.dir ?? "desc"}
        canWrite={user.canWrite}
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
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Daily Movers
        </h1>
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary border border-primary/20">
          <Sparkles className="size-3" />
          Live Archive
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Search, filter and analyze historical share price catalyst intelligence.
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  suffix,
  icon,
  gradient,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon: React.ReactNode;
  gradient?: string;
}) {
  return (
    <Card className={`relative overflow-hidden border-border/60 bg-gradient-to-br ${gradient} backdrop-blur-xs transition-all hover:border-border`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <div className="flex size-8 items-center justify-center rounded-md bg-background/80 shadow-xs border border-border/40">
            {icon}
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
            {value}
          </span>
          {suffix ? (
            <span className="text-xs font-medium text-muted-foreground">
              {suffix}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
