import { CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AccuracyReview } from "@/lib/drafts/types";

/**
 * What the Accuracy Gate found, shown above the report it checked.
 *
 * The panel exists because the gate's value to a reviewer is not the rewrite —
 * it is knowing which figures were questioned and why. An analyst who can see
 * that the check traced every number to a filing reads the report differently
 * from one looking at an unverified draft, and both differ again from one told
 * that two claims were removed because they could not be confirmed.
 *
 * When `revised` is set, the findings describe the *first* draft: the PDF on the
 * row was written again to fix them. Saying so plainly matters — a list of
 * problems above a report that no longer has them reads as a warning otherwise.
 */
export function AccuracyPanel({ review }: { review: AccuracyReview }) {
  const blocking = review.findings.filter(
    (finding) => finding.severity === "blocking",
  );
  const advisory = review.findings.filter(
    (finding) => finding.severity === "advisory",
  );

  const clean = review.findings.length === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {clean ? (
            <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
          )}
          Accuracy gate
          {review.revised ? (
            <Badge
              variant="outline"
              className="border-emerald-500/20 bg-emerald-500/10 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
            >
              rewritten to fix these
            </Badge>
          ) : blocking.length > 0 ? (
            <Badge
              variant="outline"
              className="border-amber-500/20 bg-amber-500/10 text-[10px] font-medium text-amber-600 dark:text-amber-400"
            >
              {blocking.length} blocking
            </Badge>
          ) : null}
          <span className="ml-auto text-[11px] font-normal text-muted-foreground">
            {clean
              ? "no findings"
              : `${review.findings.length} finding${review.findings.length === 1 ? "" : "s"}`}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {review.summary ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {review.summary}
          </p>
        ) : null}

        {review.revised ? (
          <p className="rounded-lg border border-border/70 bg-muted/20 p-2.5 text-xs leading-relaxed text-muted-foreground">
            These findings are against the first draft. The report below was
            written again to correct them, so check the fixes landed rather than
            reading the list as outstanding problems.
          </p>
        ) : blocking.length > 0 ? (
          /**
           * The other half of the same question. A blocking list with no
           * rewrite is the ambiguous case — it could mean the fix was applied or
           * that nothing happened — so it says which, and the badge above
           * already carries the count.
           */
          <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs leading-relaxed text-muted-foreground">
            No automatic rewrite was run, so these stand against the report
            below. Fix them before publishing, or reject the draft.
          </p>
        ) : null}

        {clean ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            Every figure in the report was traced back to the filings.
          </p>
        ) : null}

        {[
          { label: "Blocking", findings: blocking },
          { label: "Advisory", findings: advisory },
        ]
          .filter((group) => group.findings.length > 0)
          .map((group) => (
            <div key={group.label} className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              {group.findings.map((finding, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border/70 bg-muted/20 p-2.5"
                >
                  <p className="mb-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span className="font-medium">{finding.category}</span>
                    {finding.page ? <span>· page {finding.page}</span> : null}
                  </p>
                  <p className="text-sm italic text-foreground/90">
                    “{finding.claim}”
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {finding.problem}
                  </p>
                  {finding.fix ? (
                    <p className="mt-1 text-xs leading-relaxed text-foreground/80">
                      <span className="font-medium">Fix: </span>
                      {finding.fix}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
