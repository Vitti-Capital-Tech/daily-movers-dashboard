"use client";

import {
  Check,
  Copy,
  Quote,
  ThumbsDown,
  TriangleAlert,
  X,
} from "lucide-react";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import { setPostStatusAction, type PostActionState } from "@/actions/posts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  DRIFT_WARNING_POINTS,
  LINKEDIN_FOLD_CHARS,
  POST_COMPLIANCE_FOOTER,
  VERDICT_BLURBS,
  VERDICT_LABELS,
  fullPostText,
  returnDrift,
  type PostRow,
} from "@/lib/posts/types";
import { cn } from "@/lib/utils";

/**
 * The assessment, and the copy if there is any.
 *
 * The verdict is shown *above* the drafts and cannot be collapsed away, because
 * it is the thing a reviewer most needs and least wants to read. The quoted
 * clause from the note sits next to it so the claim can be checked against what
 * was actually written rather than against what it might have said.
 */
export function PostReview({
  post,
  liveReturn,
}: {
  post: PostRow;
  liveReturn: number | null;
}) {
  const [, statusAction, statusPending] = useActionState<
    PostActionState,
    FormData
  >(async (prev, formData) => {
    const result = await setPostStatusAction(prev, formData);
    if (result?.ok) toast.success(result.message ?? "Updated.");
    else if (result?.message) toast.error(result.message);
    return result;
  }, null);

  const drift = returnDrift(post.snapshot, liveReturn);
  const stale = drift !== null && Math.abs(drift) >= DRIFT_WARNING_POINTS;
  const validated = post.verdict === "validated";

  return (
    <Card className={cn(validated ? "" : "border-border/70")}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="font-mono">{post.ticker}</span>
              <span className="font-normal text-muted-foreground">
                {post.companyName}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  validated
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : post.verdict === "contradicted"
                      ? "border-destructive/20 bg-destructive/10 text-destructive"
                      : "border-border bg-muted text-muted-foreground",
                )}
              >
                {VERDICT_LABELS[post.verdict]}
              </Badge>
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Note published {post.moveDate}
              {post.snapshot
                ? ` · ${post.snapshot.postEventReturn >= 0 ? "+" : ""}${post.snapshot.postEventReturn.toFixed(2)}% over ${post.snapshot.daysSince} days`
                : ""}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {post.status !== "posted" && validated && (
              <form action={statusAction}>
                <input type="hidden" name="id" value={post.id} />
                <input type="hidden" name="status" value="posted" />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={statusPending}
                >
                  <Check className="size-3.5" />
                  Mark as posted
                </Button>
              </form>
            )}
            {post.status === "posted" && (
              <Badge
                variant="outline"
                className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                Posted
                {post.postedAt
                  ? ` ${post.postedAt.toISOString().slice(0, 10)}`
                  : ""}
              </Badge>
            )}
            {post.status !== "discarded" && (
              <form action={statusAction}>
                <input type="hidden" name="id" value={post.id} />
                <input type="hidden" name="status" value="discarded" />
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-muted-foreground"
                  disabled={statusPending}
                >
                  <X className="size-3.5" />
                  Discard
                </Button>
              </form>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* The assessment. Always first, never collapsible. */}
        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
          <p className="text-[11px] font-medium text-muted-foreground">
            Assessment
          </p>
          <p className="mt-1 text-sm text-foreground">
            {post.verdictReason || VERDICT_BLURBS[post.verdict]}
          </p>

          {post.evidenceQuote ? (
            <div className="mt-3 flex gap-2 border-t border-border/60 pt-2">
              <Quote className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                  From our own takeaway
                </p>
                <p className="text-xs italic text-foreground">
                  &ldquo;{post.evidenceQuote}&rdquo;
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {stale && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                The figures in this draft are out of date.
              </span>{" "}
              It was written when the return was{" "}
              {post.snapshot!.postEventReturn >= 0 ? "+" : ""}
              {post.snapshot!.postEventReturn.toFixed(2)}%; the live figure is
              now {liveReturn! >= 0 ? "+" : ""}
              {liveReturn!.toFixed(2)}% — a {drift! >= 0 ? "+" : ""}
              {drift!.toFixed(1)} point difference. Re-assess before posting
              rather than publishing a number that no longer holds.
            </p>
          </div>
        )}

        {validated ? (
          <>
            <Separator />
            <div className="space-y-4">
              {post.variants.map((variant, index) => (
                <PostVariantCard
                  key={index}
                  index={index}
                  angle={variant.angle}
                  text={variant.text}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-border/70 p-3">
            <ThumbsDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                No copy was drafted, deliberately.
              </span>{" "}
              {VERDICT_BLURBS[post.verdict]} A post claiming a call the note
              didn&apos;t make would be a misleading performance
              representation, so the generator only writes for calls that were
              borne out.
            </p>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/80">
          {post.model ? `${post.model} · ` : ""}
          {post.snapshot?.priceAsOf
            ? `priced as at ${post.snapshot.priceAsOf.slice(0, 10)} · `
            : ""}
          assessed {post.createdAt.toISOString().slice(0, 10)}
          {post.createdBy ? ` by ${post.createdBy}` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

function PostVariantCard({
  index,
  angle,
  text,
}: {
  index: number;
  angle: string;
  text: string;
}) {
  const [copied, setCopied] = useState(false);

  /** What actually goes to LinkedIn: the body plus the compliance footer. */
  const full = fullPostText(text);
  const hook = text.slice(0, LINKEDIN_FOLD_CHARS);
  const overFold = text.length > LINKEDIN_FOLD_CHARS;

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      toast.success("Copied with the compliance footer.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied in some contexts (insecure origin, or a
      // browser permission prompt the user dismissed). The text is on screen
      // and selectable, so this is a convenience failing, not the feature.
      toast.error("Could not copy — select the text and copy it manually.");
    }
  }

  return (
    <div className="rounded-lg border border-border/80">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Variant {index + 1}
          </span>
          <span className="text-xs font-medium text-foreground">{angle}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {full.length} chars
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs"
            onClick={copy}
          >
            {copied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            Copy
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {/*
          The hook is shown separately because LinkedIn hides everything past
          roughly 210 characters behind "…see more". A draft whose first two
          lines don't work is a draft nobody reads, and that is not obvious from
          a wall of text.
        */}
        {overFold && (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
              Above the fold
            </p>
            <p className="rounded bg-muted/50 p-2 text-xs leading-relaxed text-foreground">
              {hook}
              <span className="text-muted-foreground">… see more</span>
            </p>
          </div>
        )}

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {text}
        </p>

        <p className="whitespace-pre-wrap border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted-foreground">
          {POST_COMPLIANCE_FOOTER}
        </p>
      </div>
    </div>
  );
}
