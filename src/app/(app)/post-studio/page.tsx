import { Megaphone, ShieldAlert } from "lucide-react";

import { DbNotConfigured, DbUnreachable } from "@/components/db-not-configured";
import { TrackRecordTable } from "@/components/post-studio/track-record-table";
import { Card, CardContent } from "@/components/ui/card";
import { isDbConfigured } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { describeDbError } from "@/lib/db-error";
import { getPostCounts, listTrackRecord } from "@/lib/posts/queries";
import type { TrackRecordAssessed } from "@/lib/posts/types";
import { parseTableParams } from "@/lib/table";

/**
 * Post Studio — the archive's track record, and LinkedIn copy drawn from it.
 *
 * Admin only, enforced here and not only in the sidebar. Same reasoning as
 * Mover Studio: a route is a public URL anyone can type, so hiding the nav link
 * is the courtesy half and this check is the control.
 *
 * A drafted post lives at `/post-studio/[id]` rather than in a panel above this
 * table: the copy is long, there are two or three variants of it, and a reviewer
 * reads it end to end before deciding — which is a page, not a sidebar.
 */

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ASSESSED_VALUES: TrackRecordAssessed[] = ["all", "assessed", "unassessed"];

export default async function PostStudioPage({
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
                Post Studio is admin only.
              </p>
              <p className="text-muted-foreground">
                Drafts here make performance claims on the firm&apos;s behalf and
                have not been through compliance review. Unlock admin mode from
                the sidebar to open them.
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
  const table = parseTableParams(params);

  const assessedRaw = Array.isArray(params.assessed)
    ? params.assessed[0]
    : params.assessed;
  const assessed = ASSESSED_VALUES.includes(assessedRaw as TrackRecordAssessed)
    ? (assessedRaw as TrackRecordAssessed)
    : "all";

  let page: Awaited<ReturnType<typeof listTrackRecord>>;
  let counts: Awaited<ReturnType<typeof getPostCounts>>;

  try {
    [page, counts] = await Promise.all([
      listTrackRecord({ ...table, assessed }),
      getPostCounts(),
    ]);
  } catch (error) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <DbUnreachable detail={describeDbError(error)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeading />

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 py-4">
          <ShieldAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              These are drafts, not approved marketing.
            </span>{" "}
            Every post here states a return, which makes it a past-performance
            representation published by a Corporate Authorised Representative
            under an AFSL. Read it against the note it cites, check the figures
            against the live price, and put it through your normal compliance
            review before it goes anywhere. The app never posts anything itself.
          </p>
        </CardContent>
      </Card>

      <TrackRecordTable
        page={page}
        counts={counts}
        assessed={assessed}
      />
    </div>
  );
}

function PageHeading() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <Megaphone className="size-5 text-primary" />
          Post Studio
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every published Daily Mover against today&apos;s price. Claude judges
          whether the note&apos;s view was borne out, and drafts LinkedIn copy
          for the ones that were.
        </p>
      </div>
    </div>
  );
}
