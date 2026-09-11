"use client";

import {
  Check,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  approveDraftAction,
  regenerateDraftAction,
  rejectDraftAction,
  type DraftActionState,
} from "@/actions/drafts";
import { AccuracyPanel } from "@/components/mover-studio/accuracy-panel";
import { ReportPreview } from "@/components/mover-studio/report-preview";
import { SelectionNotes } from "@/components/mover-studio/selection-notes";
import { SourceList } from "@/components/mover-studio/source-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { REASON_MAX, TAKEAWAY_MAX } from "@/lib/validation";
import type { CatalystOption } from "@/lib/movers";
import {
  DRAFT_STATUS_LABELS,
  estimateDraftCostUsd,
  totalInputTokens,
  type DraftRow,
} from "@/lib/drafts/types";
import { formatExchangeDateShort } from "@/lib/drafts/trading-day";
import { cn } from "@/lib/utils";

/**
 * The review card: what Claude produced, and the two buttons that decide it.
 *
 * The archive fields are **editable before approval**, which is the important
 * design decision here. An analyst who spots a wrong catalyst or a weak takeaway
 * should be able to correct it and publish, rather than reject and hope the next
 * run happens to get it right — the model is drafting, the analyst is still the
 * author. What they submit is what gets filed.
 *
 * The report body is not editable: it is a rendered PDF, and a text box that
 * silently failed to change the document would be worse than no text box. A
 * report whose prose is wrong is a rejection.
 */
export function DraftReview({
  draft,
  catalysts,
}: {
  draft: DraftRow;
  catalysts: CatalystOption[];
}) {
  const [approveState, approveAction, approving] = useActionState<
    DraftActionState,
    FormData
  >(async (prev, formData) => {
    const result = await approveDraftAction(prev, formData);
    if (result?.ok) toast.success(result.message ?? "Published.");
    else if (result?.message) toast.error(result.message);
    return result;
  }, null);

  const [rejectState, rejectAction, rejecting] = useActionState<
    DraftActionState,
    FormData
  >(async (prev, formData) => {
    const result = await rejectDraftAction(prev, formData);
    if (result?.ok) toast.success(result.message ?? "Rejected.");
    else if (result?.message) toast.error(result.message);
    return result;
  }, null);

  const [showReject, setShowReject] = useState(false);

  /**
   * Regeneration is two clicks, not a dialog.
   *
   * It spends a couple of dollars of model time and adds a row to the queue, so
   * it should not be a single stray click on a card an analyst is reading — and
   * a confirm step that states the cost is more use than a modal that asks
   * "are you sure".
   */
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [regenerating, startRegenerate] = useTransition();

  const regenerate = () => {
    setConfirmRegenerate(false);
    startRegenerate(async () => {
      const result = await regenerateDraftAction(draft.id);
      if (result?.ok) toast.success(result.message ?? "Re-running.");
      else if (result?.message) toast.error(result.message);
    });
  };

  const busy = approving || rejecting;
  const decided = draft.status === "approved" || draft.status === "rejected";
  const cost = estimateDraftCostUsd(draft);
  /**
   * What a re-run would cost, priced at the CURRENT tier rather than the one
   * this draft was written on: the corpus is the bill and the same filings get
   * read again, so the source draft's own token counts are the best estimate
   * there is — and pricing them at today's rates is the number the analyst is
   * about to spend, not the one already spent.
   */
  const rerunCost = estimateDraftCostUsd({ ...draft, model: null });
  const costHint = rerunCost ? `${rerunCost.toFixed(2)}` : "a dollar or two";
  const tokensIn = totalInputTokens(draft);

  if (draft.status === "generating") {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Loader2 className="mx-auto mb-3 size-6 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">
            {draft.progress ?? "Working…"}
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
            Screening the board, reading the company&apos;s price-sensitive
            announcements and writing the report. This usually takes a few
            minutes — you can close this page and come back.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (draft.status === "failed") {
    return (
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TriangleAlert className="size-4 text-destructive" />
            Draft failed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-lg bg-destructive/5 p-3 text-sm text-foreground">
            {draft.error ?? "No reason was recorded."}
          </p>
          <p className="text-xs text-muted-foreground">
            Nothing was published. Adjust the screen settings above and draft
            again, or wait for tomorrow&apos;s scheduled run.
          </p>
          {draft.screen ? <SelectionNotes draft={draft} /> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-semibold tracking-tight text-foreground">
                  {draft.ticker}
                </span>
                {draft.movePct !== null && (
                  <span
                    className={cn(
                      "font-mono text-sm font-medium",
                      draft.movePct > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive",
                    )}
                  >
                    {draft.movePct > 0 ? "▲ +" : "▼ "}
                    {draft.movePct.toFixed(2)}%
                  </span>
                )}
                <StatusBadge draft={draft} />
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {draft.companyName}
                {draft.sector ? ` · ${draft.sector}` : ""} ·{" "}
                {formatExchangeDateShort(draft.moveDate)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {draft.hasPdf && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  render={
                    <a
                      href={`/api/drafts/${draft.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <FileText className="size-3.5" />
                  Open draft PDF
                  <ExternalLink className="size-3" />
                </Button>
              )}
              {draft.approvedMoverId && (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href="/daily-movers" />}
                >
                  View in archive
                </Button>
              )}
              <Button
                variant={confirmRegenerate ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                disabled={regenerating}
                onClick={
                  confirmRegenerate
                    ? regenerate
                    : () => setConfirmRegenerate(true)
                }
                onBlur={() => setConfirmRegenerate(false)}
                title="Re-run this draft through the current prompt, template and model"
              >
                {regenerating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {confirmRegenerate
                  ? `Confirm — spends about ${costHint}`
                  : "Regenerate"}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <SelectionNotes draft={draft} />

          <Separator />

          <form action={approveAction} className="space-y-4">
            <input type="hidden" name="id" value={draft.id} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="movePct" className="text-xs">
                  Share-price move (%)
                </Label>
                <Input
                  id="movePct"
                  name="movePct"
                  type="number"
                  step="0.01"
                  defaultValue={draft.movePct ?? ""}
                  disabled={decided}
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Signed — negative for a fall. Direction is derived from it.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="catalystSlug" className="text-xs">
                  Catalyst
                </Label>
                {/* A native select rather than the styled one: this form posts
                    as a plain FormData, and Base UI's Select needs a hidden
                    input to do the same thing. */}
                <select
                  id="catalystSlug"
                  name="catalystSlug"
                  defaultValue={draft.catalystSlug ?? "other"}
                  disabled={decided}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs disabled:opacity-60"
                >
                  {catalysts.map((catalyst) => (
                    <option key={catalyst.slug} value={catalyst.slug}>
                      {catalyst.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="moveType" className="text-xs">
                  Move window
                </Label>
                <select
                  id="moveType"
                  name="moveType"
                  defaultValue={draft.moveType ?? "intraday"}
                  disabled={decided}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs disabled:opacity-60"
                >
                  <option value="intraday">Intraday</option>
                  <option value="closing">Closing</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="moveWindowLabel" className="text-xs">
                  Window wording
                </Label>
                <Input
                  id="moveWindowLabel"
                  name="moveWindowLabel"
                  defaultValue={draft.moveWindowLabel ?? ""}
                  placeholder="Morning Trade"
                  maxLength={60}
                  disabled={decided}
                />
                <p className="text-[10px] text-muted-foreground">
                  As the report words it. Kept verbatim beside the mapped value.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reasonForMove" className="text-xs">
                Reason for move
              </Label>
              <Textarea
                id="reasonForMove"
                name="reasonForMove"
                defaultValue={draft.reasonForMove ?? ""}
                maxLength={REASON_MAX}
                rows={3}
                disabled={decided}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mainTakeaway" className="text-xs">
                Main takeaway
              </Label>
              <Textarea
                id="mainTakeaway"
                name="mainTakeaway"
                defaultValue={draft.mainTakeaway ?? ""}
                maxLength={TAKEAWAY_MAX}
                rows={3}
                disabled={decided}
              />
              <p className="text-[10px] text-muted-foreground">
                This is what the archive shows when the company comes up again.
              </p>
            </div>

            {!decided && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="submit" disabled={busy} className="gap-1.5">
                  {approving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Approve &amp; publish
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setShowReject((open) => !open)}
                  className="gap-1.5"
                >
                  <X className="size-4" />
                  Reject
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Approving files it in the archive and moves the PDF alongside
                  the manually uploaded reports.
                </p>
              </div>
            )}

            {approveState?.ok === false && approveState.message ? (
              <p className="text-xs text-destructive">{approveState.message}</p>
            ) : null}
          </form>

          {showReject && !decided && (
            <form
              action={rejectAction}
              className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3"
            >
              <input type="hidden" name="id" value={draft.id} />
              <Label htmlFor="reviewNote" className="text-xs">
                Why is this being rejected?
              </Label>
              <Textarea
                id="reviewNote"
                name="reviewNote"
                rows={2}
                placeholder="Wrong catalyst; the move was the index rebalance, not the contract win."
              />
              <p className="text-[10px] text-muted-foreground">
                Recorded on the draft. This is the most useful evidence there is
                for improving the prompt.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                >
                  {rejecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Confirm rejection
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReject(false)}
                >
                  Cancel
                </Button>
              </div>
              {rejectState?.ok === false && rejectState.message ? (
                <p className="text-xs text-destructive">
                  {rejectState.message}
                </p>
              ) : null}
            </form>
          )}

          {decided && draft.reviewNote ? (
            <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                Reviewer note
              </p>
              <p className="mt-1 text-sm text-foreground">{draft.reviewNote}</p>
            </div>
          ) : null}

          <p className="text-[10px] text-muted-foreground/80">
            {draft.model ? `${draft.model} · ` : ""}
            {tokensIn.toLocaleString()} in
            {draft.cacheReadTokens
              ? ` (${draft.cacheReadTokens.toLocaleString()} from cache)`
              : ""}{" "}
            / {draft.outputTokens?.toLocaleString() ?? "?"} out
            {cost !== null ? ` · ~US$${cost.toFixed(3)} estimated` : ""}
            {draft.trigger === "cron"
              ? " · scheduled run"
              : " · started manually"}
          </p>
        </CardContent>
      </Card>

      {draft.accuracy ? <AccuracyPanel review={draft.accuracy} /> : null}
      {draft.report ? <ReportPreview report={draft.report} /> : null}
      {draft.sources ? (
        <SourceList sources={draft.sources} cited={draft.report?.citedIdsIds} />
      ) : null}
    </div>
  );
}

function StatusBadge({ draft }: { draft: DraftRow }) {
  const tone =
    draft.status === "approved"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : draft.status === "rejected"
        ? "border-border bg-muted text-muted-foreground"
        : "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400";

  return (
    <Badge variant="outline" className={tone}>
      {DRAFT_STATUS_LABELS[draft.status]}
    </Badge>
  );
}
