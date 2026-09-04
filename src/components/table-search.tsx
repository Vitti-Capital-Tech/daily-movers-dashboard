"use client";

import { Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { useQueryParams } from "@/lib/use-query-params";
import { cn } from "@/lib/utils";

/**
 * The search box for every table in the app.
 *
 * Debounced, URL-backed, and stateless beyond the input's own text: the query
 * lives in `?q=`, so a filtered view is shareable and the back button works.
 * The Daily Movers archive keeps its own richer `FilterBar` (catalyst, dates,
 * direction alongside the text); this is the plain one for tables whose only
 * filter is text.
 */

/**
 * Long enough that typing "BHP" is one request rather than three, short enough
 * that the table feels live. Matches the archive's filter bar.
 */
const DEBOUNCE_MS = 300;

export function TableSearch({
  placeholder = "Search…",
  label = "Search",
  className,
}: {
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const { searchParams, setParams, pending } = useQueryParams();

  const urlQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQ);

  /**
   * Re-sync when the URL changes from outside this input — a cleared filter, a
   * back-button navigation, a shared link. Tracked against the last URL value
   * rather than in an effect so typing is never clobbered mid-keystroke.
   */
  const [lastUrlQ, setLastUrlQ] = useState(urlQ);
  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ);
    setQ(urlQ);
  }

  useEffect(() => {
    if (q === urlQ) return;
    const timer = setTimeout(() => setParams({ q: q || null }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, urlQ, setParams]);

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="bg-background/70 pl-8 pr-14 text-xs"
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {pending && (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        )}
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
