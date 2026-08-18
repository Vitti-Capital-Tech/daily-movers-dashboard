import Link from "next/link";
import { notFound } from "next/navigation";

import { DbNotConfigured, DbUnreachable } from "@/components/db-not-configured";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { isDbConfigured } from "@/db";
import { describeDbError } from "@/lib/db-error";
import {
  arrowOf,
  directionOf,
  formatMoveDate,
  formatPct,
  formatPrice,
} from "@/lib/format";
import type { MoverRow } from "@/lib/movers";
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
    <div className="space-y-6">
      <div>
        <Link
          href="/daily-movers"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to Daily Movers
        </Link>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {company.name}
          </h1>
          <Badge variant="outline" className="font-mono">
            {company.ticker}
          </Badge>
          {company.sector ? (
            <span className="text-sm text-muted-foreground">
              {company.sector}
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length === 0
            ? "No Daily Movers saved for this company yet."
            : `${rows.length} Daily Mover${rows.length === 1 ? "" : "s"} — newest first. What did we say last time?`}
        </p>
      </div>

      {latest ? (
        <Card className="border-primary/40 bg-card/60">
          <CardContent className="py-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Most recent takeaway · {formatMoveDate(latest.moveDate)}
            </div>
            <p className="mt-2 text-sm leading-relaxed">
              {latest.mainTakeaway}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-4">
        {rows.map((row) => (
          <HistoryEntry key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function HistoryEntry({ row }: { row: MoverRow }) {
  const down = directionOf(row.movePct) === "down";
  const tone = down ? "text-red-400" : "text-emerald-400";

  return (
    <Card
      className={cn(
        "border-l-4",
        down ? "border-l-red-500/70" : "border-l-emerald-500/70",
      )}
    >
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-sm font-medium">
            {formatMoveDate(row.moveDate)}
          </span>

          <span
            className={cn(
              "rounded-md bg-muted px-2 py-0.5 text-sm font-semibold tabular-nums",
              tone,
            )}
          >
            <span aria-hidden className="mr-1">
              {arrowOf(row.movePct)}
            </span>
            {formatPct(row.movePct)}
          </span>

          <span className="text-xs text-muted-foreground">
            {MOVE_TYPE_LABELS[row.moveType]}
            {row.moveWindowLabel &&
            row.moveWindowLabel !== MOVE_TYPE_LABELS[row.moveType]
              ? ` (${row.moveWindowLabel})`
              : ""}
          </span>

          <Badge variant="secondary" className="font-normal">
            {row.catalystLabel}
          </Badge>

          <span className="ml-auto text-xs text-muted-foreground">
            {row.analystName ?? "Analyst not specified"}
          </span>
        </div>

        <Separator />

        <Detail label="Reason for move">{row.reasonForMove}</Detail>
        <Detail label="Main takeaway">{row.mainTakeaway}</Detail>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1 text-xs">
          <span className="text-muted-foreground">
            Report price:{" "}
            <span className="text-foreground tabular-nums">
              {formatPrice(row.reportPrice)}
            </span>
          </span>

          {row.reportUrl ? (
            <a
              href={row.reportUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              Open Daily Mover ↗
            </a>
          ) : (
            <span className="text-muted-foreground">No report link</span>
          )}

          {row.asxAnnouncementUrl ? (
            <a
              href={row.asxAnnouncementUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              Open ASX announcement ↗
            </a>
          ) : (
            <span className="text-muted-foreground">No announcement link</span>
          )}
        </div>
      </CardContent>
    </Card>
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
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <p className="text-sm leading-relaxed">{children}</p>
    </div>
  );
}
