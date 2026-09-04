import { Sparkles, ShieldAlert } from "lucide-react";

import { DbNotConfigured, DbUnreachable } from "@/components/db-not-configured";
import { DraftPoller } from "@/components/mover-studio/draft-poller";
import { DraftQueue } from "@/components/mover-studio/draft-queue";
import { DraftReview } from "@/components/mover-studio/draft-review";
import { StartDraftForm } from "@/components/mover-studio/start-draft-form";
import { Card, CardContent } from "@/components/ui/card";
import { isDbConfigured } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { getFormOptions } from "@/lib/queries";
import { describeDbError } from "@/lib/db-error";
import {
  getDraftById,
  getDraftCounts,
  getFocusDraftId,
  listDrafts,
} from "@/lib/drafts/queries";
import { isDraftInFlight } from "@/lib/drafts/types";
import { exchangeDate } from "@/lib/drafts/trading-day";

/**
 * Mover Studio — the review queue for AI-drafted Daily Movers.
 *
 * Admin only, and enforced here rather than only in the sidebar. Hiding the nav
 * link is a courtesy; this check is the control, in the same spirit as the note
 * on `assertCanWrite` — a route is a public URL that anyone can type.
 *
 * Not a `redirect` for a viewer, but an explicit refusal: a viewer who follows a
 * shared link should be told the page is admin-only, not silently bounced to a
 * different page as though the link were broken.
 */

export const dynamic = "force-dynamic";

/**
 * Server Actions inherit the page's timeout, and one of them starts the
 * drafting pipeline. The work itself is handed to `after` so the action returns
 * in milliseconds — but the continuation runs on the same invocation's clock, so
 * the ceiling has to be the pipeline's, not a page render's.
 */
export const maxDuration = 800;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MoverStudioPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();

  if (!user.canWrite) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-6">
            <ShieldAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-foreground">
                Mover Studio is admin only.
              </p>
              <p className="text-muted-foreground">
                Drafts here are machine-written and unreviewed, so they are not
                Vitti research until an analyst approves them. Unlock admin mode
                from the sidebar to review the queue.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isDbConfigured()) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <DbNotConfigured />
      </div>
    );
  }

  const params = await searchParams;
  const requested = Number(
    Array.isArray(params.draft) ? params.draft[0] : params.draft,
  );

  let queue: Awaited<ReturnType<typeof listDrafts>>;
  let counts: Awaited<ReturnType<typeof getDraftCounts>>;
  let options: Awaited<ReturnType<typeof getFormOptions>>;
  let focusId: number | null;

  try {
    [queue, counts, options, focusId] = await Promise.all([
      listDrafts({ limit: 30 }),
      getDraftCounts(),
      getFormOptions(),
      Number.isInteger(requested) && requested > 0
        ? Promise.resolve(requested)
        : getFocusDraftId(),
    ]);
  } catch (error) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <DbUnreachable detail={describeDbError(error)} />
      </div>
    );
  }

  const draft = focusId ? await getDraftById(focusId) : null;

  return (
    <div className="space-y-6">
      <PageHeading />

      {/* Only mounted while something is actually running, so a settled queue
          issues no background traffic at all. */}
      {draft && isDraftInFlight(draft.status) ? (
        <DraftPoller draftId={draft.id} />
      ) : null}

      <StartDraftForm today={exchangeDate()} />

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <DraftQueue
          drafts={queue}
          counts={counts}
          activeId={draft?.id ?? null}
        />

        {draft ? (
          <DraftReview draft={draft} catalysts={options.catalysts} />
        ) : (
          <Card>
            <CardContent className="py-16 text-center">
              <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <p className="text-sm font-medium text-foreground">
                No drafts yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                One is drafted automatically each weekday at 12:30 Sydney time,
                unless a Daily Mover for the day is already in the archive.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function PageHeading() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <Sparkles className="size-5 text-primary" />
          Mover Studio
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Claude screens both sides of the board, reads the company&apos;s
          price-sensitive announcements, and drafts a Daily Mover for approval.
        </p>
      </div>
    </div>
  );
}
