"use client";

import Link from "next/link";

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
  arrowOf,
  directionOf,
  formatMoveDate,
  formatPct,
  upDownLabel,
} from "@/lib/format";
import type { FormOptions, MoverRow, SortDir, SortKey } from "@/lib/movers";
import { useQueryParams } from "@/lib/use-query-params";
import { cn } from "@/lib/utils";
import { MOVE_TYPE_LABELS } from "@/lib/validation";

export function MoversTable({
  rows,
  options,
  sort,
  dir,
}: {
  rows: MoverRow[];
  options: FormOptions;
  sort: SortKey;
  dir: SortDir;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/40 px-6 py-16 text-center">
        <p className="text-sm font-medium">No Daily Movers match those filters</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Clear the filters, or add a Daily Mover to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableHead column="date" sort={sort} dir={dir}>
              Date
            </SortableHead>
            <SortableHead column="ticker" sort={sort} dir={dir}>
              Ticker
            </SortableHead>
            <SortableHead column="company" sort={sort} dir={dir}>
              Company
            </SortableHead>
            <TableHead>Catalyst</TableHead>
            <TableHead>Move</TableHead>
            <TableHead className="text-center">Direction</TableHead>
            <SortableHead column="move" sort={sort} dir={dir} align="right">
              % Move
            </SortableHead>
            <TableHead>Move Type</TableHead>
            <TableHead>Analyst</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => {
            const down = directionOf(row.movePct) === "down";
            const tone = down ? "text-red-400" : "text-emerald-400";

            return (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatMoveDate(row.moveDate)}
                </TableCell>

                <TableCell>
                  <Link
                    href={`/companies/${row.ticker}`}
                    className="font-mono text-xs font-semibold underline-offset-4 hover:underline"
                    title={`Research history for ${row.ticker}`}
                  >
                    {row.ticker}
                  </Link>
                </TableCell>

                <TableCell className="max-w-[240px]">
                  <Link
                    href={`/companies/${row.ticker}`}
                    className="block truncate underline-offset-4 hover:underline"
                    title={row.companyName}
                  >
                    {row.companyName}
                  </Link>
                </TableCell>

                <TableCell>
                  <Badge variant="secondary" className="font-normal">
                    {row.catalystLabel}
                  </Badge>
                </TableCell>

                <TableCell className={cn("font-medium", tone)}>
                  {upDownLabel(row.movePct)}
                </TableCell>

                <TableCell className={cn("text-center text-base", tone)}>
                  <span aria-hidden>{arrowOf(row.movePct)}</span>
                  <span className="sr-only">{upDownLabel(row.movePct)}</span>
                </TableCell>

                <TableCell
                  className={cn(
                    "text-right font-medium tabular-nums whitespace-nowrap",
                    tone,
                  )}
                >
                  {formatPct(row.movePct)}
                </TableCell>

                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {MOVE_TYPE_LABELS[row.moveType]}
                  {row.moveWindowLabel &&
                  row.moveWindowLabel !== MOVE_TYPE_LABELS[row.moveType] ? (
                    <span
                      className="ml-1 text-xs"
                      title="Wording used in the report"
                    >
                      ({row.moveWindowLabel})
                    </span>
                  ) : null}
                </TableCell>

                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {row.analystName ?? "—"}
                </TableCell>

                <TableCell>
                  <MoverRowActions row={row} options={options} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
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
  // First click on a new column sorts descending — most recent / biggest first
  // is nearly always what you want here.
  const nextDir = active && dir === "desc" ? "asc" : "desc";

  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => setParams({ sort: column, dir: nextDir })}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          active ? "text-foreground" : undefined,
        )}
      >
        {children}
        <span aria-hidden className="text-[10px] leading-none">
          {active ? (dir === "desc" ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </TableHead>
  );
}
