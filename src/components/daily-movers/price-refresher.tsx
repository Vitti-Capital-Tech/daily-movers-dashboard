"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Asks the server to top up stale prices once the page is on screen, then
 * re-renders it if anything changed.
 *
 * Renders nothing. This runs after paint rather than during the server render
 * so the table appears immediately from stored data -- waiting on an upstream
 * provider before first byte would trade a fresh Current Price for a page that
 * feels broken.
 */
export function PriceRefresher() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const response = await fetch("/api/prices/refresh", { method: "POST" });
        if (!response.ok) return;

        const summary = (await response.json()) as { refreshed?: number };
        // Only re-render when there's something new to show; the common case is
        // prices already inside their TTL, and a needless refresh would reset
        // the row the user is reading.
        if (active && (summary.refreshed ?? 0) > 0) router.refresh();
      } catch {
        // Offline, or the request was aborted by a navigation. The page is
        // already usable with stored prices, so there's nothing to report.
      }
    }

    refresh();
    return () => {
      active = false;
    };
  }, [router]);

  return null;
}
