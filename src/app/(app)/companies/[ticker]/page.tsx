import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  FileText,
  Calendar,
  Sparkles,
  Quote,
} from "lucide-react";

import { CompanyLogo } from "@/components/company-logo";
import { DbNotConfigured, DbUnreachable } from "@/components/db-not-configured";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { isDbConfigured } from "@/db";
import { describeDbError } from "@/lib/db-error";
import {
  directionOf,
  formatMoveDate,
  formatPct,
  formatPrice,
} from "@/lib/format";
import { hasReport, reportHref, type MoverRow } from "@/lib/movers";
import { getResearchHistory } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { MOVE_TYPE_LABELS } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function ResearchHistoryPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;

  if (!isDbConfigured()) {
    return <DbNotConfigured />;
  }

  let history: Awaited<ReturnType<typeof getResearchHistory>>;
  try {
    history = await getResearchHistory(decodeURIComponent(ticker));
  } catch (error) {
    return <DbUnreachable detail={describeDbError(error)} />;
  }
  if (!history) notFound();

  const { company, rows } = history;
  const latest = rows[0];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header & Back Navigation */}
      <div>
        <Link
          href="/daily-movers"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-3 group"
        >
          <ArrowLeft className="size-3.5 group-hover:-translate-x-0.5 transition-transform" />
          <span>Back to Daily Movers</span>
        </Link>

        <div className="flex items-start gap-4">
          <CompanyLogo ticker={company.ticker} name={company.name} size="lg" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {company.name}
              </h1>
              <Badge variant="outline" className="font-mono text-xs font-bold px-2 py-0.5 border-border/80 bg-muted/40">
                {company.ticker}
              </Badge>
              {company.sector ? (
                <Badge variant="secondary" className="text-xs font-normal">
                  {company.sector}
                </Badge>
              ) : null}
            </div>

            <p className="mt-1.5 text-xs text-muted-foreground">
              {rows.length === 0
                ? "No Daily Movers saved for this company yet."
                : `Chronological archive of ${rows.length} research note${rows.length === 1 ? "" : "s"} — newest first.`}
            </p>
          </div>
        </div>
      </div>

      {/* Hero Card: Latest Takeaway */}
      {latest ? (
        <Card className="relative overflow-hidden border-primary/40 bg-gradient-to-br from-primary/5 via-card to-card shadow-sm backdrop-blur-xs">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-2 border-b border-primary/20 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Sparkles className="size-3.5" />
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  Most Recent Investment Takeaway
                </span>
              </div>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="size-3" />
                {formatMoveDate(latest.moveDate)}
              </span>
            </div>
            <div className="relative pl-6">
              <Quote className="absolute left-0 top-0 size-4 text-primary/40" />
              <p className="text-sm font-medium leading-relaxed text-foreground/95">
                {latest.mainTakeaway}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Research Timeline */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <FileText className="size-3.5" />
          <span>Research History Timeline</span>
        </div>

        <div className="relative border-l-2 border-border/80 pl-6 ml-3 space-y-6">
          {rows.map((row) => (
            <HistoryEntry key={row.id} row={row} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HistoryEntry({ row }: { row: MoverRow }) {
  const down = directionOf(row.movePct) === "down";

  return (
    <div className="relative">
      {/* Timeline Node Icon */}
      <div
        className={cn(
          "absolute -left-[31px] top-4 flex size-4 items-center justify-center rounded-full border-2 bg-background",
          down ? "border-rose-500" : "border-emerald-500",
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            down ? "bg-rose-500" : "bg-emerald-500",
          )}
        />
      </div>

      <Card
        className={cn(
          "border-border/70 bg-card/60 backdrop-blur-xs transition-all hover:border-border shadow-xs",
          down ? "border-l-4 border-l-rose-500" : "border-l-4 border-l-emerald-500",
        )}
      >
        <CardContent className="space-y-4 p-5">
          {/* Note Metadata Bar */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Calendar className="size-3.5 text-muted-foreground" />
              {formatMoveDate(row.moveDate)}
            </span>

            {/* % Move Badge */}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums border",
                down
                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
              )}
            >
              {down ? (
                <ArrowDownRight className="size-3.5" />
              ) : (
                <ArrowUpRight className="size-3.5" />
              )}
              {formatPct(row.movePct)}
            </span>

            <span className="text-xs text-muted-foreground">
              {MOVE_TYPE_LABELS[row.moveType]}
              {row.moveWindowLabel &&
              row.moveWindowLabel !== MOVE_TYPE_LABELS[row.moveType]
                ? ` (${row.moveWindowLabel})`
                : ""}
            </span>

            <Badge variant="secondary" className="font-normal text-[11px]">
              {row.catalystLabel}
            </Badge>

            <span className="ml-auto text-xs text-muted-foreground font-medium">
              {row.analystName ? `Analyst: ${row.analystName}` : "Analyst not specified"}
            </span>
          </div>

          <Separator className="bg-border/60" />

          {/* Research Details */}
          <Detail label="Reason for Move">{row.reasonForMove}</Detail>
          <Detail label="Main Takeaway">{row.mainTakeaway}</Detail>

          {/* External Links & Pricing */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-xs border-t border-border/40">
            <span className="text-muted-foreground">
              Report Share Price:{" "}
              <span className="font-bold text-foreground tabular-nums">
                {formatPrice(row.reportPrice)}
              </span>
            </span>

            {/* Always via /api/reports/[id]: it checks the session, then signs a
                60-second URL for the private bucket. Works for an uploaded PDF
                and for an external link. */}
            {hasReport(row) ? (
              <a
                href={reportHref(row.id)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline underline-offset-4"
              >
                <span>Open Daily Mover PDF</span>
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="text-muted-foreground/60">No PDF attached</span>
            )}

            {row.asxAnnouncementUrl ? (
              <a
                href={row.asxAnnouncementUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline underline-offset-4"
              >
                <span>Open ASX Announcement</span>
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="text-muted-foreground/60">No announcement link</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <p className="text-xs sm:text-sm leading-relaxed text-foreground">{children}</p>
    </div>
  );
}
