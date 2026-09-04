import { after, type NextRequest } from "next/server";

import { isDbConfigured } from "@/db";
import {
  generateDraft,
  reapStaleGenerating,
  shouldRunScheduled,
} from "@/lib/drafts/generate";
import { exchangeClock } from "@/lib/drafts/trading-day";

/**
 * The scheduled Daily Mover draft: Monday to Friday, once per trading day.
 *
 * ## Why it fires twice a day in `vercel.json`
 *
 * Vercel cron expressions are **UTC only** — there is no timezone field. The
 * desk wants this at lunchtime in Sydney, and Sydney is UTC+10 for half the
 * year and UTC+11 for the other half, so a single UTC expression is an hour
 * wrong for six months at a time.
 *
 * So it is scheduled at both 01:30 and 02:30 UTC, and this handler checks that
 * the firing lands in the middle of the Sydney session before doing anything.
 * Under AEST those firings are 11:30 and 12:30 local; under AEDT, 12:30 and
 * 13:30. Both pass the window, and the first one to arrive does the work — the
 * second is a no-op against the day's unique index. Nothing has to be changed
 * when daylight saving starts or ends.
 *
 * ## Why lunchtime
 *
 * ASX continuous trading runs 10:00 to 16:00 local, and price-sensitive
 * announcements cluster before the open. By 12:30 the morning's moves are
 * established and the filings that explain them are out — which is also why
 * the desk's own notes are headed "Morning Trade" and "Intraday" rather than
 * written after the close. It leaves the afternoon for an analyst to review,
 * edit and approve.
 */

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that environment
 * variable is set. Without it the endpoint would be an unauthenticated way for
 * anyone to spend the desk's Claude budget, so a missing secret disables the
 * route rather than leaving it open.
 */
function isAuthorisedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * The local-time window a firing must fall inside to count.
 *
 * Wide on purpose. The obvious design — accept only within 40 minutes of 12:30,
 * so exactly one of the two UTC firings acts — breaks on Vercel's Hobby plan,
 * where cron scheduling precision is **±59 minutes**: a job set for 01:30 UTC
 * can land anywhere in the 01:00 hour, which can fall outside a narrow window
 * and skip the day entirely.
 *
 * So the window spans the middle of the session instead, and *both* firings are
 * allowed to pass it. Only one draft is still produced, because the partial
 * unique index on `(move_date) WHERE trigger = 'cron'` makes the second firing a
 * no-op — the dedupe was always in the database, and the narrow window was only
 * ever belt-and-braces. Whichever firing arrives first does the work: 11:30
 * Sydney under AEST, 12:30 under AEDT, both well into the session.
 */
const WINDOW_START_MINUTES = 11 * 60;
const WINDOW_END_MINUTES = 15 * 60;

/**
 * 300 seconds, which is both the Hobby plan's ceiling and every plan's default
 * — so this deploys anywhere. Anything above 300 fails the *build* on Hobby
 * rather than failing at runtime, which is how it should be found.
 *
 * It is also comfortably enough: a measured end-to-end run (screen ~1,200
 * tickers, shortlist, select, download and read 25 announcement PDFs, generate,
 * render, upload) takes about 120 seconds.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorisedCron(request)) {
    return Response.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }

  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: "DATABASE_URL is not set" }, { status: 503 });
  }

  const clock = exchangeClock();

  /**
   * `?force=1` skips only the time-window check, so an operator holding the
   * cron secret can run a session that was missed — a deploy during the window,
   * or a failure worth retrying — without waiting until tomorrow. The guards
   * that actually matter still apply: it will not run on a weekend, will not
   * run if an analyst has already published for the day, and will not create a
   * second scheduled draft for a day that already has one.
   */
  const forced = request.nextUrl.searchParams.get("force") === "1";

  const localTime =
    `${String(Math.floor(clock.minutes / 60)).padStart(2, "0")}:` +
    `${String(clock.minutes % 60).padStart(2, "0")}`;

  const inWindow =
    clock.minutes >= WINDOW_START_MINUTES && clock.minutes <= WINDOW_END_MINUTES;

  if (!forced && !inWindow) {
    // Fired outside the session's middle — nothing to do, and not an error.
    return Response.json({
      ok: true,
      ran: false,
      skipped: `outside the drafting window (Sydney local time is ${localTime}, window 11:00-15:00)`,
    });
  }

  /**
   * Before the day's own checks: clear any `generating` row left behind by an
   * invocation that was killed mid-pipeline. Without this, one dead run would
   * hold the day's unique index and block every later attempt — so a single
   * infrastructure blip would cost every subsequent day's draft, not just its
   * own.
   */
  const reaped = await reapStaleGenerating();

  const decision = await shouldRunScheduled(clock.date, clock.weekday);
  if (decision.skip) {
    return Response.json({
      ok: true,
      ran: false,
      reaped,
      skipped: decision.because,
    });
  }

  /**
   * Handed to `after` so the cron invocation gets its response immediately and
   * Vercel records a fast success rather than a request held open for minutes.
   * The function stays alive until the promise settles — that is what `after`
   * is for — and the draft row is already visible in the review queue while it
   * works.
   */
  after(async () => {
    const outcome = await generateDraft({
      actorEmail: null,
      trigger: "cron",
      moveDate: clock.date,
    });

    if (outcome.ok) {
      console.log(
        `scheduled draft ${outcome.draftId} written for ${outcome.ticker} (${clock.date})`,
      );
    } else {
      console.error(
        `scheduled draft for ${clock.date} failed: ${outcome.reason}`,
      );
    }
  });

  return Response.json({
    ok: true,
    ran: true,
    forced,
    reaped,
    moveDate: clock.date,
    note: "generation started; poll the Mover Studio for progress",
  });
}
