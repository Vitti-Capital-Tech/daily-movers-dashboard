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
 *
 * Direct-to-storage rather than through the Server Action because Vercel caps
 * request bodies at 4.5 MB and Next caps Server Action bodies at 1 MB by
 * default — a routine 5 MB report would pass locally and fail in production.
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
  const [path, setPath] = useState<string | null>(existingPath);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

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

    setPath(ticket.path);
    setStatus({ kind: "done", fileName: file.name });
  }

  const fileLabel =
    status.kind === "done"
      ? status.fileName
      : path
        ? (path.split("/").pop() ?? path)
        : null;

  return (
    <div className="space-y-2">
      {/* What the form actually saves. */}
      <input type="hidden" name="reportStoragePath" value={path ?? ""} />

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          // Reset so re-picking the same file fires onChange again.
          event.target.value = "";
        }}
      />

      {fileLabel ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs" title={fileLabel}>
            {fileLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Remove attached report"
            onClick={() => {
              setPath(null);
              setStatus({ kind: "idle" });
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start font-normal"
          disabled={status.kind === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          {status.kind === "uploading" ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Upload className="mr-2 size-4" />
              Attach Daily Mover PDF
            </>
          )}
        </Button>
      )}

      {status.kind === "error" ? (
        <p className="text-xs text-destructive">{status.message}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          PDF, up to {formatBytes(MAX_REPORT_BYTES)}. Only signed-in staff can
          open it.
        </p>
      )}

      {/* Removing the attachment here doesn't delete the object from storage;
          the row simply stops pointing at it. Deliberate — an accidental
          removal shouldn't destroy the only copy of a published report. */}
    </div>
  );
}
