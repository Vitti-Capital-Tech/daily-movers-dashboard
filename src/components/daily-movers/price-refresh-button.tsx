"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatQuoteTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The "as of" stamp, and for admins a button that fetches every tracked ticker
 * immediately.
 *
 * Prices already refresh on their own (see `PriceRefresher`), so this exists to
 * make that visible and to skip the wait when something just moved. The button
 * is admin-only: one click is a request per covered company against an external
 * provider.
 */
export function PriceRefreshButton({
  lastRefreshedAt,
  priced,
  failing,
  canWrite,
}: {
  lastRefreshedAt: Date | null;
  /** Companies with a usable price. */
  priced: number;
  /** Companies whose last fetch failed; their old price is still shown. */
  failing: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isFetching, setIsFetching] = useState(false);

  const busy = isFetching || isPending;
  const stamp = formatQuoteTime(lastRefreshedAt);

  async function refreshNow() {
    setIsFetching(true);
    try {
      const response = await fetch("/api/prices/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });

      if (response.status === 403) {
        toast.error("Your session no longer has write access. Reload and unlock admin again.");
        return;
      }

      const summary = (await response.json()) as {
        ok?: boolean;
        refreshed?: number;
        failed?: number;
      };

      if (!summary.ok) {
        toast.error("Could not reach the price provider. Check the server logs.");
        return;
      }

      const refreshed = summary.refreshed ?? 0;
      const failed = summary.failed ?? 0;

      toast.success(
        failed > 0
          ? `Updated ${refreshed} ${refreshed === 1 ? "company" : "companies"} — ${failed} failed.`
          : `Updated prices for ${refreshed} ${refreshed === 1 ? "company" : "companies"}.`,
      );

      // The table is server-rendered, so new prices only appear once the route
      // re-renders. Kept inside a transition so the button stays disabled until
      // the fresh rows are actually on screen.
      startTransition(() => router.refresh());
    } catch {
      toast.error("Refresh request failed. Are you online?");
    } finally {
      setIsFetching(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="whitespace-nowrap">
        {stamp ? (
          <>
            Prices as of <span className="font-medium text-foreground/80">{stamp}</span>
          </>
        ) : (
          "Prices not fetched yet"
        )}
        {failing > 0 ? (
          <span
            className="ml-1.5 text-amber-600 dark:text-amber-400"
            title={`${failing} ${failing === 1 ? "ticker" : "tickers"} could not be priced — the last known price is still shown`}
          >
            ({failing} failing)
          </span>
        ) : null}
      </span>

      {canWrite ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={refreshNow}
          disabled={busy}
          title={`Fetch the latest prices for all ${priced} tracked companies now`}
          className="h-7 gap-1.5 px-2 text-xs"
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          {busy ? "Refreshing…" : "Refresh prices"}
        </Button>
      ) : null}
    </div>
  );
}
