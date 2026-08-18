"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PER_PAGE_OPTIONS } from "@/lib/movers";
import { useQueryParams } from "@/lib/use-query-params";

export function Pagination({
  page,
  pageCount,
  perPage,
  total,
}: {
  page: number;
  pageCount: number;
  perPage: number;
  total: number;
}) {
  const { setParams } = useQueryParams();

  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">Rows per page</Label>
        <Select
          value={String(perPage)}
          onValueChange={(value) => setParams({ perPage: value })}
        >
          <SelectTrigger size="sm" className="w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PER_PAGE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-xs text-muted-foreground tabular-nums">
          {first}–{last} of {total}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() =>
              setParams({ page: String(page - 1) }, { keepPage: true })
            }
          >
            Previous
          </Button>
          <span className="px-2 text-xs text-muted-foreground tabular-nums">
            {page} / {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() =>
              setParams({ page: String(page + 1) }, { keepPage: true })
            }
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
