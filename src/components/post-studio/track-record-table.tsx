"use client";

import { CheckCircle2, ChevronRight, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import { generatePostAction, type PostActionState } from "@/actions/posts";
import { ReassessButton } from "@/components/post-studio/reassess-button";
import { TablePagination } from "@/components/table-pagination";
import { TableSearch } from "@/components/table-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  POST_STATUS_LABELS,
  VERDICT_LABELS,
  type PostStatus,
  type TrackRecordAssessed,
  type TrackRecordRow,
} from "@/lib/posts/types";
import type { Paged } from "@/lib/table";
import { useQueryParams } from "@/lib/use-query-params";
import { cn } from "@/lib/utils";

/**
 * The archive against today's price.
 *
 * Sorted by publication date, not by return. Ranking by biggest gain would read
 * as a leaderboard of wins and push everything that went the other way onto the
 * last page — the exact framing that turns a track record into a misleading one.
 *
 * "Direction" reports whether the price kept going the way it went on the day,
 * and nothing more. On this archive 31 of 56 movers reversed, and several of
 * those reversals are precisely what the note predicted, so the judgement is
 * left to the assessment on the draft's own page.
 */
export function TrackRecordTable({
  page,
  counts,
  assessed,
}: {
  page: Paged<TrackRecordRow>;
  counts: Record<PostStatus, number>;
  assessed: TrackRecordAssessed;
}) {
  const { setParams } = useQueryParams();
  const [pendingMoverId, setPendingMoverId] = useState<number | null>(null);

  const [, formAction] = useActionState<PostActionState, FormData>(
    async (prev, formData) => {
      const result = await generatePostAction(prev, formData);
      setPendingMoverId(null);
      // A successful generate redirects to the new draft's page, so only the
      // failure path reaches here with a message worth showing.
      if (result?.message) toast.error(result.message);
      return result;
    },
    null,
  );

  return (
    <Card>
      <CardHeader className="gap-3 pb-3">
        <CardTitle className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          Track record
          <span className="font-normal text-muted-foreground">
            {page.total} published {page.total === 1 ? "mover" : "movers"}
          </span>
          <span className="ml-auto flex items-center gap-1.5 font-normal">
            {counts.posted > 0 && (
              <Badge
                variant="outline"
                className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                {counts.posted} posted
              </Badge>
            )}
            {counts.draft > 0 && (
              <Badge variant="outline">{counts.draft} draft</Badge>
            )}
          </span>
        </CardTitle>

        <div className="flex flex-wrap items-center gap-2">
          <TableSearch
            placeholder="Filter by ticker or company…"
            label="Filter the track record by ticker or company"
            className="w-full sm:max-w-xs"
          />
          <Select
            value={assessed}
            onValueChange={(value) =>
              setParams({ assessed: value === "all" ? null : value })
            }
          >
            <SelectTrigger size="sm" className="w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All movers</SelectItem>
              <SelectItem value="assessed">Assessed</SelectItem>
              <SelectItem value="unassessed">Not assessed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-0 pb-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Company</TableHead>
                <TableHead>Published</TableHead>
                <TableHead className="text-right">Move on day</TableHead>
                <TableHead className="text-right">At publication</TableHead>
                <TableHead className="text-right">Now</TableHead>
                <TableHead className="text-right">Since</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead className="pr-6 text-right">Post</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {page.rows.map((row) => {
                const busy = pendingMoverId === row.moverId;
                const canDraft =
                  row.anchorPrice !== null && row.postEventReturn !== null;
                const href = row.post ? `/post-studio/${row.post.id}` : null;

                return (
                  <TableRow key={row.moverId}>
                    <TableCell className="pl-6">
                      {/*
                        The ticker is the link to the draft. It is the thing a
                        reviewer looks for in the row, so it is what they click;
                        a row with nothing drafted yet leaves it plain rather
                        than offering a link to nowhere.
                      */}
                      {href ? (
                        <Link
                          href={href}
                          className="group inline-flex items-center gap-1"
                        >
                          <span className="font-mono text-xs font-semibold text-primary group-hover:underline">
                            {row.ticker}
                          </span>
                          <ChevronRight className="size-3 text-primary/60" />
                        </Link>
                      ) : (
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {row.ticker}
                        </span>
                      )}
                      <div className="max-w-[15rem] truncate text-[11px] text-muted-foreground">
                        {row.companyName}
                      </div>
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {row.moveDate}
                      <div className="text-[10px] text-muted-foreground/70">
                        {row.daysSince}d ago · {row.catalystLabel}
                      </div>
                    </TableCell>

                    <TableCell
                      className={cn(
                        "text-right font-mono text-xs",
                        row.movePct > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive",
                      )}
                    >
                      {row.movePct > 0 ? "+" : ""}
                      {row.movePct.toFixed(2)}%
                    </TableCell>

                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {row.anchorPrice !== null
                        ? `$${row.anchorPrice.toFixed(3)}`
                        : "—"}
                    </TableCell>

                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {row.currentPrice !== null
                        ? `$${row.currentPrice.toFixed(3)}`
                        : "—"}
                    </TableCell>

                    <TableCell
                      className={cn(
                        "text-right font-mono text-xs font-medium",
                        row.postEventReturn === null
                          ? "text-muted-foreground"
                          : row.postEventReturn >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-destructive",
                      )}
                    >
                      {row.postEventReturn === null
                        ? "—"
                        : `${row.postEventReturn >= 0 ? "+" : ""}${row.postEventReturn.toFixed(1)}%`}
                    </TableCell>

                    <TableCell className="text-[11px] text-muted-foreground">
                      {row.continued === null
                        ? "—"
                        : row.continued
                          ? "continued"
                          : "reversed"}
                    </TableCell>

                    <TableCell className="pr-6 text-right">
                      {row.post ? (
                        <div className="flex items-center justify-end gap-1.5">
                          {row.post.status === "posted" && (
                            <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                          )}
                          <Link
                            href={`/post-studio/${row.post.id}`}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            {row.post.verdict === "validated"
                              ? `${row.post.variantCount} draft${row.post.variantCount === 1 ? "" : "s"}`
                              : VERDICT_LABELS[row.post.verdict]}
                          </Link>
                          {row.post.status !== "draft" && (
                            <span className="text-[10px] text-muted-foreground">
                              {POST_STATUS_LABELS[row.post.status]}
                            </span>
                          )}
                          {/*
                            A verdict that produced no copy gets a way back in
                            from the row itself, because that is where the
                            reviewer notices the "Since" figure has moved on.
                            `too_early` in particular is a statement about the
                            date, not about the note. Validated rows are
                            re-assessed from the draft's own page instead, so a
                            stray click here can't spend a call on a call that
                            already worked.
                          */}
                          {row.post.verdict !== "validated" && (
                            <ReassessButton
                              moverId={row.moverId}
                              label="Re-assess"
                              variant="ghost"
                            />
                          )}
                        </div>
                      ) : (
                        <form
                          action={formAction}
                          onSubmit={() => setPendingMoverId(row.moverId)}
                        >
                          <input
                            type="hidden"
                            name="moverId"
                            value={row.moverId}
                          />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            disabled={busy || !canDraft}
                            title={
                              canDraft
                                ? "Assess this call and draft a post"
                                : "No publication or current price for this mover yet"
                            }
                          >
                            {busy ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Sparkles className="size-3" />
                            )}
                            Assess
                          </Button>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {page.rows.length === 0 && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            {page.total === 0
              ? "No published Daily Movers match this filter."
              : "Nothing on this page."}
          </p>
        )}

        <div className="px-6">
          <TablePagination
            page={page.page}
            pageCount={page.pageCount}
            perPage={page.perPage}
            total={page.total}
            noun="Movers"
          />
        </div>
      </CardContent>
    </Card>
  );
}
