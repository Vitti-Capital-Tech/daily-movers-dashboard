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

export type CompanyLogoSize = "xs" | "sm" | "md" | "lg" | "xl";

/**
 * One URL per ticker, resolved by `/api/logo` -- it walks the upstream sources
 * server-side, so a freshly uploaded ticker gets a logo with nothing registered
 * for it here. The company name rides along as a hint for the fallbacks.
 */
function logoEndpoint(ticker: string, name?: string) {
  const query = name ? `?name=${encodeURIComponent(name)}` : "";
  return `/api/logo/${encodeURIComponent(ticker)}${query}`;
}

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
  const cleanTicker = (ticker || "").trim().toUpperCase();

  // Keyed by ticker: paging the movers table swaps the ticker under a reused
  // component instance, and a "this one failed" index carried over from the
  // previous row would hide a logo that loads perfectly well.
  const [state, setState] = useState({ ticker: cleanTicker, index: 0, loaded: false });
  if (state.ticker !== cleanTicker) {
    setState({ ticker: cleanTicker, index: 0, loaded: false });
  }
  const { index: sourceIndex, loaded } = state;

  // Candidate sources to try in order. The proxy is the last one it needs:
  // everything it could fall back to, it has already tried itself.
  const sources = [
    explicitLogoUrl,
    cleanTicker ? logoEndpoint(cleanTicker, name) : null,
  ].filter(Boolean) as string[];

  const currentSrc = sources[sourceIndex];
  const isFailed = sourceIndex >= sources.length;

  function markLoaded() {
    setState((prev) => (prev.loaded ? prev : { ...prev, loaded: true }));
  }

  function tryNextSource() {
    setState((prev) => ({ ...prev, index: prev.index + 1, loaded: false }));
  }

  /**
   * The fix for logos that stayed hidden until you navigated away and back.
   *
   * On a server-rendered page the browser starts these requests while parsing
   * the HTML, so an image can finish *before* React hydrates and attaches
   * `onLoad`. That event is then never delivered: the image sits in the DOM fully
   * decoded behind an `opacity-0` wrapper, and only a client-side navigation --
   * which re-creates the element with handlers already in place -- reveals it.
   *
   * A ref callback runs during commit, so it can ask the DOM what actually
   * happened instead of waiting for an event that has already been missed.
   * `complete` covers both outcomes; `naturalWidth` is what separates them, since
   * a failed image is also "complete".
   */
  function settleIfAlreadyDone(node: HTMLImageElement | null) {
    if (!node || !node.complete) return;
    if (node.naturalWidth > 0) markLoaded();
    else tryNextSource();
  }

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
            ref={settleIfAlreadyDone}
            src={currentSrc}
            alt={`${cleanTicker} logo`}
            className="size-full object-contain"
            onLoad={markLoaded}
            onError={tryNextSource}
          />
        </div>
      )}
    </div>
  );
}
