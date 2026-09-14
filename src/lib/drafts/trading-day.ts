/**
 * ASX trading-day arithmetic, in the exchange's own timezone.
 *
 * Everything here is `Australia/Sydney` rather than the server's clock, because
 * the server's clock is UTC on Vercel and the two disagree about what day it is
 * for ten to fourteen hours out of every twenty-four. A cron firing at 02:30
 * UTC is the middle of the Sydney trading day, and a draft filed under the UTC
 * date would be stamped a day early.
 *
 * `Intl` is used rather than a date library because it already carries the
 * IANA rules, including the daylight-saving switch that moves Sydney between
 * UTC+10 and UTC+11 — the exact thing hand-rolled offsets get wrong twice a
 * year. Client-safe: no imports.
 */

export const EXCHANGE_TIMEZONE = "Australia/Sydney";

/** ASX continuous trading, local time. */
export const MARKET_OPEN_MINUTES = 10 * 60;
export const MARKET_CLOSE_MINUTES = 16 * 60;

const ISO_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: EXCHANGE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const PARTS_FORMAT = new Intl.DateTimeFormat("en-AU", {
  timeZone: EXCHANGE_TIMEZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** The exchange-local date as YYYY-MM-DD. */
export function exchangeDate(at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is the one locale that gives ISO order
  // without reassembling parts by hand.
  return ISO_DATE_FORMAT.format(at);
}

export type ExchangeClock = {
  /** YYYY-MM-DD in Sydney. */
  date: string;
  /** Mon = 1 ... Sun = 7, in Sydney. */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
  /** Monday to Friday. Says nothing about public holidays. */
  isWeekday: boolean;
  /** Between 10:00 and 16:00 local on a weekday. */
  isDuringTradingHours: boolean;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function exchangeClock(at: Date = new Date()): ExchangeClock {
  const parts = PARTS_FORMAT.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;
  // en-AU with hour12:false renders midnight as "24" rather than "00".
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const minutes = hour * 60 + minute;
  const isWeekday = weekday >= 1 && weekday <= 5;

  return {
    date: exchangeDate(at),
    weekday,
    minutes,
    isWeekday,
    isDuringTradingHours:
      isWeekday &&
      minutes >= MARKET_OPEN_MINUTES &&
      minutes <= MARKET_CLOSE_MINUTES,
  };
}

/**
 * What kind of figure the board's move actually is.
 *
 * The screen is a live quote, taken whenever the run happens — and the run
 * happens in the middle of the Sydney session, which means the change it
 * reports is an INTRADAY figure with hours of trading still to come. The first
 * SBM draft called it "Shares Closed Up ~17.8%" and the desk caught it: the
 * stock went on to move further, so the report described the wrong window and
 * the wrong number in one phrase.
 *
 * The model cannot work this out from a bare percentage, so the market data
 * block states it. Before 13:00 local the session is still young enough that
 * the desk's own house phrase is "morning trade"; after the close it is a
 * close; in between it is intraday.
 */
export type MoveWindow = {
  /** The house phrase: "morning trade", "intraday", "the close". */
  label: string;
  /** Whether this is the official closing figure. */
  isClose: boolean;
  /** Exchange-local clock at the moment the board was read, "12:03". */
  localTime: string;
  /** Whether the market was open then. */
  marketOpen: boolean;
};

/** Local time the session stops being "the morning". */
const MIDDAY_MINUTES = 13 * 60;

export function describeMoveWindow(at: Date = new Date()): MoveWindow {
  const clock = exchangeClock(at);
  const localTime =
    `${String(Math.floor(clock.minutes / 60)).padStart(2, "0")}:` +
    `${String(clock.minutes % 60).padStart(2, "0")}`;

  const marketOpen =
    clock.isWeekday &&
    clock.minutes >= MARKET_OPEN_MINUTES &&
    clock.minutes < MARKET_CLOSE_MINUTES;

  if (!marketOpen) {
    /**
     * Before the open the last print is the previous session's close, and after
     * it the figure is today's close. Either way it is a close, which is the
     * only claim the report needs to get right.
     */
    return { label: "the close", isClose: true, localTime, marketOpen: false };
  }

  return {
    label: clock.minutes < MIDDAY_MINUTES ? "morning trade" : "intraday",
    isClose: false,
    localTime,
    marketOpen: true,
  };
}

/**
 * Whether the market actually traded on the exchange-local date of `asOf`.
 *
 * This is how public holidays are handled, and it is deliberately *not* a
 * hardcoded holiday table. Such a table has to be maintained every year, spans
 * state-by-state differences, and fails silently and invisibly the first year
 * nobody updates it — on a day when the pipeline would then draft a report from
 * yesterday's closing prices and file it under today's date.
 *
 * Instead the market data answers the question itself: the newest quote
 * timestamp across the whole board is today only if the market opened today. On
 * Anzac Day the feed's freshest print is from the previous session, which is
 * exactly the signal to skip.
 */
export function tradedOn(asOf: Date, expectedDate: string): boolean {
  return exchangeDate(asOf) === expectedDate;
}

/** "2026-08-18" -> "Tue 18 Aug", for compact UI labels. */
export function formatExchangeDateShort(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(parsed);
}
