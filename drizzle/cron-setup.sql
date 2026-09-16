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
-- WHY THIS IS ONE JOB WHERE vercel.json NEEDED TWO
--
-- India does not observe daylight saving, so 06:00 IST is 00:30 UTC on every day
-- of the year and a single UTC expression is correct all year. The Vercel pair
-- existed only because ±59 minutes of slop had to straddle Sydney's DST switch;
-- with minute precision there is nothing to straddle. The handler's Sydney
-- window gate still runs and still guards a mis-fire -- 00:30 UTC is 10:30 in
-- Sydney under AEST and 11:30 under AEDT, and both sit inside it.
--
-- pg_cron reads schedules in the server's `cron.timezone`, which is UTC on
-- Supabase. The expression below is therefore UTC. Do not "correct" it to 06:00.

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

-- `cron.schedule` upserts on the job name, so re-running this file re-points the
-- existing job rather than stacking up duplicates that would each fire.
select cron.schedule(
  'daily-mover-draft',
  '30 0 * * 1-5',
  $job$select public.trigger_daily_mover();$job$
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
--     where jobid = (select jobid from cron.job where jobname = 'daily-mover-draft')
--     order by start_time desc limit 10;
--
-- A 200 with `{"ran": false}` in the body is not a failure -- see the route's
-- skip guards (weekend, already published, already drafted, outside the window).
--
-- To stop the job:   select cron.unschedule('daily-mover-draft');
-- To fire it by hand: select public.trigger_daily_mover();
