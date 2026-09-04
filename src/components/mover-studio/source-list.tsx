import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DraftSource, DraftSources } from "@/lib/drafts/types";
import { cn } from "@/lib/utils";

/**
 * The audit trail: every announcement the draft was built from.
 *
 * This is what makes an AI-written note reviewable rather than merely readable.
 * Each row links to the ASX filing itself, and the ones the report actually
 * drew a fact from are marked — so checking a suspicious number is one click,
 * not a search. Without this the reviewer's only options would be to trust the
 * draft or re-do its research.
 */
export function SourceList({
  sources,
  cited,
}: {
  sources: DraftSources;
  cited?: string[];
}) {
  const citedSet = new Set(cited ?? []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          Evidence
          <span className="ml-2 font-normal text-muted-foreground">
            {sources.readToday + sources.readHistory} of{" "}
            {sources.today.length + sources.history.length} announcements read
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <Group
          label="Released on the move date"
          items={sources.today}
          citedSet={citedSet}
        />
        <Group
          label="Earlier price-sensitive announcements"
          items={sources.history}
          citedSet={citedSet}
        />

        {sources.readToday + sources.readHistory <
        sources.today.length + sources.history.length ? (
          <p className="text-[10px] text-muted-foreground/80">
            Announcements that couldn&apos;t be read — withdrawn documents, or
            scans with no extractable text — were skipped rather than failing the
            draft.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Group({
  label,
  items,
  citedSet,
}: {
  label: string;
  items: DraftSource[];
  citedSet: Set<string>;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </p>
      <ul className="divide-y divide-border/60">
        {items.map((item) => {
          const wasCited = citedSet.has(item.idsId);
          return (
            <li key={item.idsId} className="flex items-baseline gap-2 py-1.5">
              <span className="w-20 shrink-0 font-mono text-[10px] text-muted-foreground">
                {item.date}
              </span>
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "group flex min-w-0 flex-1 items-baseline gap-1 text-xs hover:underline",
                  wasCited ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="truncate">{item.headline}</span>
                <ExternalLink className="size-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
              </a>
              {wasCited && (
                <Badge
                  variant="outline"
                  className="shrink-0 border-primary/20 bg-primary/5 px-1.5 text-[9px] text-primary"
                >
                  cited
                </Badge>
              )}
              {item.pageCount ? (
                <span className="w-12 shrink-0 text-right text-[10px] text-muted-foreground/70">
                  {item.pageCount}pp
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
