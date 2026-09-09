import "server-only";

import { marketData } from "./index";

/**
 * Was today's turnover unusual for this company?
 *
 * A Daily Mover already knows the session's volume — it is what the liquidity
 * screen ran on — and that figure on its own says nothing. Two million shares is
 * a quiet day for one company and five times normal for another. The number that
 * carries information is the ratio, which is how research notes have always put
 * it: "traded on 8x its three-month average".
 *
 * It matters here for a specific reason. A Daily Mover's whole claim is that an
 * announcement moved the stock, and volume is the evidence for that claim: a 15%
 * move on a normal day's turnover is a thin market re-pricing itself, while the
 * same move on six times average volume is the market actually transacting on the
 * news. The two deserve different reports, and until now the prompt could not
 * tell them apart.
 *
 * One request per draft, for the company already chosen. See `fetchDailyBars`
 * for why that is not batched.
 */

export type VolumeProfile = {
  /** Shares traded in the session the draft covers. */
  sessionVolume: number | null;
  /** Mean daily volume over the trailing window, today excluded. */
  averageVolume: number | null;
  /** `sessionVolume / averageVolume`. The figure worth printing. */
  multiple: number | null;
  /** How many sessions the average is computed over. */
  averagedSessions: number;
  /** Recent sessions, oldest first — the series a chart can plot. */
  recent: { date: string; volume: number }[];
};

/**
 * Calendar days of history to request.
 *
 * ~90 covers about 60 trading sessions, which leaves the 30-session average
 * intact even across a long Easter or a trading halt. Wider would not improve
 * the average and narrower risks a window that is mostly holiday.
 */
const HISTORY_DAYS = 90;

/** Sessions in the trailing average. Thirty is the desk's usual convention. */
const AVERAGE_SESSIONS = 30;

/** Sessions handed to the model as a plottable series. */
const RECENT_SESSIONS = 12;

/**
 * Below this the ratio is noise rather than signal.
 *
 * A company that trades three days in twenty has an "average" dominated by
 * zeroes, and dividing by it produces a 40x multiple that means only that the
 * stock is illiquid — which the turnover screen already covers.
 */
const MIN_SESSIONS_FOR_AVERAGE = 10;

function isoDaysAgo(days: number): string {
  const shifted = new Date();
  shifted.setUTCDate(shifted.getUTCDate() - days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The profile, or null if there isn't enough history to say anything.
 *
 * Never throws. A missing volume profile costs the report one figure; a throw
 * here would cost the day's draft, and this is the least important input in the
 * pipeline.
 */
export async function fetchVolumeProfile(
  ticker: string,
  moveDate: string,
): Promise<VolumeProfile | null> {
  let bars;
  try {
    bars = await marketData.fetchDailyBars(ticker, isoDaysAgo(HISTORY_DAYS));
  } catch (error) {
    console.warn(`volume profile unavailable for ${ticker}`, error);
    return null;
  }

  const withVolume = bars.filter(
    (bar): bar is { date: string; close: number; volume: number } =>
      typeof bar.volume === "number" && bar.volume > 0,
  );
  if (withVolume.length === 0) return null;

  /**
   * The move date's own bar is the session being reported on, and it is excluded
   * from the average it is measured against — including it would dilute the very
   * spike the ratio exists to show.
   *
   * It may be absent: the draft usually runs mid-session, and the provider does
   * not always carry a partial bar. In that case the ratio is left null rather
   * than computed against yesterday and labelled as today.
   */
  const sessionBar = withVolume.find((bar) => bar.date === moveDate) ?? null;
  const priorBars = withVolume.filter((bar) => bar.date < moveDate);

  const averagedBars = priorBars.slice(-AVERAGE_SESSIONS);
  const averageVolume =
    averagedBars.length >= MIN_SESSIONS_FOR_AVERAGE
      ? averagedBars.reduce((sum, bar) => sum + bar.volume, 0) /
        averagedBars.length
      : null;

  const sessionVolume = sessionBar?.volume ?? null;

  return {
    sessionVolume,
    averageVolume,
    multiple:
      sessionVolume !== null && averageVolume !== null && averageVolume > 0
        ? sessionVolume / averageVolume
        : null,
    averagedSessions: averageVolume === null ? 0 : averagedBars.length,
    recent: withVolume
      .slice(-RECENT_SESSIONS)
      .map((bar) => ({ date: bar.date, volume: bar.volume })),
  };
}

/** "12.4M", "845k" — volume as a research note prints it. */
export function formatVolume(shares: number): string {
  if (shares >= 1_000_000) return `${(shares / 1_000_000).toFixed(1)}M`;
  if (shares >= 1_000) return `${Math.round(shares / 1_000)}k`;
  return String(Math.round(shares));
}

/** The profile as prompt text, or null when there is nothing worth saying. */
export function formatVolumeProfile(profile: VolumeProfile | null): string | null {
  if (!profile) return null;

  const lines: string[] = [];

  if (profile.sessionVolume !== null) {
    lines.push(`  session volume:  ${formatVolume(profile.sessionVolume)} shares`);
  }
  if (profile.averageVolume !== null) {
    lines.push(
      `  ${profile.averagedSessions}-session average: ${formatVolume(profile.averageVolume)} shares/day`,
    );
  }
  if (profile.multiple !== null) {
    lines.push(
      `  today vs average: ${profile.multiple.toFixed(1)}x` +
        (profile.multiple >= 3
          ? "  <- unusually heavy; the market transacted on this news, not just re-priced"
          : profile.multiple < 1.5
            ? "  <- close to normal; the move happened on ordinary turnover"
            : ""),
    );
  }

  if (lines.length === 0) return null;

  const series = profile.recent
    .map((session) => `${session.date}=${formatVolume(session.volume)}`)
    .join(", ");

  return [
    "VOLUME PROFILE (from the exchange feed; shares traded, not dollars)",
    ...lines,
    `  last ${profile.recent.length} sessions: ${series}`,
  ].join("\n");
}
