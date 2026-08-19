"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Plus, Sparkles, UploadCloud, Loader2, CheckCircle2, FileText } from "lucide-react";

import { saveMover, type MoverFormState } from "@/actions/movers";
import { createReportUploadUrl } from "@/actions/reports";
import { CompanyCombobox } from "@/components/daily-movers/company-combobox";
import { ReportUpload } from "@/components/daily-movers/report-upload";
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
import { uploadDirectToStorage } from "@/lib/storage";
import { cn } from "@/lib/utils";
import {
  MOVE_TYPES,
  MOVE_TYPE_LABELS,
  NO_SELECTION,
  REASON_MAX,
  TAKEAWAY_MAX,
} from "@/lib/validation";

export function MoverDialog({
  options: initialOptions,
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

  const [options, setOptions] = useState(initialOptions);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {mode === "create" ? (
        <DialogTrigger
          render={
            <Button className="shadow-xs gap-1.5 font-semibold text-xs h-9 px-3.5" />
          }
        >
          <Plus className="size-3.5" />
          <span>Add Daily Mover</span>
        </DialogTrigger>
      ) : null}

      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{mode === "edit" ? "Edit Daily Mover" : "Add Daily Mover"}</span>
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update the saved research record."
              : "Upload a Daily Mover PDF to auto-extract with Claude, or fill the fields manually."}
          </DialogDescription>
        </DialogHeader>

        <MoverForm
          options={options}
          setOptions={setOptions}
          mode={mode}
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
  setOptions,
  mode,
  mover,
  onSaved,
  onCancel,
}: {
  options: FormOptions;
  setOptions: React.Dispatch<React.SetStateAction<FormOptions>>;
  mode: "create" | "edit";
  mover?: MoverRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [state, formAction, isPending] = useActionState<
    MoverFormState,
    FormData
  >(saveMover, null);

  // Controlled Form State
  const [companyId, setCompanyId] = useState<number | null>(
    mover?.companyId ?? null,
  );
  const [moveDate, setMoveDate] = useState(mover?.moveDate ?? todayIso());
  const [movePct, setMovePct] = useState(mover ? String(mover.movePct) : "");
  const [moveType, setMoveType] = useState<"intraday" | "closing">(
    mover?.moveType ?? "intraday",
  );
  const [catalystId, setCatalystId] = useState<number | null>(
    mover?.catalystId ?? null,
  );
  const [reason, setReason] = useState(mover?.reasonForMove ?? "");
  const [takeaway, setTakeaway] = useState(mover?.mainTakeaway ?? "");
  const [reportPrice, setReportPrice] = useState(
    mover?.reportPrice != null ? String(mover.reportPrice) : "",
  );
  const [analystId, setAnalystId] = useState<number | null>(
    mover?.analystId ??
      (options.analysts.length === 1 ? options.analysts[0].id : null),
  );
  const [reportStoragePath, setReportStoragePath] = useState<string | null>(
    mover?.reportStoragePath ?? null,
  );
  const [reportUrl, setReportUrl] = useState(mover?.reportUrl ?? "");
  const [asxAnnouncementUrl, setAsxAnnouncementUrl] = useState(
    mover?.asxAnnouncementUrl ?? "",
  );

  // Extraction State
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedFileName, setExtractedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Auto-extraction handler
  async function handleAutoExtract(file: File) {
    if (!file || !/\.pdf$/i.test(file.name)) {
      toast.error("Please upload a valid PDF file.");
      return;
    }

    setIsExtracting(true);
    setExtractedFileName(file.name);
    const toastId = toast.loading("Analyzing Daily Mover PDF with Claude AI...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (!res.ok || !result.ok) {
        toast.error(result.message || "Failed to extract data from PDF.", { id: toastId });
        setIsExtracting(false);
        return;
      }

      const { data, companyId: resolvedCompanyId, catalystId: resolvedCatalystId, analystId: resolvedAnalystId } = result;

      // Update companies in option list if new company was created
      if (result.createdCompany) {
        setOptions((prev) => ({
          ...prev,
          companies: [...prev.companies, result.createdCompany!].sort((a, b) =>
            a.ticker.localeCompare(b.ticker),
          ),
        }));
      }

      // Update analysts in option list if new analyst was created
      if (result.createdAnalyst) {
        setOptions((prev) => ({
          ...prev,
          analysts: [...prev.analysts, result.createdAnalyst!].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        }));
      }

      // Auto-populate all form fields
      setCompanyId(resolvedCompanyId);
      setMoveDate(data.moveDate);
      setMovePct(String(data.movePct));
      setMoveType(data.moveType);
      setCatalystId(resolvedCatalystId);
      setReason(data.reasonForMove);
      setTakeaway(data.mainTakeaway);
      if (data.reportPrice != null) setReportPrice(String(data.reportPrice));
      if (resolvedAnalystId != null) setAnalystId(resolvedAnalystId);
      if (data.asxAnnouncementUrl) setAsxAnnouncementUrl(data.asxAnnouncementUrl);

      // Upload the PDF to Supabase Storage in the background
      try {
        const ticket = await createReportUploadUrl({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || "application/pdf",
          ticker: data.ticker,
          moveDate: data.moveDate,
        });

        if (ticket.ok) {
          await uploadDirectToStorage(ticket.path, ticket.token, file);
          setReportStoragePath(ticket.path);
        }
      } catch (uploadErr) {
        console.error("Direct storage upload failed during auto-extract", uploadErr);
      }

      toast.success("Research extracted successfully! Please review and confirm.", {
        id: toastId,
      });
    } catch (err) {
      console.error("handleAutoExtract error", err);
      toast.error("Failed to extract data from PDF.", { id: toastId });
    } finally {
      setIsExtracting(false);
    }
  }

  return (
    <form action={formAction} className="space-y-5">
      {mover ? <input type="hidden" name="id" value={mover.id} /> : null}

      {/* Auto-Extract Banner (Only shown when adding new mover) */}
      {mode === "create" && (
        <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="size-4" />
              </span>
              <div>
                <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  AI Auto-Fill with Claude
                  <span className="rounded-full bg-primary/20 text-primary text-[10px] font-medium px-2 py-0.2">
                    PDF Extraction
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Drop your Daily Mover PDF to extract ticker, catalyst, takeaway, and % move.
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isExtracting}
              onClick={() => fileInputRef.current?.click()}
              className="h-8 gap-1.5 border-primary/40 bg-background/80 text-xs font-semibold hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer shrink-0"
            >
              {isExtracting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                  <span>Extracting...</span>
                </>
              ) : extractedFileName ? (
                <>
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                  <span>Extracted</span>
                </>
              ) : (
                <>
                  <UploadCloud className="size-3.5" />
                  <span>Upload & Auto-Fill</span>
                </>
              )}
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAutoExtract(file);
            }}
          />

          {extractedFileName && !isExtracting && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md">
              <FileText className="size-3" />
              <span>Loaded from {extractedFileName}</span>
            </div>
          )}
        </div>
      )}

      {/* Form Fields Grid */}
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
            className="font-mono text-xs font-bold"
          />
        </Row>

        <Row label="Date" error={errors.moveDate}>
          <Input
            type="date"
            name="moveDate"
            value={moveDate}
            onChange={(event) => setMoveDate(event.target.value)}
            required
            className="text-xs"
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
              value={movePct}
              onChange={(e) => setMovePct(e.target.value)}
              placeholder="-11.5"
              required
              className="pr-8 text-xs font-mono font-bold"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              %
            </span>
          </div>
        </Row>

        <Row label="Move Type" error={errors.moveType}>
          <Select
            name="moveType"
            value={moveType}
            onValueChange={(val) => setMoveType(val as "intraday" | "closing")}
          >
            <SelectTrigger className="w-full text-xs">
              <SelectValue>{MOVE_TYPE_LABELS[moveType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MOVE_TYPES.map((type) => (
                <SelectItem key={type} value={type} className="text-xs">
                  {MOVE_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row
          label="Catalyst"
          error={errors.catalystId}
          className="sm:col-span-2"
        >
          <Select
            name="catalystId"
            value={catalystId != null ? String(catalystId) : undefined}
            onValueChange={(val) => setCatalystId(Number(val))}
          >
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="Select a catalyst">
                {catalystId != null
                  ? options.catalysts.find(
                      (c) => Number(c.id) === Number(catalystId),
                    )?.label ?? "Select a catalyst"
                  : "Select a catalyst"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.catalysts.map((catalyst) => (
                <SelectItem key={catalyst.id} value={String(catalyst.id)} className="text-xs">
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
            className="text-xs"
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
            className="text-xs"
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
            value={reportPrice}
            onChange={(e) => setReportPrice(e.target.value)}
            placeholder="e.g. 103.45"
            className="text-xs font-mono"
          />
        </Row>

        <Row label="Analyst" error={errors.analystId}>
          <Select
            name="analystId"
            value={analystId != null ? String(analystId) : NO_SELECTION}
            onValueChange={(val) =>
              setAnalystId(val === NO_SELECTION ? null : Number(val))
            }
          >
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="Select an analyst">
                {analystId != null
                  ? options.analysts.find(
                      (a) => Number(a.id) === Number(analystId),
                    )?.name ?? "Not specified"
                  : "Not specified"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SELECTION} className="text-xs">Not specified</SelectItem>
              {options.analysts.map((analyst) => (
                <SelectItem key={analyst.id} value={String(analyst.id)} className="text-xs">
                  {analyst.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row
          label="Daily Mover PDF"
          error={errors.reportStoragePath}
          className="sm:col-span-2"
        >
          <ReportUpload
            ticker={selectedCompany?.ticker ?? ""}
            moveDate={moveDate}
            existingPath={reportStoragePath}
          />
        </Row>

        <Row
          label="Daily Mover link (instead of a PDF)"
          error={errors.reportUrl}
          hint="Optional — only if the report is already published somewhere."
          className="sm:col-span-2"
        >
          <Input
            type="url"
            name="reportUrl"
            value={reportUrl}
            onChange={(e) => setReportUrl(e.target.value)}
            placeholder="https://…"
            className="text-xs"
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
            value={asxAnnouncementUrl}
            onChange={(e) => setAsxAnnouncementUrl(e.target.value)}
            placeholder="https://www.asx.com.au/…"
            className="text-xs"
          />
        </Row>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isPending || isExtracting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending || isExtracting}>
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
