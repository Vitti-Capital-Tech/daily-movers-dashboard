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

**Sign-in:** email magic link. No passwords. Restricted to
`@vitti.capital` addresses, enforced in three places — the login action (clear
error message, and avoids emailing outsiders), the middleware (an out-of-domain
session is signed out, not just redirected), and a database trigger on
`auth.users` that refuses the sign-up outright.

**Roles:** `profiles.role` is either `admin` or `viewer`. Everyone gets
`viewer` on first sign-in; `admin` is granted by membership of the
`admin_emails` table. A trigger keeps roles in step, so granting write access is
one statement and takes effect immediately:

```sql
INSERT INTO admin_emails (email, note) VALUES ('someone@vitti.capital', 'why');
DELETE FROM admin_emails WHERE email = 'someone@vitti.capital';   -- revoke
```

**Where enforcement lives:**

| Layer | Protects against | Mechanism |
| --- | --- | --- |
| Middleware | Unauthenticated page access | Redirect to `/login`, session refresh |
| `(app)/layout.tsx` | A middleware misconfiguration | Re-checks the session server-side |
| `assertCanWrite()` | Non-admins calling a Server Action directly | `requireAdmin()` at the top of every write |
| RLS | Anyone using the public anon key | RLS on, zero policies — see below |

Hiding the Add/Edit buttons is a courtesy, not a control: a Server Action is a
public HTTP endpoint, so the check has to be server-side.

### Why RLS has no policies

`NEXT_PUBLIC_SUPABASE_ANON_KEY` ships to the browser, so anyone can call
Supabase's auto-generated REST API with it. Every table therefore has RLS
enabled and **no policies at all**, which makes that API return nothing and
refuse writes. The app is unaffected because Drizzle connects as the table
owner, which bypasses RLS.

The consequence to know about: any future feature that queries Supabase
*directly from the browser* will read zero rows until a policy is added
deliberately. All data access is meant to go through Drizzle server-side.

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
