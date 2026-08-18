import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";

import { DbNotConfigured, DbUnreachable } from "@/components/db-not-configured";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { isDbConfigured } from "@/db";
import { describeDbError } from "@/lib/db-error";
import { formatMoveDate } from "@/lib/format";
import { listCompaniesWithCounts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  if (!isDbConfigured()) {
    return (
      <div className="space-y-6">
        <Heading />
        <DbNotConfigured />
      </div>
    );
  }

  let companies: Awaited<ReturnType<typeof listCompaniesWithCounts>>;
  try {
    companies = await listCompaniesWithCounts();
  } catch (error) {
    return (
      <div className="space-y-6">
        <Heading />
        <DbUnreachable detail={describeDbError(error)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-border/40 pb-5">
        <Heading count={companies.length} />
      </div>

      {companies.length === 0 ? (
        <div className="rounded-xl border border-border/70 bg-card/40 px-6 py-16 text-center text-sm text-muted-foreground backdrop-blur-xs">
          No companies found. Run <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">npm run db:seed</code> to populate samples.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/50 shadow-xs backdrop-blur-xs">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40 border-b border-border/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-28 text-xs font-semibold">Ticker</TableHead>
                  <TableHead className="text-xs font-semibold">Company Name</TableHead>
                  <TableHead className="text-xs font-semibold">GICS Sector</TableHead>
                  <TableHead className="text-right text-xs font-semibold">Daily Movers</TableHead>
                  <TableHead className="text-xs font-semibold">Last Covered</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/40">
                {companies.map((company) => (
                  <TableRow
                    key={company.id}
                    className="group hover:bg-accent/40 transition-colors"
                  >
                    <TableCell>
                      <Link
                        href={`/companies/${company.ticker}`}
                        className="inline-flex items-center rounded-md border border-border/80 bg-background/80 px-2 py-0.5 font-mono text-xs font-bold text-foreground hover:border-primary/60 hover:text-primary transition-all shadow-2xs"
                      >
                        {company.ticker}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/companies/${company.ticker}`}
                        className="text-xs font-semibold text-foreground hover:text-primary transition-colors"
                      >
                        {company.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {company.sector ? (
                        <Badge
                          variant="outline"
                          className="text-[11px] font-normal border-border/60 bg-muted/30"
                        >
                          {company.sector}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground/60 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        <FileText className="size-3" />
                        {company.moverCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {company.lastMoveDate
                        ? formatMoveDate(company.lastMoveDate)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/companies/${company.ticker}`}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        title={`View ${company.ticker} timeline`}
                      >
                        <ChevronRight className="size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function Heading({ count }: { count?: number }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Company Directory
          </h1>
          {count !== undefined && (
            <Badge variant="secondary" className="text-xs font-medium">
              {count} covered
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Directory of all listed entities with recorded Daily Mover research history.
        </p>
      </div>
    </div>
  );
}
