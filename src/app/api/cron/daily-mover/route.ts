import { after, type NextRequest } from "next/server";

import { isDbConfigured } from "@/db";
import {
  generateDraft,
  reapStaleGenerating,
  shouldRunScheduled,
} from "@/lib/drafts/generate";
import { exchangeClock, MARKET_OPEN_MINUTES } from "@/lib/drafts/trading-day";

/**
 * The scheduled Daily Mover draft: Monday to Friday, once per trading day.
 *
 * ## Who calls this, and when
 *
 * **Supabase `pg_cron`, at 00:30 UTC on weekdays — 06:00 IST.** Not Vercel Cron:
 * `vercel.json` has no `crons` key any more. See `drizzle/cron-setup.sql`, which
 * is the schedule's single source of truth, and `npm run db:cron`.
 *
 * The move was about precision. Vercel's Hobby plan schedules with **±59
 * minutes**, so the nominal time is the earliest a job can run rather than when
 * it runs, and this one landed about 29 minutes late every day. The desk wants
 * the draft finished and waiting at 06:00, and "somewhere in the 06:00 hour"
 * does not deliver that. pg_cron fires on the minute.
 *
 * It is also now **one** schedule where `vercel.json` needed two. India has no
 * daylight saving, so 06:00 IST is 00:30 UTC on every day of the year; the pair
 * only ever existed so that an hour of slop would still land inside the Sydney
 * session on both sides of the AEST/AEDT switch. With minute precision there is
 * nothing to straddle, and nothing to change when daylight saving does.
 *
 * The route does not care who calls it. It is idempotent, it authenticates with
 * `CRON_SECRET` whoever presents it, and the window gate below still runs — so
 * adding a Vercel cron back as a belt-and-braces second caller would need no
 * code change, just an entry in `vercel.json`.
 *
 * ## What 06:00 IST actually means for the report
 *
 * ASX continuous trading runs 10:00 to 16:00 local, so 06:00 IST is **half an
 * hour after the open under AEST** — the earliest this report has been drafted.
 * Price-sensitive announcements cluster before the open, so the filings that
 * explain the morning's moves are already out, but the session has five and a
 * half hours left to run: the board's percentage is an **intraday** figure, the
 * day's final move will differ, and the report has to say so. That is not a
 * prompt instruction — `describeMoveWindow` reads the clock the board was taken
 * on and the market data block states the window, because the first SBM draft
 * wrote "Shares Closed Up ~17.8%" for a figure taken at midday.
 *
 * The earlier the run, the thinner the board, and this is the thin end of it: a
 * mover needs $1m of turnover to pass the screen, and half an hour after the
 * open many of the day's real movers have not traded that yet — some sessions
 * will screen a board the old 11:15 run would not have recognised. That is the
 * trade the desk asked for: coverage given up for a draft that is already
 * waiting when the desk sits down.
 *
 * ## What "exactly 06:00" is and is not
 *
 * pg_cron starts the job within a second of 00:30 UTC. What follows is not
 * instant: `pg_net` dispatches the HTTP request asynchronously, and a cold
 * Vercel function takes a few seconds to answer. So the *request* is exact and
 * the draft is not — generation runs in `after()` and takes two to five minutes,
 * which is the number that matters for "waiting when the desk sits down".
 *
 * The failure mode to know about: `cron.job_run_details` records success as soon
 * as the request is *queued*, because pg_net is asynchronous. The HTTP status
 * lives in `net._http_response` instead. `drizzle/cron-setup.sql` has the two
 * queries worth keeping.
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
 * Wide on purpose, and it **starts at the opening bell** rather than an hour in.
 * That floor is forced by the 06:00 IST schedule: 00:30 UTC is 10:30 in Sydney
 * under AEST and 11:30 under AEDT. The 11:00 start this had when the job ran at
 * 06:45 IST would reject the AEST firing outright — for the six months of the
 * year Sydney is on AEST, every day would be skipped with a cheerful `ok: true`,
 * which is the quietest possible way for this to break.
 *
 * The floor is the open itself and not lower, because before 10:00 there is no
 * continuous trading to screen: the board would be an opening auction, not a
 * session. The end stays at 15:00, so the window still spans the session and
 * still admits a manual or backfill trigger at any sane hour.
 *
 * Dedupe does not live here and never did. The partial unique index on
 * `(move_date) WHERE trigger = 'cron'` is what makes a second caller a no-op, so
 * the window can afford to be loose — it is a sanity gate on the clock, not the
 * thing keeping the review queue to one draft a day.
 */
const WINDOW_START_MINUTES = MARKET_OPEN_MINUTES;
const WINDOW_END_MINUTES = 15 * 60;

/**
 * 300 seconds, which is both the Hobby plan's ceiling and every plan's default
 * — so this deploys anywhere. Anything above 300 fails the *build* on Hobby
 * rather than failing at runtime, which is how it should be found.
 *
 * A measured end-to-end run (screen ~1,200 tickers, shortlist, select, download
 * and read the filings, generate, render, upload) took about 120 seconds before
 * the Accuracy Gate was added, and around 200 seconds with it — the gate is one
 * more model call over the same corpus, cheap in wall-clock because the corpus
 * is served from cache, and a rewrite adds another pass when
 * `warrantsRewrite` calls for one.
 *
 * That 200 was measured on Sonnet 5 writing a seven-page report. The drafting
 * model is now Opus 5 and the report is four or five pages, which trades a
 * slower model against roughly half the output tokens; the run has not been
 * re-measured. The deadline guards in `lib/drafts/generate.ts` are what keep
 * the invocation inside the ceiling either way.
 *
 * The margin is real but no longer generous, so both optional stages are
 * budgeted rather than assumed: see `CHECK_DEADLINE_MS` and
 * `REWRITE_DEADLINE_MS` in `lib/drafts/generate.ts`. The rewrite is dropped
 * before the check, because the findings are useful to a human on their own.
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
      skipped: `outside the drafting window (Sydney local time is ${localTime}, window 10:00-15:00)`,
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
