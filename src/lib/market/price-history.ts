import "server-only";

import { marketData } from "./index";
import type { PriceClose } from "@/lib/report/types";

/**
 * Two years of daily closes for the "How we got here" price line.
 *
 * Two years because the timeline reaches back to whatever started the story —
 * an acquisition agreed thirteen months ago — and the renderer picks the window
 * from the events, so it needs the history to be there. It costs one request
 * of ~500 bars for the company already chosen.
 */
const HISTORY_DAYS = 740;

function isoDaysAgo(days: number): string {
  const shifted = new Date();
  shifted.setUTCDate(shifted.getUTCDate() - days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The closes, oldest first, or null when the feed has none.
 *
 * Never throws: a missing price line costs the sheet its chart, and the band
 * falls back to the text timeline. A throw here would cost the day's draft.
 */
export async function fetchPriceHistory(
  ticker: string,
  moveDate: string,
): Promise<PriceClose[] | null> {
  try {
    const bars = await marketData.fetchDailyBars(ticker, isoDaysAgo(HISTORY_DAYS));
    const closes = bars
      .filter((bar) => bar.date <= moveDate && bar.close > 0)
      .map((bar) => ({ date: bar.date, close: bar.close }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return closes.length > 0 ? closes : null;
  } catch (error) {
    console.warn(`price history unavailable for ${ticker}`, error);
    return null;
  }
}
