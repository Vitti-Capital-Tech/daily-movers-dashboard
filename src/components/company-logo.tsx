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
  const clean = (ticker || "ASX").trim().toUpperCase();
  const code = clean.charCodeAt(0) + clean.charCodeAt(clean.length - 1);
  return MONOGRAM_PALETTES[code % MONOGRAM_PALETTES.length];
}

// Common ASX company domain mappings
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
  BGA: "begagroup.com.au",
  ZIP: "zip.co",
  PLS: "pilbaraminerals.com.au",
};

/** Derives probable domain name from company name */
function inferDomain(ticker: string, companyName?: string): string {
  const cleanTicker = ticker.trim().toUpperCase();
  if (KNOWN_DOMAINS[cleanTicker]) return KNOWN_DOMAINS[cleanTicker];

  if (companyName) {
    const simplified = companyName
      .toLowerCase()
      .replace(/\b(limited|ltd|group|corporation|corp|holdings|pty|inc|plc)\b/gi, "")
      .replace(/[^a-z0-9]/g, "");
    if (simplified.length >= 3) {
      return `${simplified}.com`;
    }
  }

  return `${cleanTicker.toLowerCase()}.com.au`;
}

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
  const [loaded, setLoaded] = useState(false);

  const cleanTicker = (ticker || "").trim().toUpperCase();
  const domain = inferDomain(cleanTicker, name);

  // Candidate sources to try in order
  const sources = [
    explicitLogoUrl,
    `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128`,
    `https://logo.clearbit.com/${domain}`,
    `https://s3-symbol-logo.tradingview.com/${cleanTicker.toLowerCase()}.svg`,
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
  const monogram = cleanTicker.slice(0, 2) || "CO";

  return (
    <div
      className={cn(
        "relative shrink-0 flex items-center justify-center overflow-hidden border font-mono font-bold select-none shadow-2xs transition-all",
        palette.bg,
        palette.text,
        palette.border,
        currentSize.box,
        currentSize.font,
        className,
      )}
      title={name || cleanTicker}
    >
      {/* Base Monogram Tile: always renders immediately with zero blank flicker */}
      <span>{monogram}</span>

      {/* Branded Logo Overlay: fades in once successfully loaded */}
      {!isFailed && currentSrc && (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-white dark:bg-card transition-opacity duration-200",
            currentSize.iconPad,
            loaded ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentSrc}
            alt={`${cleanTicker} logo`}
            loading="lazy"
            className="size-full object-contain"
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(false);
              setSourceIndex((prev) => prev + 1);
            }}
          />
        </div>
      )}
    </div>
  );
}
