import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatEyebrow, type ReportDoc, type ReportPage } from "@/lib/report/types";

/**
 * The report, rendered inline from the same typed blocks the PDF is built from.
 *
 * Not an embedded PDF viewer. The PDF needs a signed URL that expires after a
 * minute, so an `<iframe>` would break on a page that has been open longer than
 * that — and the point of this panel is to let a reviewer read the whole report
 * without leaving the approve button. Rendering the blocks also means the text
 * is selectable and searchable in the browser, which a PDF frame is not.
 *
 * The "Open draft PDF" button remains for checking the typeset document.
 */
export function ReportPreview({
  report,
}: {
  report: ReportDoc & { citedIdsIds?: string[] };
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-baseline gap-2 text-sm">
          Report
          <span className="font-mono text-[10px] font-normal tracking-[0.15em] text-muted-foreground">
            {formatEyebrow(report.ticker)}
          </span>
          <span className="ml-auto font-normal text-muted-foreground">
            {report.pages.length} pages + disclaimer
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {report.pages.map((page, index) => (
          <section
            key={index}
            className="border-t border-border/60 pt-4 first:border-t-0 first:pt-0"
          >
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
              Page {index + 1} · {page.kind}
            </p>
            <PageBlock page={page} />
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function PageBlock({ page }: { page: ReportPage }) {
  switch (page.kind) {
    case "cover":
      return (
        <div className="space-y-3">
          <h3 className="text-xl font-semibold tracking-tight text-foreground">
            {page.companyName}
          </h3>
          <p className="text-sm font-medium text-foreground">{page.headline}</p>
          <KpiGrid kpis={page.kpis} />
        </div>
      );

    case "narrative":
      return (
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">
            {page.title}
          </h3>
          {page.intro ? (
            <p className="text-sm text-muted-foreground">{page.intro}</p>
          ) : null}
          {page.paragraphs.map((paragraph, index) => (
            <p key={index} className="text-sm leading-relaxed text-foreground">
              {paragraph}
            </p>
          ))}
          <CalloutList callouts={page.callouts} />
        </div>
      );

    case "kpis":
      return (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            {page.title}
          </h3>
          {page.intro ? (
            <p className="text-sm text-muted-foreground">{page.intro}</p>
          ) : null}
          <KpiGrid kpis={page.kpis} />
          {page.notes?.map((note, index) => (
            <p key={index} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
          <CalloutList callouts={page.callouts} />
        </div>
      );

    case "entities":
      return (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            {page.title}
          </h3>
          {page.intro ? (
            <p className="text-sm text-muted-foreground">{page.intro}</p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {page.items.map((item, index) => (
              <div
                key={index}
                className="rounded-lg border border-border/70 bg-muted/20 p-2.5"
              >
                <p className="text-sm font-medium text-foreground">
                  {item.name}
                </p>
                <p className="font-mono text-[11px] text-foreground/90">
                  {item.stat}
                </p>
                {item.comment ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.comment}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      );

    case "risks":
      return (
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">
            {page.title}
          </h3>
          {page.items.map((item, index) => (
            <div key={index}>
              <p className="text-sm font-medium text-foreground">
                {item.label}
              </p>
              <p className="text-xs text-muted-foreground">{item.text}</p>
            </div>
          ))}
        </div>
      );

    case "closing":
      return (
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">
            {page.title}
          </h3>
          {page.statements.map((statement, index) => (
            <p
              key={index}
              className="border-l-2 border-border pl-3 text-sm leading-relaxed text-foreground"
            >
              {statement}
            </p>
          ))}
        </div>
      );
  }
}

function KpiGrid({
  kpis,
}: {
  kpis: { value: string; label: string; note?: string | null }[];
}) {
  if (kpis.length === 0) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi, index) => (
        <div
          key={index}
          className="rounded-lg border-l-2 border-primary bg-muted/30 px-3 py-2"
        >
          <p className="font-mono text-lg font-semibold leading-tight text-foreground">
            {kpi.value}
          </p>
          <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
            {kpi.label}
          </p>
          {kpi.note ? (
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">
              {kpi.note}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CalloutList({
  callouts,
}: {
  callouts?: { label: string; text: string }[];
}) {
  if (!callouts?.length) return null;

  return (
    <div className="space-y-2 pt-1">
      {callouts.map((callout, index) => (
        <div key={index}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            {callout.label}
          </p>
          <p className="text-sm text-foreground">{callout.text}</p>
        </div>
      ))}
    </div>
  );
}
