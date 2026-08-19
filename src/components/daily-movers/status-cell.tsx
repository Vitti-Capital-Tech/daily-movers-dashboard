"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { updateMoverStatus, type MoverFormState } from "@/actions/movers";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  MOVER_STATUSES,
  MOVER_STATUS_LABELS,
  type MoverStatus,
} from "@/lib/validation";

/**
 * Amber for Follow-Up because it's the one that means "come back to this";
 * Reviewed reads as settled, New as untouched.
 */
const STATUS_STYLES: Record<MoverStatus, string> = {
  new: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25",
  reviewed:
    "bg-muted/70 text-muted-foreground border-border/60",
  follow_up:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
};

const CHIP_BASE =
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap transition-colors";

export function StatusCell({
  moverId,
  status,
  canWrite,
  label,
}: {
  moverId: number;
  status: MoverStatus;
  canWrite: boolean;
  /** Identifies the row in the trigger's accessible name, e.g. "JBH on 17 Aug 2026". */
  label: string;
}) {
  const [state, formAction, isPending] = useActionState<
    MoverFormState,
    FormData
  >(updateMoverStatus, null);

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? "Status updated.");
    else if (state && !state.ok && state.message) toast.error(state.message);
  }, [state]);

  if (!canWrite) {
    return (
      <span className={cn(CHIP_BASE, STATUS_STYLES[status])}>
        {MOVER_STATUS_LABELS[status]}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Status for ${label}: ${MOVER_STATUS_LABELS[status]}`}
            disabled={isPending}
            className={cn(
              CHIP_BASE,
              STATUS_STYLES[status],
              "cursor-pointer hover:brightness-105 disabled:opacity-60",
            )}
          />
        }
      >
        <span>{MOVER_STATUS_LABELS[status]}</span>
        <span aria-hidden className="text-[9px] opacity-60">
          ▾
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        {MOVER_STATUSES.map((option) => (
          <DropdownMenuItem
            key={option}
            disabled={option === status}
            onClick={() => {
              // A form per row would be 25 forms on the page; the action takes
              // FormData, so build it here instead.
              const data = new FormData();
              data.set("id", String(moverId));
              data.set("status", option);
              formAction(data);
            }}
          >
            {MOVER_STATUS_LABELS[option]}
            {option === status ? (
              <span aria-hidden className="ml-auto text-primary">
                ✓
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
