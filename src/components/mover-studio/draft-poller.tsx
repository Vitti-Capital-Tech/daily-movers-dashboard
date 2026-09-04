"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the page while a draft is generating.
 *
 * Polling rather than streaming the action's progress, because the pipeline
 * outlives the request that started it: the row in `mover_drafts` is the state,
 * so a reload, a second tab, or an analyst opening the queue ten minutes later
 * all rejoin the same run. A streamed response would only be visible to the tab
 * that happened to click the button.
 *
 * Renders nothing. Mounted only when a draft is actually in flight — see the
 * conditional in the page — so a settled queue makes no background requests.
 */

/**
 * Six seconds. The pipeline's stages are tens of seconds to minutes long, so
 * faster polling would re-render the page repeatedly to show the same stage,
 * and each poll is a full server render of the queue.
 */
const POLL_INTERVAL_MS = 6_000;

/**
 * Stop after twenty minutes. A run that has not finished by then has almost
 * certainly been killed mid-invocation, and `reapStaleGenerating` is what
 * resolves that — polling forever would just keep a dead tab busy.
 */
const MAX_POLL_MS = 20 * 60 * 1000;

export function DraftPoller({ draftId }: { draftId: number }) {
  const router = useRouter();

  useEffect(() => {
    const startedAt = Date.now();

    const timer = setInterval(() => {
      if (Date.now() - startedAt > MAX_POLL_MS) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
    // `draftId` is in the deps so switching to a different in-flight draft
    // restarts the clock rather than inheriting the previous one's deadline.
  }, [router, draftId]);

  return null;
}
