"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type CompanyOption = { id: number; ticker: string; name: string };

/**
 * Company is picked from the existing list rather than typed, so every save
 * resolves to a company_id. Free-typed tickers are how one company's research
 * history quietly splits into two.
 */
export function CompanyCombobox({
  companies,
  value,
  onChange,
}: {
  companies: CompanyOption[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = companies.find((company) => company.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between font-normal"
          />
        }
      >
        {selected ? (
          <span className="truncate">
            <span className="font-mono text-xs font-semibold">
              {selected.ticker}
            </span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            {selected.name}
          </span>
        ) : (
          <span className="text-muted-foreground">Select a company…</span>
        )}
        <span aria-hidden className="ml-2 shrink-0 text-xs opacity-60">
          ▾
        </span>
      </PopoverTrigger>

      {/* Base UI exposes the trigger width as --anchor-width. */}
      <PopoverContent
        className="w-[var(--anchor-width)] p-0"
        align="start"
      >
        <Command
          filter={(itemValue, search) => {
            // itemValue is "TICKER NAME" so either matches.
            return itemValue.toLowerCase().includes(search.toLowerCase())
              ? 1
              : 0;
          }}
        >
          <CommandInput placeholder="Search ticker or company…" />
          <CommandList>
            <CommandEmpty>
              <div className="px-2 py-3 text-sm">
                <p>No company found.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  New companies are added to the companies table — ask for that
                  screen if you need it before extraction lands.
                </p>
              </div>
            </CommandEmpty>
            <CommandGroup>
              {companies.map((company) => (
                <CommandItem
                  key={company.id}
                  value={`${company.ticker} ${company.name}`}
                  onSelect={() => {
                    onChange(company.id === value ? null : company.id);
                    setOpen(false);
                  }}
                >
                  <span
                    className={cn(
                      "mr-2 w-3 text-xs",
                      company.id === value ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span className="font-mono text-xs font-semibold">
                    {company.ticker}
                  </span>
                  <span className="ml-2 truncate text-muted-foreground">
                    {company.name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
