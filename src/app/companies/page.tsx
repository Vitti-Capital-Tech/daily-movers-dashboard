import Link from "next/link";

import { DbNotConfigured, DbUnreachable } from "@/components/db-not-configured";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      <Heading />

      {companies.length === 0 ? (
        <div className="rounded-lg border border-border bg-card/40 px-6 py-16 text-center text-sm text-muted-foreground">
          No companies yet. Run <code>npm run db:seed</code> to add the samples.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Ticker</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead className="text-right">Daily Movers</TableHead>
                <TableHead>Last covered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>
                    <Link
                      href={`/companies/${company.ticker}`}
                      className="font-mono text-xs font-semibold underline-offset-4 hover:underline"
                    >
                      {company.ticker}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/companies/${company.ticker}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {company.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {company.sector ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {company.moverCount}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {company.lastMoveDate
                      ? formatMoveDate(company.lastMoveDate)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Heading() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every company we&apos;ve covered. Click through for its full research
        history.
      </p>
    </div>
  );
}
