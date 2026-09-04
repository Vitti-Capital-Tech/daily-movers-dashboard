import { ArrowLeft, Megaphone, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DbNotConfigured } from "@/components/db-not-configured";
import { AssessmentHistory } from "@/components/post-studio/assessment-history";
import { PostReview } from "@/components/post-studio/post-review";
import { ReassessButton } from "@/components/post-studio/reassess-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isDbConfigured } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { pctChange } from "@/lib/movers";
import {
  getMoverForPost,
  getPostById,
  listAssessmentsForMover,
} from "@/lib/posts/queries";

/**
 * One drafted post, on its own page.
 *
 * Reached by clicking the ticker in the track record. A page rather than a
 * panel because reviewing copy is a reading task: two or three variants of
 * several hundred words each, plus the assessment they hang off, plus the note
 * they cite. That does not belong squeezed above a table, and it deserves a URL
 * — a reviewer sending "have a look at this one" to compliance needs a link.
 *
 * Admin only, checked here. Same reasoning as everywhere else in the two
 * Studios: hiding a nav link is not access control.
 */

export const dynamic = "force-dynamic";

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();

  if (!user.canWrite) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-6">
            <ShieldAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-foreground">
                This draft is admin only.
              </p>
              <p className="text-muted-foreground">
                It makes a performance claim on the firm&apos;s behalf and has
                not been through compliance review. Unlock admin mode from the
                sidebar to read it.
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
        <BackLink />
        <DbNotConfigured />
      </div>
    );
  }

  const { id } = await params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || postId <= 0) notFound();

  const post = await getPostById(postId);
  if (!post) notFound();

  /**
   * Today's return for the mover this post is about, so the panel can warn when
   * the copy's figures have drifted. Read from the mover rather than the stored
   * snapshot — that is the whole point of the comparison.
   */
  const [mover, assessments] = await Promise.all([
    getMoverForPost(post.moverId),
    listAssessmentsForMover(post.moverId),
  ]);
  const liveReturn = mover
    ? pctChange(mover.anchorPrice, mover.currentPrice)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink />
        <div className="flex items-center gap-3">
          <Link
            href={`/companies/${post.ticker}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            {post.ticker} research history →
          </Link>
          {/*
            Available for every verdict, not only the ones without copy. A
            `too_early` can become `validated` once the milestones the note
            named have happened, and a `validated` draft whose figures have
            drifted needs re-running before it can be posted -- which is what
            the drift warning inside the panel tells the reviewer to do.
          */}
          <ReassessButton moverId={post.moverId} />
        </div>
      </div>

      <PostReview post={post} liveReturn={liveReturn} />

      <AssessmentHistory assessments={assessments} currentId={post.id} />
    </div>
  );
}

function BackLink() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 pl-1.5 text-muted-foreground"
      render={<Link href="/post-studio" />}
    >
      <ArrowLeft className="size-3.5" />
      <Megaphone className="size-3.5" />
      Post Studio
    </Button>
  );
}
