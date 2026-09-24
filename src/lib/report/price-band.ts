import type { PriceClose, ReportTimelineEvent } from "./types";

/**
 * The "How we got here" band as a share-price line with the timeline on it.
 *
 * Every snapshot draft stored before this had a text timeline and no chart:
 * the schema required the timeline and left the chart optional, and the model
 * took the required field every time. So the chart no longer depends on the
 * model. The price series comes from the exchange feed (`ReportDoc.priceHistory`),
 * and the model's dated steps are placed on it as numbered markers, which
 * keeps the timeline and adds the chart in the same band.
 *
 * Pure layout arithmetic, no rendering, so the template stays a drawing and
 * this can be reasoned about on its own. Client-safe: types only.
 */

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/** Below this the "chart" is a few dots and the text timeline says more. */
export const PRICE_BAND_MIN_POINTS = 20;

/**
 * The window is the timeline's own span, not a fixed period.
 *
 * It was "at least six months", which on a story that started three weeks ago
 * drew five months of line with nothing on it and crushed the events into the
 * right edge. Now it runs from just before the first step to today, or to the
 * next scheduled step when there is one, so every marker has room.
 */
/** Shortest span drawn, so a week-old story still has a line to read. */
const MIN_WINDOW_DAYS = 45;
/** Past this a daily line is a smear; older events keep their caption only. */
const MAX_WINDOW_DAYS = 730;
/** An upcoming step further out than this would squash the line into the left. */
const MAX_FORWARD_DAYS = 120;
/** Room either side of the events, as a share of the span. */
const EDGE_SHARE = 0.04;

/**
 * "27 Jul 2026", "Jul 2026", "July 2026" → YYYY-MM-DD. Null for anything else
 * ("FY26", "Q3"), which then prints as a caption without a marker rather than
 * being placed on a guessed date. A month with no day is placed mid-month.
 */
export function parseEventDate(text: string): string | null {
  const match = /(?:(\d{1,2})\s+)?([A-Za-z]{3,9})\.?\s+(\d{4})/.exec(text);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const day = match[1] ? Number(match[1]) : 15;
  if (day < 1 || day > 31) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toTime(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

const DAY_MS = 86_400_000;

function shiftDays(iso: string, days: number): string {
  return new Date(toTime(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export type PriceBandMarker = {
  /** 1-based, matching the caption under the plot. */
  number: number;
  /** 0..1 across the plot. */
  x: number;
  /** The close the marker sits on; for an upcoming step, today's price. */
  close: number;
  /** Levels to lift the marker by when it would sit on its neighbour. */
  stack: number;
  /** After the move date: drawn hollow, on the dotted line past today. */
  upcoming: boolean;
};

export type PriceBandCaption = {
  number: number;
  date: string;
  text: string;
  /** False for an event outside the window or with no parseable date. */
  plotted: boolean;
  upcoming: boolean;
};

export type PriceBandLayout = {
  points: { x: number; close: number }[];
  markers: PriceBandMarker[];
  captions: PriceBandCaption[];
  /** First of each month in the window, thinned to at most `maxTicks`. */
  monthTicks: { x: number; label: string }[];
  first: PriceClose;
  last: PriceClose;
  /** Where today sits, 0..1 — short of 1 when an upcoming step extends the axis. */
  todayX: number;
  low: number;
  high: number;
};

/**
 * The layout, or null when there is not enough price history to draw one —
 * in which case the caller falls back to the text timeline.
 *
 * `reportPrice` is the traded price the move was read at. The draft usually
 * runs mid-session and the feed may not carry a bar for today yet, so it is
 * put in as today's point; without it the line would stop yesterday and miss
 * the move the report is about.
 */
export function layoutPriceBand(input: {
  history: PriceClose[];
  timeline: ReportTimelineEvent[];
  moveDate: string;
  reportPrice?: number | null;
  /** Horizontal room for markers, as a fraction of the plot width. */
  markerGap?: number;
  maxTicks?: number;
}): PriceBandLayout | null {
  const { timeline, moveDate } = input;
  const markerGap = input.markerGap ?? 0.028;
  const maxTicks = input.maxTicks ?? 6;

  const byDate = new Map<string, number>();
  for (const bar of input.history) {
    if (bar.date <= moveDate && Number.isFinite(bar.close) && bar.close > 0) {
      byDate.set(bar.date, bar.close);
    }
  }
  if (input.reportPrice && input.reportPrice > 0) {
    byDate.set(moveDate, input.reportPrice);
  }
  const series = [...byDate]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (series.length === 0) return null;

  const parsed = timeline.map((event) => parseEventDate(event.date));
  const past = parsed.filter((iso): iso is string => iso !== null && iso <= moveDate).sort();
  const forwardLimit = shiftDays(moveDate, MAX_FORWARD_DAYS);
  const future = parsed
    .filter((iso): iso is string => iso !== null && iso > moveDate && iso <= forwardLimit)
    .sort();

  // The span the events need, before padding.
  const floor = shiftDays(moveDate, -MAX_WINDOW_DAYS);
  let start = past[0] ?? shiftDays(moveDate, -MIN_WINDOW_DAYS);
  if (start < floor) start = floor;
  const end = future[future.length - 1] ?? moveDate;
  if (toTime(end) - toTime(start) < MIN_WINDOW_DAYS * DAY_MS) {
    start = shiftDays(end, -MIN_WINDOW_DAYS);
  }
  const pad = Math.round(((toTime(end) - toTime(start)) / DAY_MS) * EDGE_SHARE);
  start = shiftDays(start, -Math.max(3, pad));
  if (start < series[0].date) start = series[0].date;
  // Padded on the right too: today's step is usually the last marker, and
  // without room it sits clipped against the frame on top of today's dot.
  const axisEnd = shiftDays(end, Math.max(3, pad));

  const window = series.filter((bar) => bar.date >= start);
  if (window.length < PRICE_BAND_MIN_POINTS) return null;

  const t0 = toTime(window[0].date);
  const t1 = toTime(axisEnd);
  const span = t1 - t0 || 1;
  const xOf = (iso: string) => (toTime(iso) - t0) / span;
  const last = window[window.length - 1];

  const closes = window.map((bar) => bar.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);

  const captions: PriceBandCaption[] = [];
  const markers: PriceBandMarker[] = [];
  timeline.forEach((event, index) => {
    const iso = parsed[index];
    const upcoming = iso !== null && iso > moveDate;
    const plotted =
      iso !== null &&
      iso >= window[0].date &&
      (upcoming ? iso <= forwardLimit : true);
    captions.push({ number: index + 1, date: event.date, text: event.text, plotted, upcoming });
    if (!plotted || iso === null) return;

    if (upcoming) {
      markers.push({ number: index + 1, x: xOf(iso), close: last.close, stack: 0, upcoming });
      return;
    }
    // The close on the event's date, or the last session before it: a filing
    // on a Saturday is priced by Friday's close.
    let bar = window[0];
    for (const candidate of window) {
      if (candidate.date > iso) break;
      bar = candidate;
    }
    markers.push({ number: index + 1, x: xOf(bar.date), close: bar.close, stack: 0, upcoming });
  });

  // Two events a day apart would draw one marker over the other. Each one that
  // lands within `markerGap` of the one before it is lifted a level.
  markers.sort((a, b) => a.x - b.x);
  for (let i = 1; i < markers.length; i += 1) {
    if (markers[i].x - markers[i - 1].x < markerGap) {
      markers[i].stack = markers[i - 1].stack + 1;
    }
  }

  const monthTicks: { x: number; label: string }[] = [];
  const cursor = new Date(t0);
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= t1) {
    const month = cursor.getUTCMonth();
    const name = MONTHS[month];
    const year = String(cursor.getUTCFullYear()).slice(2);
    monthTicks.push({
      x: (cursor.getTime() - t0) / span,
      label: `${name[0].toUpperCase()}${name.slice(1)} '${year}`,
    });
    cursor.setUTCMonth(month + 1);
  }
  const every = Math.max(1, Math.ceil(monthTicks.length / maxTicks));
  // Thinned from the right, so the most recent month is always labelled.
  const thinned = monthTicks.filter(
    (_, index) => (monthTicks.length - 1 - index) % every === 0,
  );

  return {
    points: window.map((bar) => ({ x: xOf(bar.date), close: bar.close })),
    markers,
    captions,
    monthTicks: thinned,
    first: window[0],
    last,
    todayX: xOf(last.date),
    low,
    high,
  };
}
