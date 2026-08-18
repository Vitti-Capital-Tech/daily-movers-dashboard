"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { saveMover, type MoverFormState } from "@/actions/movers";
import { CompanyCombobox } from "@/components/daily-movers/company-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { todayIso } from "@/lib/format";
import type { FormOptions, MoverRow } from "@/lib/movers";
import { cn } from "@/lib/utils";
import {
  MOVE_TYPES,
  MOVE_TYPE_LABELS,
  NO_SELECTION,
  REASON_MAX,
  TAKEAWAY_MAX,
} from "@/lib/validation";

export function MoverDialog({
  options,
  mode,
  mover,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: {
  options: FormOptions;
  mode: "create" | "edit";
  mover?: MoverRow;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled
    ? (setControlledOpen ?? (() => {}))
    : setUncontrolledOpen;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {mode === "create" ? (
        <DialogTrigger render={<Button />}>+ Add Daily Mover</DialogTrigger>
      ) : null}

      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit Daily Mover" : "Add Daily Mover"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update the saved record."
              : "Save a Daily Mover so it's findable next time this company comes up."}
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while open, so form + action state reset each time. */}
        <MoverForm
          options={options}
          mover={mover}
          onSaved={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function MoverForm({
  options,
  mover,
  onSaved,
  onCancel,
}: {
  options: FormOptions;
  mover?: MoverRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [state, formAction, isPending] = useActionState<
    MoverFormState,
    FormData
  >(saveMover, null);

  const [companyId, setCompanyId] = useState<number | null>(
    mover?.companyId ?? null,
  );
  const [reason, setReason] = useState(mover?.reasonForMove ?? "");
  const [takeaway, setTakeaway] = useState(mover?.mainTakeaway ?? "");

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Saved.");
      onSaved();
    } else if (state && !state.ok && state.message) {
      toast.error(state.message);
    }
  }, [state, onSaved]);

  const selectedCompany = options.companies.find((c) => c.id === companyId);
  const errors = state?.fieldErrors ?? {};

  const defaultAnalystId =
    mover?.analystId ??
    (options.analysts.length === 1 ? options.analysts[0].id : null);

  return (
    <form action={formAction} className="space-y-5">
      {mover ? <input type="hidden" name="id" value={mover.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Company" error={errors.companyId} className="sm:col-span-2">
          <CompanyCombobox
            companies={options.companies}
            value={companyId}
            onChange={setCompanyId}
          />
          <input
            type="hidden"
            name="companyId"
            value={companyId != null ? String(companyId) : ""}
          />
        </Row>

        <Row label="Ticker" hint="From the selected company">
          <Input
            value={selectedCompany?.ticker ?? ""}
            readOnly
            disabled
            placeholder="—"
            className="font-mono"
          />
        </Row>

        <Row label="Date" error={errors.moveDate}>
          <Input
            type="date"
            name="moveDate"
            defaultValue={mover?.moveDate ?? todayIso()}
            required
          />
        </Row>

        <Row
          label="Share-price move"
          error={errors.movePct}
          hint="Negative for a fall, e.g. -11.5"
        >
          <div className="relative">
            <Input
              type="number"
              name="movePct"
              step="0.01"
              defaultValue={mover ? String(mover.movePct) : ""}
              placeholder="-11.5"
              required
              className="pr-8"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              %
            </span>
          </div>
        </Row>

        <Row label="Move type" error={errors.moveType}>
          <Select name="moveType" defaultValue={mover?.moveType ?? "intraday"}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOVE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {MOVE_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row
          label="Window wording"
          error={errors.moveWindowLabel}
          hint="Optional — as written in the report, e.g. “Morning Trade”"
          className="sm:col-span-2"
        >
          <Input
            name="moveWindowLabel"
            defaultValue={mover?.moveWindowLabel ?? ""}
            placeholder="Intraday"
          />
        </Row>

        <Row
          label="Catalyst"
          error={errors.catalystId}
          className="sm:col-span-2"
        >
          <Select
            name="catalystId"
            defaultValue={mover ? String(mover.catalystId) : undefined}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a catalyst" />
            </SelectTrigger>
            <SelectContent>
              {options.catalysts.map((catalyst) => (
                <SelectItem key={catalyst.id} value={String(catalyst.id)}>
                  {catalyst.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row
          label="Reason for move"
          error={errors.reasonForMove}
          counter={`${reason.length} / ${REASON_MAX}`}
          className="sm:col-span-2"
        >
          <Textarea
            name="reasonForMove"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={REASON_MAX}
            rows={3}
            placeholder="What actually moved the share price?"
            required
          />
        </Row>

        <Row
          label="Main takeaway"
          error={errors.mainTakeaway}
          counter={`${takeaway.length} / ${TAKEAWAY_MAX}`}
          className="sm:col-span-2"
        >
          <Textarea
            name="mainTakeaway"
            value={takeaway}
            onChange={(event) => setTakeaway(event.target.value)}
            maxLength={TAKEAWAY_MAX}
            rows={3}
            placeholder="What should we remember next time this company comes up?"
            required
          />
        </Row>

        <Row
          label="Report price"
          error={errors.reportPrice}
          hint="Optional — not in the report PDFs"
        >
          <Input
            type="number"
            name="reportPrice"
            step="0.01"
            min="0"
            defaultValue={mover?.reportPrice != null ? String(mover.reportPrice) : ""}
            placeholder="e.g. 103.45"
          />
        </Row>

        <Row label="Analyst" error={errors.analystId}>
          <Select
            name="analystId"
            defaultValue={
              defaultAnalystId != null ? String(defaultAnalystId) : NO_SELECTION
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select an analyst" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SELECTION}>Not specified</SelectItem>
              {options.analysts.map((analyst) => (
                <SelectItem key={analyst.id} value={String(analyst.id)}>
                  {analyst.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row
          label="Daily Mover link"
          error={errors.reportUrl}
          hint="Optional — PDF upload comes with the extraction step"
          className="sm:col-span-2"
        >
          <Input
            type="url"
            name="reportUrl"
            defaultValue={mover?.reportUrl ?? ""}
            placeholder="https://…"
          />
        </Row>

        <Row
          label="ASX announcement link"
          error={errors.asxAnnouncementUrl}
          hint="Optional — manual, the PDFs don't include it"
          className="sm:col-span-2"
        >
          <Input
            type="url"
            name="asxAnnouncementUrl"
            defaultValue={mover?.asxAnnouncementUrl ?? ""}
            placeholder="https://www.asx.com.au/…"
          />
        </Row>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save Daily Mover"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Row({
  label,
  hint,
  error,
  counter,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string[];
  counter?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {counter ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {counter}
          </span>
        ) : null}
      </div>
      {children}
      {error?.length ? (
        <p className="text-xs text-destructive">{error[0]}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
