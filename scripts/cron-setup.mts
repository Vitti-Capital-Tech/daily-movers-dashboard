/**
 * Points pg_cron at the Daily Mover route. Safe to re-run.
 *
 *   npm run db:cron -- https://your-app.vercel.app
 *
 * The URL is remembered in Vault after the first run, so later runs can omit it.
 *
 * Two steps, in this order, because the function created by the SQL raises if
 * the secrets are missing:
 *
 *   1. Seed `daily_mover_cron_url` and `daily_mover_cron_secret` into Supabase
 *      Vault from .env.local. They go to Vault rather than into the job command
 *      because `cron.job.command` is plain text in the dashboard and in dumps.
 *   2. Apply drizzle/cron-setup.sql -- extensions, the wrapper function, and the
 *      00:30 UTC (06:00 IST) schedule.
 *
 * Why not Vercel Cron: Hobby schedules with ±59 minutes of precision and this
 * job ran ~29 minutes late every day. See drizzle/cron-setup.sql.
 */
import { spawnSync } from "node:child_process";

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
const cronSecret = process.env.CRON_SECRET?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is not set in .env.local.");
  process.exit(1);
}

if (!cronSecret) {
  console.error(
    "CRON_SECRET is not set in .env.local.\n" +
      "It must be the SAME value as the Vercel project's CRON_SECRET, or the\n" +
      "route will answer 401. Generate one with:\n" +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
  );
  process.exit(1);
}

const ROUTE_PATH = "/api/cron/daily-mover";

/** `npm run db:cron -- <url>` passes the URL through as the first real argument. */
function targetUrlFromArgv(): string | null {
  const raw = process.argv[2]?.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    console.error(`Not a URL: ${raw}`);
    process.exit(1);
  }

  if (parsed.protocol !== "https:") {
    // The bearer token is in a header. Over http it is on the wire in clear.
    console.error(`Refusing a non-https target: ${raw}`);
    process.exit(1);
  }

  // Accept either the bare origin or the full route, so both spellings work.
  if (parsed.pathname === "/" || parsed.pathname === "") {
    parsed.pathname = ROUTE_PATH;
  }
  return parsed.toString();
}

const sql = postgres(databaseUrl, { prepare: false, ssl: "require", max: 1 });

/**
 * Vault has no upsert: `create_secret` throws on a duplicate name, and
 * `update_secret` needs the id. So look first, then branch.
 */
async function putSecret(name: string, value: string, description: string) {
  const [existing] = await sql<{ id: string }[]>`
    select id from vault.secrets where name = ${name}
  `;

  if (existing) {
    await sql`select vault.update_secret(${existing.id}::uuid, ${value}, ${name}, ${description})`;
    console.log(`  – ${name}  (updated)`);
  } else {
    await sql`select vault.create_secret(${value}, ${name}, ${description})`;
    console.log(`  ✓ ${name}  (created)`);
  }
}

const argvUrl = targetUrlFromArgv();

const [storedUrl] = await sql<{ decrypted_secret: string }[]>`
  select decrypted_secret from vault.decrypted_secrets
  where name = 'daily_mover_cron_url'
`;

const targetUrl = argvUrl ?? storedUrl?.decrypted_secret ?? null;

if (!targetUrl) {
  console.error(
    "No target URL. Pass the deployed origin once and it is remembered:\n" +
      "  npm run db:cron -- https://your-app.vercel.app",
  );
  await sql.end({ timeout: 5 });
  process.exit(1);
}

console.log(`Target: ${targetUrl}\n`);
console.log("Vault secrets:");
await putSecret("daily_mover_cron_url", targetUrl, "Daily Mover cron endpoint");
await putSecret(
  "daily_mover_cron_secret",
  cronSecret,
  "Bearer token for the Daily Mover cron route",
);

await sql.end({ timeout: 5 });

console.log("\nSchema:");
const applied = spawnSync(
  process.execPath,
  [
    ...process.execArgv,
    process.argv[1].replace(/cron-setup\.mts$/, "apply-sql.mts"),
    "drizzle/cron-setup.sql",
  ],
  { stdio: "inherit" },
);

if (applied.status !== 0) process.exit(applied.status ?? 1);

/**
 * Read the schedule back from the database rather than printing what was asked
 * for. `cron.schedule` silently accepts an expression the daemon later rejects,
 * and this is the only place the difference would show up before 06:00 IST.
 */
const verify = postgres(databaseUrl, { prepare: false, ssl: "require", max: 1 });
const [job] = await verify<
  { jobname: string; schedule: string; active: boolean; command: string }[]
>`
  select jobname, schedule, active, command
  from cron.job where jobname = 'daily-mover-draft'
`;
const [tz] = await verify<{ tz: string }[]>`select current_setting('cron.timezone', true) as tz`;
await verify.end({ timeout: 5 });

if (!job) {
  console.error("\nThe job was not created. Check the errors above.");
  process.exit(1);
}

console.log(
  `\nScheduled "${job.jobname}": ${job.schedule} ${tz?.tz ?? "UTC"}` +
    ` — 06:00 IST, Mon-Fri. active=${job.active}`,
);
console.log(
  "\nVerify tomorrow morning with:\n" +
    "  select status_code, created from net._http_response order by created desc limit 5;\n" +
    "\nFire it now (the route's own guards still apply):\n" +
    "  select public.trigger_daily_mover();",
);
