-- The scheduled Daily Mover trigger, moved off Vercel Cron onto pg_cron.
--
-- Apply with:  npm run db:cron
-- Safe to re-run.
--
-- WHY THIS MOVED
--
-- Vercel's Hobby plan schedules cron jobs with ±59 minutes of precision: the
-- nominal time is the earliest a job can run, not when it runs. In practice this
-- one landed about 29 minutes late every day (the 7-10 Sep 2026 draft rows were
-- all written at 01:59 UTC against a 01:30 schedule). The desk wants the draft
-- finished and waiting at 06:00 IST, and "somewhere in the 06:00 hour" does not
-- deliver that. pg_cron fires on the minute.
--
-- The run was a single 06:00 IST job (00:30 UTC) until Oct 2026, when the desk
-- pinned it to 10:45 Sydney time instead. See "10:45 SYDNEY" below for why that
-- takes two jobs. The handler's Sydney window gate still runs and still guards a
-- mis-fire.
--
-- pg_cron reads schedules in the server's `cron.timezone`, which is UTC on
-- Supabase. The expressions below are therefore UTC. Do not "correct" them to
-- Sydney time.

-- Both extensions ship with Supabase but are off until asked for. pg_cron is
-- non-relocatable (it installs into pg_catalog and creates the `cron` schema
-- itself), so it takes no `with schema` clause.
create extension if not exists pg_cron;
--> statement-breakpoint

create extension if not exists pg_net;
--> statement-breakpoint

grant usage on schema cron to postgres;
--> statement-breakpoint

-- The URL and the cron secret live in Supabase Vault rather than in the job
-- command, because `cron.job.command` is stored in plain text and shows up in
-- the dashboard, in `cron.job_run_details`, and in any schema dump. Seeded by
-- scripts/cron-setup.mts from .env.local -- they are never written to this file.
create or replace function public.trigger_daily_mover()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $fn$
declare
  target_url  text;
  cron_secret text;
  request_id  bigint;
begin
  select decrypted_secret into target_url
    from vault.decrypted_secrets
    where name = 'daily_mover_cron_url';

  select decrypted_secret into cron_secret
    from vault.decrypted_secrets
    where name = 'daily_mover_cron_secret';

  -- Fail loudly. A job that quietly sent an unauthenticated request every
  -- morning would show up as a 401 in a table nobody reads, and the desk would
  -- just see no draft -- the same symptom as every other failure mode.
  if target_url is null or cron_secret is null then
    raise exception
      'vault secrets daily_mover_cron_url / daily_mover_cron_secret are missing; run: npm run db:cron';
  end if;

  select net.http_get(
    url := target_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'User-Agent', 'pg_cron-daily-mover'
    ),
    -- pg_net defaults to one or two seconds depending on version, which a cold
    -- Vercel function will not answer inside. A pg_net timeout is recorded as a
    -- failed response even when the route received the request and went on to
    -- draft the report, so the default would leave the only health signal this
    -- job has permanently red. The route itself replies in well under a second
    -- once warm -- it hands the real work to `after()` -- so 30s is headroom for
    -- the cold start, not an expected duration.
    timeout_milliseconds := 30000
  ) into request_id;

  return request_id;
end;
$fn$;
--> statement-breakpoint

-- 10:45 SYDNEY, WHICH TAKES TWO JOBS
--
-- The desk now wants the run pinned to 10:45 Sydney time, not 06:00 IST. Sydney
-- observes daylight saving and pg_cron only reads UTC, so one wall-clock time is
-- two UTC expressions:
--
--   AEDT (UTC+11, Oct-Apr): 10:45 Mon-Fri = 23:45 UTC Sun-Thu  -> '45 23 * * 0-4'
--   AEST (UTC+10, Apr-Oct): 10:45 Mon-Fri = 00:45 UTC Mon-Fri  -> '45 0 * * 1-5'
--
-- Both jobs fire all year. The out-of-season one is harmless because of the
-- route's own guards: under AEST the 23:45 UTC firing is 09:45 in Sydney, before
-- the 10:00 window floor, so it answers `ran: false`; under AEDT the 00:45 UTC
-- firing is 11:45, after the 10:45 run has written the day's cron row, so
-- `shouldRunScheduled` finds it and skips. If the 10:45 request was lost
-- outright, that 11:45 firing doubles as a one-hour-late retry.
--
-- The old single 06:00 IST job is removed first. `cron.unschedule(name)` raises
-- when the name is missing, so it goes through `cron.job` to stay re-runnable.
select cron.unschedule(jobid) from cron.job where jobname = 'daily-mover-draft';
--> statement-breakpoint

-- `cron.schedule` upserts on the job name, so re-running this file re-points the
-- existing jobs rather than stacking up duplicates that would each fire.
select cron.schedule(
  'daily-mover-draft-aedt',
  '45 23 * * 0-4',
  $job$select public.trigger_daily_mover();$job$
);
--> statement-breakpoint

select cron.schedule(
  'daily-mover-draft-aest',
  '45 0 * * 1-5',
  $job$select public.trigger_daily_mover();$job$
);
--> statement-breakpoint

-- THE DRAFT EMAIL SWEEP
--
-- The draft route emails each scheduled draft itself as soon as it lands, by
-- calling /api/cron/draft-email?id=<id>. This job is the safety net for a
-- hand-off that never arrived or a Resend send that failed: once a day it calls
-- the same route with no id, which mails every recent pending scheduled draft
-- that has not been sent yet. `mover_drafts.emailed_at` keeps it from sending
-- anything twice.
--
-- 01:15 UTC is 12:15 Sydney under AEDT and 11:15 under AEST: comfortably after
-- the 10:45 draft in both seasons, so one expression serves all year.
--
-- The URL is derived from the draft route's Vault secret rather than stored a
-- second time, so `npm run db:cron -- <url>` still re-points everything at once.
create or replace function public.trigger_draft_email()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $fn$
declare
  draft_url   text;
  cron_secret text;
  request_id  bigint;
begin
  select decrypted_secret into draft_url
    from vault.decrypted_secrets
    where name = 'daily_mover_cron_url';

  select decrypted_secret into cron_secret
    from vault.decrypted_secrets
    where name = 'daily_mover_cron_secret';

  if draft_url is null or cron_secret is null then
    raise exception
      'vault secrets daily_mover_cron_url / daily_mover_cron_secret are missing; run: npm run db:cron';
  end if;

  select net.http_get(
    url := regexp_replace(draft_url, '/api/cron/daily-mover.*$', '/api/cron/draft-email'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'User-Agent', 'pg_cron-draft-email'
    ),
    timeout_milliseconds := 30000
  ) into request_id;

  return request_id;
end;
$fn$;
--> statement-breakpoint

select cron.schedule(
  'daily-mover-email-sweep',
  '15 1 * * 1-5',
  $job$select public.trigger_draft_email();$job$
);
--> statement-breakpoint

-- OBSERVABILITY
--
-- pg_net is asynchronous: http_get returns a request id immediately and the
-- response lands later, so `cron.job_run_details` showing "succeeded" only means
-- the request was *queued*. The HTTP status is the thing worth checking:
--
--   select r.id, r.status_code, r.created
--     from net._http_response r
--     order by r.created desc limit 10;
--
--   select jobid, status, return_message, start_time
--     from cron.job_run_details
--     where jobid in (select jobid from cron.job where jobname like 'daily-mover-%')
--     order by start_time desc limit 10;
--
-- A 200 with `{"ran": false}` in the body is not a failure -- see the route's
-- skip guards (weekend, already published, already drafted, outside the window).
-- Whether a draft was mailed is on the row itself:
--
--   select id, ticker, emailed_at, email_error
--     from mover_drafts where trigger = 'cron'
--     order by created_at desc limit 5;
--
-- To stop the jobs:  select cron.unschedule('daily-mover-draft-aedt');
--                    select cron.unschedule('daily-mover-draft-aest');
--                    select cron.unschedule('daily-mover-email-sweep');
-- To fire it by hand: select public.trigger_daily_mover();
--                     select public.trigger_draft_email();
