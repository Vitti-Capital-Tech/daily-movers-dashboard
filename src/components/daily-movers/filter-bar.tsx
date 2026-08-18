"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryParams } from "@/lib/use-query-params";

/** Radix Select can't hold an empty string, so "all" is the no-filter value. */
const ALL = "all";

export function FilterBar({
  catalysts,
}: {
  catalysts: { id: number; label: string }[];
}) {
  const { searchParams, setParams, pending } = useQueryParams();

  const urlQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const [lastUrlQ, setLastUrlQ] = useState(urlQ);

  // Keep the box in step when the URL changes from elsewhere (Clear filters,
  // browser back). Adjusting state during render rather than in an effect --
  // an effect here would cascade an extra render on every URL change, and
  // remounting via `key` would steal focus mid-typing.
  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ);
    setQ(urlQ);
  }

  // Debounce so we aren't firing a query per keystroke.
  useEffect(() => {
    if (q === urlQ) return;
    const timer = setTimeout(() => setParams({ q: q || null }), 300);
    return () => clearTimeout(timer);
  }, [q, urlQ, setParams]);

  const catalyst = searchParams.get("catalyst") ?? ALL;
  const direction = searchParams.get("direction") ?? ALL;
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const hasFilters = Boolean(
    urlQ ||
      searchParams.get("catalyst") ||
      searchParams.get("direction") ||
      from ||
      to,
  );

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_minmax(0,1.4fr)_minmax(0,1fr)]">
        <Field label="Search">
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Company, ticker or catalyst"
            aria-label="Search company, ticker or catalyst"
          />
        </Field>

        <Field label="From">
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setParams({ from: event.target.value || null })}
          />
        </Field>

        <Field label="To">
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setParams({ to: event.target.value || null })}
          />
        </Field>

        <Field label="Catalyst">
          <Select
            value={catalyst}
            onValueChange={(value) =>
              setParams({ catalyst: value === ALL ? null : value })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All catalysts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All catalysts</SelectItem>
              {catalysts.map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Direction">
          <Select
            value={direction}
            onValueChange={(value) =>
              setParams({ direction: value === ALL ? null : value })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All directions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All directions</SelectItem>
              <SelectItem value="up">Up only</SelectItem>
              <SelectItem value="down">Down only</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!hasFilters}
          onClick={() =>
            setParams({
              q: null,
              from: null,
              to: null,
              catalyst: null,
              direction: null,
            })
          }
        >
          Clear filters
        </Button>
        {pending ? (
          <span className="text-xs text-muted-foreground">Updating…</span>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
