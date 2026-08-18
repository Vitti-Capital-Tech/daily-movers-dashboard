# Daily Movers Dashboard

Searchable archive of Vitti Capital Daily Mover research, so that when a company
comes up again you can immediately see what we said last time.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind 4 + shadcn/ui (Base UI primitives) |
| Database | Postgres (Supabase) |
| Auth | Supabase Auth — email magic link |
| Data access | Drizzle ORM + postgres.js |
| Validation | Zod |

## Setup

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL + Supabase keys
npm run db:push                # create the tables
npm run db:auth                # auth trigger, domain allowlist, admin seed
npm run db:seed                # catalysts, analyst, JBH + SPZ samples
npm run dev
```

> `db:push` currently crashes once `profiles.id` references `auth.users` —
> drizzle-kit fails introspecting a CHECK constraint in Supabase's `auth`
> schema. Use `npm run db:generate` then `npm run db:apply <file.sql>` instead;
> the generated SQL is reviewable, which is arguably better anyway.

### DATABASE_URL

Use the **pooler** connection string from Supabase → Project Settings →
Database, not the direct `db.<ref>.supabase.co` host — that host is IPv6-only
and unreachable from many networks.

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Note the username is `postgres.<project-ref>`, not plain `postgres`. The
password is the **database** password — not the anon key, and not your Supabase
account password.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build (runs typegen + typecheck) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a SQL migration from the schema |
| `npm run db:push` | Push the schema straight to the database |
| `npm run db:migrate` | Apply generated migrations |
| `npm run db:apply <f>` | Apply one .sql file, statement by statement, re-runnably |
| `npm run db:auth` | Apply `drizzle/auth-setup.sql` (trigger, allowlist, admin seed) |
| `npm run db:seed` | Idempotent seed |
| `npm run db:studio` | Drizzle Studio |

## Auth

**Sign-in is by email address alone.** Type an `@vitti.capital` address and
you're in. No password, no emailed link, no verification.

> ### Read this before deploying
>
> This is **identification, not authentication**. Nothing proves the person owns
> the address they typed. Anyone who can reach the login page and knows a
> colleague's address gets that person's access — including admin write access
> to the research archive.
>
> It is fine behind a VPN, on localhost, or on a URL only staff can reach. It is
> not fine on a public URL. The fix, when wanted, is to add a verification step
> back into `signIn()` in `src/app/login/actions.ts`; everything else —
> sessions, roles, middleware, RLS — stays as it is.

**Sessions** are an HMAC-SHA256-signed cookie (`vitti_session`), signed with
`AUTH_SECRET`. The signature stops a visitor editing their own cookie to become
an admin; it can't stop them typing someone else's address at the login screen.
Rotating `AUTH_SECRET` signs everyone out. 30-day expiry.

**Roles:** `admin` if the address is in `admin_emails`, otherwise `viewer`.
Looked up on every request rather than stored on a user row, so there is no
second copy to fall out of sync and revoking takes effect immediately:

```sql
INSERT INTO admin_emails (email, note) VALUES ('someone@vitti.capital', 'why');
DELETE FROM admin_emails WHERE email = 'someone@vitti.capital';   -- revoke
```

`app_users` records who has signed in. It's audit only — role is never read from
it.

**Where enforcement lives:**

| Layer | Protects against | Mechanism |
| --- | --- | --- |
| Middleware | Unauthenticated page access | Verifies the cookie, redirects to `/login` |
| `(app)/layout.tsx` | A middleware misconfiguration | Re-checks server-side |
| `assertCanWrite()` | Non-admins calling a Server Action directly | `requireAdmin()` at the top of every write |
| RLS | Anyone using the public anon key | RLS on, zero policies — see below |

Hiding the Add/Edit buttons is a courtesy, not a control: a Server Action is a
public HTTP endpoint, so the check has to be server-side.

The domain rule is re-checked when the cookie is read, not just at sign-in, so
narrowing `ALLOWED_EMAIL_DOMAIN` invalidates existing sessions.

### Why RLS has no policies

`NEXT_PUBLIC_SUPABASE_ANON_KEY` ships to the browser, so anyone can call
Supabase's auto-generated REST API with it. Every table therefore has RLS
enabled and **no policies at all**, which makes that API return nothing and
refuse writes. The app is unaffected because Drizzle connects as the table
owner, which bypasses RLS.

The consequence to know about: any future feature that queries Supabase
*directly from the browser* will read zero rows until a policy is added
deliberately. All data access is meant to go through Drizzle server-side.

## Deploying to Vercel

> **Read the Auth warning above first.** Deploying puts this on a public URL,
> and sign-in currently accepts any `@vitti.capital` address on trust. Add a
> verification step, or gate the deployment, before it goes live.

**Environment variables** (Vercel → Settings → Environment Variables):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The pooler URI, port 6543, username `postgres.<ref>` |
| `AUTH_SECRET` | A **fresh** 32-byte hex string, not the local one |
| `NEXT_PUBLIC_SUPABASE_URL` | Needed again since report upload landed — the browser uploads direct to Storage |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same. Public by design; safe because RLS has no policies |
| `SUPABASE_SERVICE_ROLE_KEY` | Signs upload and download URLs. **Server-side only** — never `NEXT_PUBLIC_*` |

> Paste values **without** surrounding quotes. Vercel stores them verbatim, so
> `"postgres://…"` becomes a different string and fails to parse. Env vars are
> read at build time — **redeploy after adding one.**

Generate a separate production secret so a leaked dev value can't mint
production sessions:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Function region.** `vercel.json` pins functions to `hnd1` (Tokyo) because the
Supabase project is in `ap-northeast-1`. Vercel defaults to US East, which adds
roughly 150–200 ms per query round trip — and the table page issues several
queries. If a deploy complains about the region (plan restrictions), delete
`vercel.json` and set the region in Vercel → Settings → Functions instead.

**Connection pooling** is already handled: `src/db/index.ts` drops the pool to a
single connection when `process.env.VERCEL` is set, because each concurrent
invocation is its own process with its own pool. Supabase's pooler does the real
pooling.

**No migration step.** The schema is already applied to the Supabase project,
and production uses the same database as local development — so deploying does
not need `db:push`, but it does mean the live site and your local dev server
edit the same rows. Create a second Supabase project if you want them separate.

**Steps**

```bash
npm i -g vercel
vercel login
vercel link          # connect this repo to a Vercel project
vercel --prod        # or just push to main once GitHub is connected
```

Connecting the GitHub repo in the Vercel dashboard is the better path: every
push to `main` deploys, and pull requests get preview URLs.

**After the first deploy, check:** signing in works, `/daily-movers` shows both
seeded rows, and the account menu opens (that last one is client-side only, so
it isn't covered by the server-rendered checks).

## Layout

```
src/
  app/
    daily-movers/        table view + Server Actions (create/update/delete)
    companies/           company list
    companies/[ticker]/  research history — the point of the app
  components/
    daily-movers/        filter bar, table, form dialog, row actions
    ui/                  shadcn primitives
  db/
    schema.ts            tables, indexes, relations
    seed.ts              catalysts, analysts, companies, sample movers
  lib/
    movers.ts            types + constants shared with client components
    queries.ts           server-only data access
    validation.ts        Zod schema for the form
```

## Design decisions worth knowing

**`company_id` foreign key, never a ticker string.** The company field is a
combobox over the `companies` table, so every save resolves to an id. Matching
on text is how `JBH` and `JBH.AX` silently split one company's history in two —
which would defeat the whole purpose of the app.

**Catalyst is a lookup table.** Free text would give you "Earnings Result",
"Earnings result" and "FY26 Results" as three separate filter options.

**Direction is derived, never stored.** `move_pct` is signed; Up/Down and ↑/↓
come from its sign. Storing them separately lets them contradict the number.

Related: the source PDFs print the magnitude only (`~11.5%`) with the direction
in the prose ("Shares **Fall** as Much as…"), so extraction must take the sign
from the headline, not the figure.

**`move_window_label`.** Reports don't all say "Intraday" — the SPZ report says
"Morning Trade". That maps to `intraday` for filtering, with the verbatim
wording kept alongside so nothing is lost.

**`extraction` jsonb.** Reserved for the raw structured output of PDF
extraction, stored next to the saved row so an improved prompt can be re-run
over the archive later and diffed against what was actually saved.

**Filtering happens in SQL.** Client-side filtering looks fine on 20 rows and
quietly dies at a few thousand.

**`lib/queries.ts` is `server-only`.** It imports the Postgres driver, so
anything a client component needs at runtime lives in `lib/movers.ts` instead.

## Not done yet

- **PDF upload + extraction.** Schema fields exist (`report_storage_path`,
  `extraction`); the pipeline does not.
- **Adding new companies from the UI.** Companies come from the seed for now.
- **Admin screen for `admin_emails`.** Granting write access is a SQL statement
  (above), not a UI.
- **Rate limiting on the magic-link endpoint.** Supabase applies its own send
  limits, but there's nothing app-side.

## Open question

For JBH the announcement was the FY26 result, but the sell-off followed the weak
July FY27 trading update. The seed records the catalyst as `trading_update` (the
price-moving event). If the convention should instead be the announcement,
change it in `src/db/seed.ts` — the same decision determines what the extraction
prompt will be asked to identify.

