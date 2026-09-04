import Link from "next/link";
import { CircleCheck, CircleX, Loader2, TriangleAlert, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DRAFT_STATUS_LABELS,
  type DraftListItem,
  type DraftStatus,
} from "@/lib/drafts/types";
import { formatExchangeDateShort } from "@/lib/drafts/trading-day";
import { cn } from "@/lib/utils";

/**
 * The review queue.
 *
 * A server component: it renders links, not interactions, so there is nothing
 * here that needs to ship to the browser.
 */

const STATUS_ICON: Record<DraftStatus, typeof Clock> = {
  generating: Loader2,
  pending: Clock,
  approved: CircleCheck,
  rejected: CircleX,
  failed: TriangleAlert,
};

const STATUS_TONE: Record<DraftStatus, string> = {
  generating: "text-primary",
  pending: "text-amber-600 dark:text-amber-400",
  approved: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-muted-foreground",
  failed: "text-destructive",
};

export function DraftQueue({
  drafts,
  counts,
  activeId,
}: {
  drafts: DraftListItem[];
  counts: Record<DraftStatus, number>;
  activeId: number | null;
}) {
  return (
    <Card className="h-fit lg:sticky lg:top-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          Review queue
          {counts.pending > 0 && (
            <Badge
              variant="outline"
              className="border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400"
            >
              {counts.pending} awaiting
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-1 px-2 pb-3">
        {drafts.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Nothing drafted yet.
          </p>
        ) : (
          drafts.map((draft) => {
            const Icon = STATUS_ICON[draft.status];
            const active = draft.id === activeId;

            return (
              <Link
                key={draft.id}
                href={`/mover-studio?draft=${draft.id}`}
                className={cn(
                  "block rounded-lg px-2.5 py-2 transition-colors",
                  active
                    ? "bg-accent"
                    : "hover:bg-accent/60 focus-visible:bg-accent/60",
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className={cn(
                      "size-3.5 shrink-0",
                      STATUS_TONE[draft.status],
                      draft.status === "generating" && "animate-spin",
                    )}
                  />
                  <span className="font-mono text-xs font-semibold text-foreground">
                    {draft.ticker ?? "—"}
                  </span>
                  {draft.movePct !== null && (
                    <span
                      className={cn(
                        "font-mono text-xs",
                        draft.movePct > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive",
                      )}
                    >
                      {draft.movePct > 0 ? "+" : ""}
                      {draft.movePct.toFixed(2)}%
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {formatExchangeDateShort(draft.moveDate)}
                  </span>
                </div>

                <div className="mt-0.5 flex items-baseline gap-1.5 pl-5.5">
                  <span className="truncate text-[11px] text-muted-foreground">
                    {draft.status === "generating"
                      ? (draft.progress ?? DRAFT_STATUS_LABELS.generating)
                      : draft.status === "failed"
                        ? (draft.error ?? DRAFT_STATUS_LABELS.failed)
                        : (draft.companyName ??
                          DRAFT_STATUS_LABELS[draft.status])}
                  </span>
                  {draft.trigger === "manual" && (
                    <span className="shrink-0 text-[10px] text-muted-foreground/70">
                      manual
                    </span>
                  )}
                </div>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
