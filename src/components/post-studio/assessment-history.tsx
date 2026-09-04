import Link from "next/link";
import { History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { VERDICT_LABELS, type PostStatus, type PostVerdict } from "@/lib/posts/types";
import { cn } from "@/lib/utils";

/**
 * Earlier assessments of the same mover.
 *
 * Shown whenever there is more than one, and it is not decoration. A verdict
 * can legitimately change as time passes — "too early to say" becoming "borne
 * out" once the milestones the note named have actually happened — so a
 * reviewer needs to see that the sequence was a re-examination and not a
 * search for a favourable answer. Which return each verdict was made against
 * is the part that makes that judgeable.
 */
export function AssessmentHistory({
  assessments,
  currentId,
}: {
  assessments: {
    id: number;
    verdict: PostVerdict;
    status: PostStatus;
    variantCount: number;
    snapshotReturn: number | null;
    createdAt: Date;
  }[];
  currentId: number;
}) {
  if (assessments.length <= 1) return null;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex items-center gap-1.5">
        <History className="size-3 text-muted-foreground" />
        <p className="text-[11px] font-medium text-muted-foreground">
          {assessments.length} assessments of this call
        </p>
      </div>

      <ul className="mt-2 space-y-1">
        {assessments.map((item) => {
          const current = item.id === currentId;
          return (
            <li key={item.id} className="flex items-baseline gap-2 text-xs">
              <span className="w-20 shrink-0 font-mono text-[10px] text-muted-foreground">
                {item.createdAt.toISOString().slice(0, 10)}
              </span>

              {current ? (
                <span className="font-medium text-foreground">
                  {VERDICT_LABELS[item.verdict]}
                </span>
              ) : (
                <Link
                  href={`/post-studio/${item.id}`}
                  className="text-muted-foreground hover:text-foreground hover:underline"
                >
                  {VERDICT_LABELS[item.verdict]}
                </Link>
              )}

              {item.snapshotReturn !== null && (
                <span
                  className={cn(
                    "font-mono text-[10px]",
                    item.snapshotReturn >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive",
                  )}
                >
                  at {item.snapshotReturn >= 0 ? "+" : ""}
                  {item.snapshotReturn.toFixed(1)}%
                </span>
              )}

              {item.variantCount > 0 && (
                <span className="text-[10px] text-muted-foreground/70">
                  {item.variantCount} draft
                  {item.variantCount === 1 ? "" : "s"}
                </span>
              )}

              {item.status === "posted" && (
                <Badge
                  variant="outline"
                  className="border-emerald-500/20 bg-emerald-500/10 px-1.5 text-[9px] text-emerald-600 dark:text-emerald-400"
                >
                  posted
                </Badge>
              )}

              {current && (
                <span className="ml-auto text-[10px] text-muted-foreground/70">
                  showing
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
