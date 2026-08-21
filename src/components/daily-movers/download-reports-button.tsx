"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function DownloadReportsButton({
  totalReports,
}: {
  totalReports?: number;
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownloadZip() {
    if (downloading) return;
    setDownloading(true);
    const toastId = toast.loading("Packaging reports into ZIP archive...");

    try {
      const response = await fetch("/api/reports/download-all");

      if (!response.ok) {
        if (response.status === 401) {
          toast.error("Please sign in to download reports.", { id: toastId });
          return;
        }
        if (response.status === 404) {
          toast.error("No reports found to download.", { id: toastId });
          return;
        }
        throw new Error(`Server returned ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `daily-movers-reports-${today}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success("All reports downloaded in ZIP archive!", { id: toastId });
    } catch (err) {
      console.error("Failed to download zip:", err);
      toast.error("Failed to download reports ZIP. Please try again.", {
        id: toastId,
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownloadZip}
      disabled={downloading}
      className="h-8 gap-1.5 text-xs font-semibold shadow-2xs border-border/80 hover:bg-muted/80"
      title="Download all attached daily research reports as a ZIP file"
    >
      {downloading ? (
        <Loader2 className="size-3.5 animate-spin text-primary" />
      ) : (
        <Download className="size-3.5 text-muted-foreground" />
      )}
      <span>{downloading ? "Preparing ZIP..." : "Download All Reports (.zip)"}</span>
    </Button>
  );
}
