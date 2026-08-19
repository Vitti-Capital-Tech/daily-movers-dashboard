export type Direction = "up" | "down";

/**
 * Direction is always derived from the sign of the move, never stored.
 * Storing it separately would let it contradict the number.
 */
export function directionOf(movePct: number): Direction {
  return movePct < 0 ? "down" : "up";
}

export function formatPct(movePct: number): string {
  const sign = movePct > 0 ? "+" : movePct < 0 ? "-" : "";
  return `${sign}${Math.abs(movePct).toFixed(2)}%`;
}

export function arrowOf(movePct: number): string {
  return movePct < 0 ? "↓" : "↑";
}

export function upDownLabel(movePct: number): string {
  return movePct < 0 ? "Down" : "Up";
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * `move_date` is a Postgres DATE, so it arrives as "YYYY-MM-DD" with no time
 * or zone. Formatted by string parts on purpose -- `new Date("2026-08-17")`
 * parses as UTC midnight and can render as the 16th west of Greenwich.
 */
export function formatMoveDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const monthIndex = Number(month) - 1;
  if (!year || !day || Number.isNaN(monthIndex) || !MONTHS[monthIndex]) {
    return iso;
  }
  return `${Number(day)} ${MONTHS[monthIndex]} ${year}`;
}

export function formatPrice(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toFixed(2)}`;
}

/**
 * A return that may not be known yet. Distinct from `formatPct`, which takes a
 * number and assumes there is one -- here "—" is a real answer, meaning either
 * the window hasn't elapsed or we have no price for the ticker.
 */
export function formatReturn(value: number | null): string {
  return value === null ? "—" : formatPct(value);
}

/**
 * Quote timestamps are rendered in ASX time whoever is looking, because that's
 * the session the price belongs to. The timezone is passed explicitly so the
 * server and the browser produce the same string and hydration stays quiet.
 */
const QUOTE_TIME_FORMAT = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Australia/Sydney",
});

export function formatQuoteTime(value: Date | null): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return `${QUOTE_TIME_FORMAT.format(value)} AEST`;
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
