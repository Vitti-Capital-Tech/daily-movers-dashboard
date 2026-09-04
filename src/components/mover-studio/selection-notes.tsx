import { Quote } from "lucide-react";

import { formatMoneyCompact } from "@/lib/asx/types";
import type { DraftRow } from "@/lib/drafts/types";

/**
 * Why this company and not one of the other thirty-nine.
 *
 * Shown above the approve button rather than tucked away, because it is the
 * part of the draft a reviewer can actually check cheaply: whether the pick was
 * reasonable is a five-second judgement, where verifying the report's numbers
 * means opening the filings. The runners-up are listed for the same reason — an
 * analyst who disagrees with the pick can see immediately what the alternative
 * was.
 */
export function SelectionNotes({ draft }: { draft: DraftRow }) {
  const { selection, screen } = draft;

  return (
    <div className="space-y-3">
      {selection ? (
        <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
          <div className="flex items-center gap-1.5">
            <Quote className="size-3 text-muted-foreground" />
            <p className="text-[11px] font-medium text-muted-foreground">
              Why this one
            </p>
            <span className="ml-auto text-[10px] text-muted-foreground">
              confidence {selection.confidence}/5
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground">
            {selection.rationale}
          </p>

          {selection.runnerUps.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-border/60 pt-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                Passed over
              </p>
              {selection.runnerUps.map((runnerUp) => (
                <p key={runnerUp.ticker} className="text-xs text-muted-foreground">
                  <span className="font-mono font-medium text-foreground">
                    {runnerUp.ticker}
                  </span>{" "}
                  — {runnerUp.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {screen ? (
        <p className="text-[10px] text-muted-foreground/80">
          Screened{" "}
          {screen.boards[0]?.universeSize.toLocaleString() ?? "?"} listings ·{" "}
          {screen.boards
            .map((board) => `${board.rows.length} ${board.side}`)
            .join(", ")}{" "}
          passed · min {screen.criteria.minAbsChangePct}% on{" "}
          {formatMoneyCompact(screen.criteria.minTurnover)} turnover and{" "}
          {formatMoneyCompact(screen.criteria.minMarketCap)} market cap ·{" "}
          {screen.source}
        </p>
      ) : null}
    </div>
  );
}
