import { Megaphone, ShieldAlert } from "lucide-react";

import { DbNotConfigured, DbUnreachable } from "@/components/db-not-configured";
import { PostReview } from "@/components/post-studio/post-review";
import { TrackRecordTable } from "@/components/post-studio/track-record-table";
import { Card, CardContent } from "@/components/ui/card";
import { isDbConfigured } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { describeDbError } from "@/lib/db-error";
import {
  getPostById,
  getPostCounts,
  listTrackRecord,
} from "@/lib/posts/queries";

/**
 * Post Studio — the archive's track record, and LinkedIn copy drawn from it.
 *
 * Admin only, enforced here and not only in the sidebar. Same reasoning as
 * Mover Studio: a route is a public URL anyone can type, so hiding the nav link
 * is the courtesy half and this check is the control.
 */

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
  const requested = Number(
    Array.isArray(params.post) ? params.post[0] : params.post,
  );

  let rows: Awaited<ReturnType<typeof listTrackRecord>>;
  let counts: Awaited<ReturnType<typeof getPostCounts>>;

  try {
    [rows, counts] = await Promise.all([listTrackRecord(), getPostCounts()]);
  } catch (error) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <DbUnreachable detail={describeDbError(error)} />
      </div>
    );
  }

  const post =
    Number.isInteger(requested) && requested > 0
      ? await getPostById(requested)
      : null;

  /**
   * The live return for the mover this post is about, so the panel can warn
   * when the draft's numbers have drifted away from today's figure.
   */
  const liveReturn = post
    ? (rows.find((row) => row.moverId === post.moverId)?.postEventReturn ?? null)
    : null;

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

      {post ? (
        <PostReview post={post} liveReturn={liveReturn} />
      ) : null}

      <TrackRecordTable rows={rows} counts={counts} activePostId={post?.id ?? null} />
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
