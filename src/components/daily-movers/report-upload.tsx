"use client";

import { FileText, Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";

import { createReportUploadUrl } from "@/actions/reports";
import { Button } from "@/components/ui/button";
import {
  formatBytes,
  isPdf,
  MAX_REPORT_BYTES,
  uploadDirectToStorage,
} from "@/lib/storage";

type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "error"; message: string }
  | { kind: "done"; fileName: string };

/**
 * Uploads the PDF from the browser directly to Supabase Storage using a
 * server-issued signed URL, then puts the resulting storage key into a hidden
 * input for the form to save.
 */
export function ReportUpload({
  ticker,
  moveDate,
  existingPath,
}: {
  ticker: string;
  moveDate: string;
  existingPath: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const activePath = uploadedPath !== null ? uploadedPath : existingPath;

  async function handleFile(file: File) {
    if (!isPdf(file)) {
      setStatus({ kind: "error", message: "Only PDF files are accepted." });
      return;
    }
    if (file.size > MAX_REPORT_BYTES) {
      setStatus({
        kind: "error",
        message: `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_REPORT_BYTES)}.`,
      });
      return;
    }
    if (!ticker) {
      setStatus({
        kind: "error",
        message: "Pick the company first — it decides where the file is filed.",
      });
      return;
    }

    setStatus({ kind: "uploading" });

    const ticket = await createReportUploadUrl({
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      ticker,
      moveDate,
    });

    if (!ticket.ok) {
      setStatus({ kind: "error", message: ticket.message });
      return;
    }

    const uploadRes = await uploadDirectToStorage(ticket.path, ticket.token, file);
    if (!uploadRes.ok) {
      setStatus({ kind: "error", message: `Upload failed: ${uploadRes.error}` });
      return;
    }

    setUploadedPath(ticket.path);
    setStatus({ kind: "done", fileName: file.name });
  }

  function handleClear() {
    setUploadedPath("");
    setStatus({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  const fileLabel =
    status.kind === "done"
      ? status.fileName
      : activePath
        ? (activePath.split("/").pop() ?? activePath)
        : null;

  return (
    <div className="space-y-2">
      {/* What the form actually saves. */}
      <input type="hidden" name="reportStoragePath" value={activePath ?? ""} />

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {activePath ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-muted/40 p-3 text-xs">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileText className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">
                {fileLabel}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Attached to Daily Mover
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => inputRef.current?.click()}
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 size-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={handleClear}
              title="Remove file"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={status.kind === "uploading"}
          className="flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-background/50 p-6 text-center hover:border-primary/60 hover:bg-muted/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {status.kind === "uploading" ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-xs font-medium text-foreground">
                Uploading PDF to Supabase Storage…
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Upload className="size-4" />
              </div>
              <p className="text-xs font-medium text-foreground">
                Click to upload research PDF
              </p>
              <p className="text-[11px] text-muted-foreground">
                PDF up to {formatBytes(MAX_REPORT_BYTES)}
              </p>
            </div>
          )}
        </button>
      )}

      {status.kind === "error" && (
        <p className="text-xs text-destructive">{status.message}</p>
      )}
    </div>
  );
}
