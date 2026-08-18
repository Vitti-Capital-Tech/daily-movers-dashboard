"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { deleteMover, type MoverFormState } from "@/actions/movers";
import { MoverDialog } from "@/components/daily-movers/mover-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoveDate, formatPct } from "@/lib/format";
import {
  hasReport,
  reportHref,
  type FormOptions,
  type MoverRow,
} from "@/lib/movers";

export function MoverRowActions({
  row,
  options,
}: {
  row: MoverRow;
  options: FormOptions;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Actions for ${row.ticker} on ${formatMoveDate(row.moveDate)}`}
            />
          }
        >
          <span aria-hidden>⋯</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Edit
          </DropdownMenuItem>
          {hasReport(row) ? (
            <DropdownMenuItem
              render={
                <a href={reportHref(row.id)} target="_blank" rel="noreferrer" />
              }
            >
              Open report
            </DropdownMenuItem>
          ) : null}
          {row.asxAnnouncementUrl ? (
            <DropdownMenuItem
              render={
                <a
                  href={row.asxAnnouncementUrl}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              Open announcement
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <MoverDialog
        mode="edit"
        mover={row}
        options={options}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <DeleteConfirm row={row} open={confirmOpen} onOpenChange={setConfirmOpen} />
    </>
  );
}

function DeleteConfirm({
  row,
  open,
  onOpenChange,
}: {
  row: MoverRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, isPending] = useActionState<
    MoverFormState,
    FormData
  >(deleteMover, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Deleted.");
      onOpenChange(false);
    } else if (state && !state.ok && state.message) {
      toast.error(state.message);
    }
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this Daily Mover?</DialogTitle>
          <DialogDescription>
            {row.ticker} · {formatMoveDate(row.moveDate)} ·{" "}
            {formatPct(row.movePct)}. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction}>
          <input type="hidden" name="id" value={row.id} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
