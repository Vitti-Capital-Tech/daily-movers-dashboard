import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CLOSING_SIGN_OFF,
  formatEyebrow,
  MANAGEMENT_QUESTION_HEADING,
  type ReportChart,
  type ReportDoc,
  type ReportPage,
} from "@/lib/report/types";

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

    case "chart":
      return (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            {page.title}
          </h3>
          {page.intro ? (
            <p className="text-sm text-muted-foreground">{page.intro}</p>
          ) : null}
          <ChartBlock chart={page.chart} />
          <p className="border-l-2 border-primary bg-muted/30 px-3 py-2 text-sm text-foreground">
            {page.conclusion}
          </p>
          <CalloutList callouts={page.callouts} />
        </div>
      );

    case "market-vs-reality":
      return (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            {page.title}
          </h3>
          {(
            [
              ["Headline", page.headline, "border-border"],
              ["Market focus", page.marketFocus, "border-muted-foreground/50"],
              ["What really matters", page.whatMatters, "border-primary"],
            ] as const
          ).map(([label, text, border]) => (
            <div key={label} className={`border-l-2 pl-3 ${border}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </p>
              <p className="text-sm leading-relaxed text-foreground">{text}</p>
            </div>
          ))}
        </div>
      );

    case "comparison":
      return (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            {page.title}
          </h3>
          {page.intro ? (
            <p className="text-sm text-muted-foreground">{page.intro}</p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 text-left font-medium">{page.columns[0]}</th>
                  <th className="py-1 text-right font-medium">{page.columns[1]}</th>
                  <th className="py-1 text-right font-medium">{page.columns[2]}</th>
                  <th className="py-1 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row, index) => (
                  <tr key={index} className="border-b border-border/60">
                    <td className="py-1.5 pr-2 text-foreground">{row.metric}</td>
                    <td className="py-1.5 text-right font-mono text-[12px] text-foreground/90">
                      {row.before}
                    </td>
                    <td className="py-1.5 text-right font-mono text-[12px] text-foreground/90">
                      {row.now}
                    </td>
                    <td
                      className={`py-1.5 text-right font-medium ${
                        row.direction === "better"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : row.direction === "worse"
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-foreground"
                      }`}
                    >
                      {row.change}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page.conclusion ? (
            <p className="border-l-2 border-primary bg-muted/30 px-3 py-2 text-sm text-foreground">
              {page.conclusion}
            </p>
          ) : null}
        </div>
      );

    case "vitti-view":
      return (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            {page.title}
          </h3>
          <div className="divide-y divide-border/60">
            {page.ratings.map((rating, index) => (
              <div
                key={index}
                className="flex flex-wrap items-baseline gap-x-3 py-1.5"
              >
                <span className="w-40 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {rating.label}
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {rating.value}
                </span>
                {rating.note ? (
                  <span className="text-xs text-muted-foreground">
                    {rating.note}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <CalloutList
            callouts={[
              { label: "Key debate", text: page.keyDebate },
              { label: "Next catalyst", text: page.nextCatalyst },
            ]}
          />
          <ManagementQuestion question={page.managementQuestion} />
        </div>
      );

    case "outlook":
      return (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            {page.title}
          </h3>
          {page.intro ? (
            <p className="text-sm text-muted-foreground">{page.intro}</p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                What would improve the story
              </p>
              <ul className="space-y-1">
                {page.improve.map((item, index) => (
                  <li key={index} className="text-sm text-foreground">
                    {`• ${item}`}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                What would make it worse
              </p>
              <ul className="space-y-1">
                {page.worsen.map((item, index) => (
                  <li key={index} className="text-sm text-foreground">
                    {`• ${item}`}
                  </li>
                ))}
              </ul>
            </div>
          </div>
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
          <ManagementQuestion question={page.managementQuestion} />
          {/* Appended by the renderer, so the preview shows it too. */}
          <p className="pt-1 text-sm font-semibold text-foreground">
            {CLOSING_SIGN_OFF}
          </p>
        </div>
      );
  }
}

/**
 * The chart, as CSS bars.
 *
 * Same two forms and the same zero baseline as the PDF — see `ColumnChart` in
 * `lib/report/template.tsx` for why the baseline matters. Rendered here rather
 * than embedding the PDF page so a reviewer can see whether the chart makes its
 * point before opening the typeset document.
 */
function ChartBlock({ chart }: { chart: ReportChart }) {
  const values = chart.points.map((point) => point.value);
  const maxPositive = Math.max(0, ...values);
  const maxNegative = Math.max(0, ...values.map((value) => -value));
  const span = maxPositive + maxNegative;
  if (span === 0) return null;

  if (chart.type === "bars") {
    const maxAbsolute = Math.max(...values.map(Math.abs));
    return (
      <div className="space-y-1.5">
        {chart.unit ? (
          <p className="text-[10px] text-muted-foreground">{chart.unit}</p>
        ) : null}
        {chart.points.map((point, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate text-xs text-foreground">
              {point.label}
            </span>
            <span className="h-3 flex-1 bg-muted">
              <span
                className={`block h-full ${
                  point.highlight
                    ? "bg-primary"
                    : point.value < 0
                      ? "bg-rose-500/70"
                      : "bg-muted-foreground/50"
                }`}
                style={{
                  width: `${Math.max(1, (Math.abs(point.value) / maxAbsolute) * 100)}%`,
                }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-xs text-foreground">
              {point.display?.trim() || point.value}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const plotHeight = 96;
  const positiveHeight = Math.round(plotHeight * (maxPositive / span));
  const negativeHeight = plotHeight - positiveHeight;

  return (
    <div>
      {chart.unit ? (
        <p className="mb-1 text-[10px] text-muted-foreground">{chart.unit}</p>
      ) : null}
      <div className="flex items-stretch gap-1">
        {chart.points.map((point, index) => {
          const colour = point.highlight
            ? "bg-primary"
            : point.value < 0
              ? "bg-rose-500/70"
              : "bg-muted-foreground/50";
          return (
            <div key={index} className="flex-1">
              <div
                className="flex flex-col justify-end"
                style={{ height: positiveHeight }}
              >
                {point.value > 0 ? (
                  <div
                    className={colour}
                    style={{
                      height: `${Math.max(2, (positiveHeight * point.value) / maxPositive)}px`,
                    }}
                  />
                ) : null}
              </div>
              <div className="h-px bg-muted-foreground/60" />
              <div style={{ height: negativeHeight }}>
                {point.value < 0 ? (
                  <div
                    className={colour}
                    style={{
                      height: `${Math.max(2, (negativeHeight * -point.value) / maxNegative)}px`,
                    }}
                  />
                ) : null}
              </div>
              <p className="mt-1 text-center font-mono text-[11px] font-medium text-foreground">
                {point.display?.trim() || point.value}
              </p>
              <p className="text-center text-[10px] text-muted-foreground">
                {point.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ManagementQuestion({ question }: { question?: string | null }) {
  if (!question?.trim()) return null;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {MANAGEMENT_QUESTION_HEADING}
      </p>
      <p className="text-sm text-foreground">{question}</p>
    </div>
  );
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
