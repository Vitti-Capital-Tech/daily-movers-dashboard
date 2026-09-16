import "server-only";

import { eq } from "drizzle-orm";

import { getDb, isDbConfigured } from "@/db";
import { screenSettings } from "@/db/schema";
import {
  DEFAULT_SCREEN,
  SCREEN_LIMITS,
  type ScreenCriteria,
} from "@/lib/asx/types";

/**
 * The stored screen: what the next draft runs with unless a caller overrides it.
 *
 * The Studio's four controls used to apply to one run and then evaporate, so an
 * analyst who widened the board on Tuesday got the compiled defaults again at
 * 06:00 on Wednesday. Changing those fields means "screen like this from now
 * on", so `startDraftAction` writes them here and both the form and the
 * scheduled run read them back.
 *
 * `DEFAULT_SCREEN` remains the floor under all of it. It is returned whenever
 * the row is absent, and -- importantly -- whenever reading it fails at all.
 */

/** The singleton row. There is only ever one screen in force. */
const SETTINGS_ID = 1;

/**
 * Clamps and rounds a stored or submitted value into the range the UI
 * advertises.
 *
 * Applied on the way *out* of the database as well as in, because the row can
 * be edited by hand -- that is half the point of a plain table -- and a screen
 * of `perSide: 4000` typed into psql at 06:05 should not reach the pipeline.
 * The columns are integers, so rounding also keeps a crafted `5.5` from
 * reaching a column that cannot hold it.
 */
function clamp(field: keyof ScreenCriteria, value: number): number {
  const limits = SCREEN_LIMITS[field];
  if (!Number.isFinite(value)) return DEFAULT_SCREEN[field];
  return Math.round(Math.min(Math.max(value, limits.min), limits.max));
}

function normalise(criteria: ScreenCriteria): ScreenCriteria {
  return {
    minTurnover: clamp("minTurnover", criteria.minTurnover),
    minMarketCap: clamp("minMarketCap", criteria.minMarketCap),
    minAbsChangePct: clamp("minAbsChangePct", criteria.minAbsChangePct),
    perSide: clamp("perSide", criteria.perSide),
  };
}

/**
 * The screen in force, or `DEFAULT_SCREEN` if there isn't one.
 *
 * Never throws. This is called from the scheduled run, and the failure it is
 * most likely to meet is the table not existing yet -- the window between a
 * deploy and `npm run db:apply` on a morning when someone shipped in a hurry.
 * Losing a customised screen for one session is a bad day; losing the whole
 * draft because a settings lookup threw is a worse one, so a broken read
 * degrades to the compiled defaults and says so in the log.
 */
export async function loadScreenCriteria(): Promise<ScreenCriteria> {
  if (!isDbConfigured()) return DEFAULT_SCREEN;

  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(screenSettings)
      .where(eq(screenSettings.id, SETTINGS_ID))
      .limit(1);

    if (!row) return DEFAULT_SCREEN;

    return normalise({
      minTurnover: row.minTurnover,
      minMarketCap: row.minMarketCap,
      minAbsChangePct: row.minAbsChangePct,
      perSide: row.perSide,
    });
  } catch (error) {
    console.error(
      "screen settings unreadable, falling back to DEFAULT_SCREEN:",
      error instanceof Error ? error.message : error,
    );
    return DEFAULT_SCREEN;
  }
}

/**
 * Stores the screen for every later run. Returns what was actually written.
 *
 * Upsert on the fixed id, so the table stays a singleton without needing a
 * constraint to say so, and so the first save creates the row rather than
 * requiring a seeded migration.
 *
 * Throws nothing to the caller for the same reason as `loadScreenCriteria`:
 * this is called on the way into starting a draft, and a settings write that
 * fails should not cost the analyst the draft they asked for.
 */
export async function saveScreenCriteria(
  criteria: ScreenCriteria,
  updatedBy: string | null,
): Promise<ScreenCriteria> {
  const values = normalise(criteria);
  if (!isDbConfigured()) return values;

  try {
    const db = getDb();
    await db
      .insert(screenSettings)
      .values({ id: SETTINGS_ID, ...values, updatedBy })
      .onConflictDoUpdate({
        target: screenSettings.id,
        set: { ...values, updatedBy, updatedAt: new Date() },
      });
  } catch (error) {
    console.error(
      "could not persist screen settings:",
      error instanceof Error ? error.message : error,
    );
  }

  return values;
}
