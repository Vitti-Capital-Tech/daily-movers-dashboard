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

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
