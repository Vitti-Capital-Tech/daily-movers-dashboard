"use client";

import { useEffect, useState } from "react";
import { Search, Calendar, Tag, ArrowUpDown, X, Loader2 } from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
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

  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ);
    setQ(urlQ);
  }

  // Debounce search query
  useEffect(() => {
    if (q === urlQ) return;
    const timer = setTimeout(() => setParams({ q: q || null }), 300);
    return () => clearTimeout(timer);
  }, [q, urlQ, setParams]);

  const catalyst = searchParams.get("catalyst") ?? ALL;
  const direction = searchParams.get("direction") ?? ALL;
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const activeFilterCount = [
    urlQ,
    searchParams.get("catalyst"),
    searchParams.get("direction"),
    from,
    to,
  ].filter(Boolean).length;

  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-4 backdrop-blur-xs shadow-xs">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Search Field */}
        <Field label="Search Query" icon={<Search className="size-3" />}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Company, ticker or keyword..."
              aria-label="Search company, ticker or catalyst"
              className="pl-8 bg-background/70 text-xs"
            />
            {q && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setParams({ q: null });
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </Field>

        {/* From Date */}
        <Field label="From Date" icon={<Calendar className="size-3" />}>
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setParams({ from: event.target.value || null })}
            className="bg-background/70 text-xs"
          />
        </Field>

        {/* To Date */}
        <Field label="To Date" icon={<Calendar className="size-3" />}>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setParams({ to: event.target.value || null })}
            className="bg-background/70 text-xs"
          />
        </Field>

        {/* Catalyst Dropdown */}
        <Field label="Catalyst" icon={<Tag className="size-3" />}>
          <Select
            value={catalyst}
            onValueChange={(value) =>
              setParams({ catalyst: value === ALL ? null : value })
            }
          >
            <SelectTrigger className="w-full bg-background/70 text-xs">
              <SelectValue placeholder="All catalysts">
                {catalyst === ALL
                  ? "All catalysts"
                  : catalysts.find((c) => String(c.id) === catalyst)?.label ??
                    "All catalysts"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="text-xs">
                All catalysts
              </SelectItem>
              {catalysts.map((item) => (
                <SelectItem key={item.id} value={String(item.id)} className="text-xs">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Move Direction Dropdown */}
        <Field label="Move Direction" icon={<ArrowUpDown className="size-3" />}>
          <Select
            value={direction}
            onValueChange={(value) =>
              setParams({ direction: value === ALL ? null : value })
            }
          >
            <SelectTrigger className="w-full bg-background/70 text-xs">
              <SelectValue placeholder="All directions">
                {direction === "up"
                  ? "↑ Upward (Gains)"
                  : direction === "down"
                    ? "↓ Downward (Declines)"
                    : "All directions"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="text-xs">
                All directions
              </SelectItem>
              <SelectItem value="up" className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                ↑ Upward (Gains)
              </SelectItem>
              <SelectItem value="down" className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                ↓ Downward (Declines)
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {/* Filter Status Bar */}
      <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-3">
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 ? (
            <Badge variant="secondary" className="gap-1 px-2 py-0.5 text-[11px] font-medium">
              <span>{activeFilterCount} active {activeFilterCount === 1 ? "filter" : "filters"}</span>
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Showing unfiltered archive</span>
          )}

          {activeFilterCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setParams({
                  q: null,
                  from: null,
                  to: null,
                  catalyst: null,
                  direction: null,
                })
              }
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3 mr-1" />
              Reset all
            </Button>
          )}
        </div>

        {pending && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
            <Loader2 className="size-3 animate-spin" />
            <span>Filtering...</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <Label className="text-[11px] font-medium uppercase tracking-wider">{label}</Label>
      </div>
      {children}
    </div>
  );
}
