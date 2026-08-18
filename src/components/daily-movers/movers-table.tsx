"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  FileSearch,
  FileText,
} from "lucide-react";

import { MoverRowActions } from "@/components/daily-movers/mover-row-actions";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  directionOf,
  formatMoveDate,
  formatPct,
} from "@/lib/format";
import {
  hasReport,
  reportHref,
  type FormOptions,
  type MoverRow,
  type SortDir,
  type SortKey,
} from "@/lib/movers";
import { useQueryParams } from "@/lib/use-query-params";
import { cn } from "@/lib/utils";
import { MOVE_TYPE_LABELS } from "@/lib/validation";

export function MoversTable({
  rows,
  options,
  sort,
  dir,
  canWrite,
}: {
  rows: MoverRow[];
  options: FormOptions;
  sort: SortKey;
  dir: SortDir;
  canWrite: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border/70 bg-card/40 px-6 py-16 text-center backdrop-blur-xs">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground mb-3">
          <FileSearch className="size-6" />
        </div>
        <p className="text-base font-semibold text-foreground">No Daily Movers found</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
          No research records match the selected filters. Try clearing your search or date range criteria.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card/50 shadow-xs backdrop-blur-xs">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/40 border-b border-border/60">
            <TableRow className="hover:bg-transparent">
              <SortableHead column="date" sort={sort} dir={dir}>
                Date
              </SortableHead>
              <SortableHead column="ticker" sort={sort} dir={dir}>
                Ticker
              </SortableHead>
              <SortableHead column="company" sort={sort} dir={dir}>
                Company Name
              </SortableHead>
              <TableHead className="font-semibold text-xs">Catalyst</TableHead>
              <SortableHead column="move" sort={sort} dir={dir} align="right">
                % Move
              </SortableHead>
              <TableHead className="font-semibold text-xs">Pricing Type</TableHead>
              <TableHead className="font-semibold text-xs">Covering Analyst</TableHead>
              <TableHead className="font-semibold text-xs">Documents</TableHead>
              {canWrite ? <TableHead className="w-10" /> : null}
            </TableRow>
          </TableHeader>

          <TableBody className="divide-y divide-border/40">
            {rows.map((row) => {
              const down = directionOf(row.movePct) === "down";

              return (
                <TableRow
                  key={row.id}
                  className="group hover:bg-accent/40 transition-colors"
                >
                  {/* Date Column */}
                  <TableCell className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                    {formatMoveDate(row.moveDate)}
                  </TableCell>

                  {/* Ticker Column */}
                  <TableCell>
                    <Link
                      href={`/companies/${row.ticker}`}
                      className="inline-flex items-center rounded-md border border-border/80 bg-background/80 px-2 py-0.5 font-mono text-xs font-bold text-foreground hover:border-primary/60 hover:bg-primary/5 hover:text-primary transition-all shadow-2xs"
                      title={`Open research timeline for ${row.ticker}`}
                    >
                      {row.ticker}
                    </Link>
                  </TableCell>

                  {/* Company Column */}
                  <TableCell className="max-w-[220px]">
                    <Link
                      href={`/companies/${row.ticker}`}
                      className="block truncate text-xs font-semibold text-foreground hover:text-primary hover:underline underline-offset-4 transition-colors"
                      title={row.companyName}
                    >
                      {row.companyName}
                    </Link>
                  </TableCell>

                  {/* Catalyst Badge */}
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className="font-normal text-[11px] bg-secondary/80 text-secondary-foreground border border-border/40 whitespace-nowrap"
                    >
                      {row.catalystLabel}
                    </Badge>
                  </TableCell>

                  {/* % Move Column */}
                  <TableCell className="text-right whitespace-nowrap">
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
                      <span>{formatPct(row.movePct)}</span>
                    </span>
                  </TableCell>

                  {/* Move Type */}
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/90">
                      {MOVE_TYPE_LABELS[row.moveType]}
                    </span>
                    {row.moveWindowLabel &&
                    row.moveWindowLabel !== MOVE_TYPE_LABELS[row.moveType] ? (
                      <span
                        className="ml-1 text-[11px] text-muted-foreground/80 italic"
                        title="Verbatim report wording"
                      >
                        ({row.moveWindowLabel})
                      </span>
                    ) : null}
                  </TableCell>

                  {/* Analyst */}
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {row.analystName ? (
                      <span className="inline-flex items-center gap-1.5 font-medium text-foreground/80">
                        <span className="size-1.5 rounded-full bg-primary/40" />
                        {row.analystName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </TableCell>

                  {/* Documents — one click to the PDF or the announcement */}
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <DocLink
                        href={hasReport(row) ? reportHref(row.id) : null}
                        label="Daily Mover report"
                        missingLabel="No report attached"
                      >
                        <FileText className="size-3.5" />
                        <span>Report</span>
                      </DocLink>

                      <DocLink
                        href={row.asxAnnouncementUrl}
                        label="Original ASX announcement"
                        missingLabel="No announcement link"
                      >
                        <ExternalLink className="size-3.5" />
                        <span>ASX</span>
                      </DocLink>
                    </div>
                  </TableCell>

                  {/* Row Actions */}
                  {canWrite ? (
                    <TableCell className="text-right">
                      <MoverRowActions row={row} options={options} />
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SortableHead({
  column,
  sort,
  dir,
  align = "left",
  children,
}: {
  column: SortKey;
  sort: SortKey;
  dir: SortDir;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const { setParams } = useQueryParams();
  const active = sort === column;
  const nextDir = active && dir === "desc" ? "asc" : "desc";

  return (
    <TableHead className={cn("text-xs font-semibold", align === "right" ? "text-right" : undefined)}>
      <button
        type="button"
        onClick={() => setParams({ sort: column, dir: nextDir })}
        className={cn(
          "inline-flex items-center gap-1.5 py-1 transition-colors hover:text-foreground group cursor-pointer",
          active ? "text-foreground font-bold" : "text-muted-foreground",
        )}
      >
        <span>{children}</span>
        <span
          aria-hidden
          className={cn(
            "text-[10px] leading-none transition-transform",
            active ? "text-primary opacity-100" : "opacity-40 group-hover:opacity-80",
          )}
        >
          {active ? (dir === "desc" ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </TableHead>
  );
}

/**
 * One document link. Renders as a disabled-looking chip when absent, so it's
 * visible at a glance which rows still need a report or announcement attached
 * rather than the column silently collapsing.
 */
function DocLink({
  href,
  label,
  missingLabel,
  children,
}: {
  href: string | null;
  label: string;
  missingLabel: string;
  children: React.ReactNode;
}) {
  const base =
    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap";

  if (!href) {
    return (
      <span
        className={cn(
          base,
          "border-border/40 text-muted-foreground/40 cursor-not-allowed",
        )}
        title={missingLabel}
        aria-disabled="true"
      >
        {children}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={label}
      className={cn(
        base,
        "border-border/80 bg-background/80 text-foreground/80 hover:border-primary/60 hover:bg-primary/5 hover:text-primary shadow-2xs",
      )}
    >
      {children}
    </a>
  );
}
