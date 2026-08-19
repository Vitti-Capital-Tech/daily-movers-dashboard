"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Deterministic vibrant color palettes for fallback monograms
const MONOGRAM_PALETTES = [
  { bg: "bg-blue-600/15 dark:bg-blue-500/20", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/30" },
  { bg: "bg-emerald-600/15 dark:bg-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/30" },
  { bg: "bg-purple-600/15 dark:bg-purple-500/20", text: "text-purple-600 dark:text-purple-400", border: "border-purple-500/30" },
  { bg: "bg-amber-600/15 dark:bg-amber-500/20", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/30" },
  { bg: "bg-cyan-600/15 dark:bg-cyan-500/20", text: "text-cyan-600 dark:text-cyan-400", border: "border-cyan-500/30" },
  { bg: "bg-rose-600/15 dark:bg-rose-500/20", text: "text-rose-600 dark:text-rose-400", border: "border-rose-500/30" },
  { bg: "bg-indigo-600/15 dark:bg-indigo-500/20", text: "text-indigo-600 dark:text-indigo-400", border: "border-indigo-500/30" },
];

function getPalette(ticker: string) {
  const code = (ticker || "ASX").charCodeAt(0) + (ticker || "ASX").charCodeAt((ticker?.length || 1) - 1);
  return MONOGRAM_PALETTES[code % MONOGRAM_PALETTES.length];
}

// Common ASX company domain mappings for higher logo resolution
const KNOWN_DOMAINS: Record<string, string> = {
  JBH: "jbhifi.com.au",
  SPZ: "smartparking.com",
  BHP: "bhp.com",
  CBA: "commbank.com.au",
  CSL: "csl.com",
  NAB: "nab.com.au",
  WBC: "westpac.com.au",
  ANZ: "anz.com.au",
  WES: "wesfarmers.com.au",
  MQG: "macquarie.com",
  TLS: "telstra.com.au",
  RIO: "riotinto.com",
  FMG: "fortescue.com",
  GMG: "goodman.com",
  TCL: "transurban.com",
  WDS: "woodside.com",
  COL: "colesgroup.com.au",
  WOW: "woolworthsgroup.com.au",
  REA: "rea-group.com",
  XRO: "xero.com",
  WTC: "wisetechglobal.com",
  DRO: "droneshield.com",
  NXT: "nextdc.com",
};

export type CompanyLogoSize = "xs" | "sm" | "md" | "lg" | "xl";

export function CompanyLogo({
  ticker,
  name,
  logoUrl: explicitLogoUrl,
  size = "md",
  className,
}: {
  ticker: string;
  name?: string;
  logoUrl?: string | null;
  size?: CompanyLogoSize;
  className?: string;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);

  const cleanTicker = (ticker || "").trim().toUpperCase();
  const domain = KNOWN_DOMAINS[cleanTicker] || `${cleanTicker.toLowerCase()}.com.au`;

  // Candidate sources to try in order
  const sources = [
    explicitLogoUrl,
    `https://s3-symbol-logo.tradingview.com/${cleanTicker.toLowerCase()}.svg`,
    `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128`,
    `https://logo.clearbit.com/${domain}`,
  ].filter(Boolean) as string[];

  const currentSrc = sources[sourceIndex];
  const isFailed = sourceIndex >= sources.length;

  const sizeClasses: Record<CompanyLogoSize, { box: string; font: string; iconPad: string }> = {
    xs: { box: "size-5 rounded-md", font: "text-[9px]", iconPad: "p-0.5" },
    sm: { box: "size-6 rounded-md", font: "text-[10px]", iconPad: "p-0.5" },
    md: { box: "size-8 rounded-lg", font: "text-xs", iconPad: "p-1" },
    lg: { box: "size-11 rounded-xl", font: "text-sm", iconPad: "p-1.5" },
    xl: { box: "size-14 rounded-2xl", font: "text-base", iconPad: "p-2" },
  };

  const currentSize = sizeClasses[size] || sizeClasses.md;
  const palette = getPalette(cleanTicker);

  if (isFailed || !currentSrc) {
    // Institutional Monogram Tile
    const monogram = cleanTicker.slice(0, 2) || "CO";
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center font-mono font-bold border select-none transition-transform shadow-2xs",
          palette.bg,
          palette.text,
          palette.border,
          currentSize.box,
          currentSize.font,
          className,
        )}
        title={name || cleanTicker}
      >
        {monogram}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative shrink-0 flex items-center justify-center overflow-hidden border border-border/60 bg-white dark:bg-card/90 shadow-2xs transition-all",
        currentSize.box,
        currentSize.iconPad,
        className,
      )}
      title={name || cleanTicker}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={currentSrc}
        alt={`${cleanTicker} logo`}
        loading="lazy"
        className="size-full object-contain"
        onError={() => setSourceIndex((prev) => prev + 1)}
      />
    </div>
  );
}
