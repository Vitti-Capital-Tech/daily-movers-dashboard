"use client";

import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import { generatePostAction, type PostActionState } from "@/actions/posts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  type TrackRecordRow,
} from "@/lib/posts/types";
import { cn } from "@/lib/utils";

/**
 * The archive against today's price, newest first.
 *
 * Sorted by date rather than by return on purpose. Ranking by biggest gain
 * would read as a leaderboard of wins and quietly hide everything that went the
 * other way — which is the exact framing that turns a track record into a
 * misleading one. The whole archive is here, in publication order, and the
 * "Since" column is stated as a fact rather than a score.
 *
 * "Continued" likewise reports whether the price kept going the way it went on
 * the day, and nothing more. On this archive 31 of 56 movers reversed, and
 * several of those reversals are precisely what the note predicted — so the
 * judgement is left to the assessment, which reads the takeaway.
 */
export function TrackRecordTable({
  rows,
  counts,
  activePostId,
}: {
  rows: TrackRecordRow[];
  counts: Record<PostStatus, number>;
  activePostId: number | null;
}) {
  const [pendingMoverId, setPendingMoverId] = useState<number | null>(null);

  const [, formAction] = useActionState<PostActionState, FormData>(
    async (prev, formData) => {
      const result = await generatePostAction(prev, formData);
      setPendingMoverId(null);
      if (result?.ok) toast.success(result.message ?? "Drafted.");
      else if (result?.message) toast.error(result.message);
      return result;
    },
    null,
  );

  const assessed = rows.filter((row) => row.post).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          Track record
          <span className="font-normal text-muted-foreground">
            {rows.length} published movers · {assessed} assessed
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
      </CardHeader>

      <CardContent className="px-0 pb-2">
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
              {rows.map((row) => {
                const busy = pendingMoverId === row.moverId;
                const canDraft =
                  row.anchorPrice !== null && row.postEventReturn !== null;

                return (
                  <TableRow
                    key={row.moverId}
                    className={cn(
                      row.post && activePostId === row.post.id && "bg-accent/60",
                    )}
                  >
                    <TableCell className="pl-6">
                      <div className="font-mono text-xs font-semibold text-foreground">
                        {row.ticker}
                      </div>
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
                            href={`/post-studio?post=${row.post.id}`}
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

        {rows.length === 0 && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No published Daily Movers yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
