# Daily Movers Dashboard

Searchable archive of Vitti Capital Daily Mover research, so that when a company
comes up again you can immediately see what we said last time.

## Documentation

- **[High-Level Design (HLD)](docs/HLD.md)**: System architecture, multi-layer authorization, direct-to-storage PDF pipeline, and infrastructure topology.
- **[Low-Level Design (LLD)](docs/LLD.md)**: Database schemas, Drizzle SQL queries, Server Actions, session crypto, component hierarchy, and error handling.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind 4 + shadcn/ui (Base UI primitives) + Lucide Icons |
| Theming | next-themes (Light / Dark / System mode toggle) |
| Typography | Plus Jakarta Sans (UI) + JetBrains Mono (Financial Data) |
| AI Extraction | Anthropic Claude 3.5 Sonnet (`@anthropic-ai/sdk`) |
| Database | Postgres (Supabase) |
| Auth & Permissions | Public View-Only by default + Passcode Admin Elevation (HMAC-SHA256) |
| Data access | Drizzle ORM + postgres.js |
| Storage | Supabase Private Storage (`reports` bucket) |
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

## Auth & Access Control

The dashboard implements a **Public View-Only by Default** model with **Passcode-based Admin Elevation**:

1. **Public View-Only (Default)**: Anyone visiting the site lands directly on the **Daily Movers Dashboard** in read-only mode (`role: "viewer"`). All team members and analysts can search, filter, view company timelines, and open PDF reports without logging in.
2. **Admin Elevation (Write Access)**: The 2 authorized research editors can unlock full write/edit permissions by clicking **"Admin Unlock"** in the sidebar and entering the `ADMIN_PASSCODE` (stored in `.env.local` / Vercel).
3. **Signed Sessions**: Once unlocked, a stateless HMAC-SHA256 cookie (`vitti_admin`) is minted with `AUTH_SECRET` (valid for 30 days). Multiple editors can be unlocked simultaneously across different devices.
4. **Instant Lock**: Editors can click **"Exit Admin Mode"** from the user menu anytime to return to View-Only mode.
5. **Backend Mutation Chokepoint**: All database writes (`saveMover`, `deleteMover`, `extractReportAction`, `/api/extract`) strictly enforce `requireAdmin()` on the server side.

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
  actions/
    admin-auth.ts        Server Actions for passcode unlocking and locking admin mode
    movers.ts            Server Actions for create, update, and delete
    reports.ts           Server Action for signed upload ticket generation
    extract.ts           Server Action for AI PDF extraction & auto-resolution
  app/
    (app)/
      daily-movers/      table view + Server Actions (create/update/delete)
      companies/         company directory
      companies/[ticker]/ research history timeline — the point of the app
    api/extract/         multipart PDF research extraction route handler
    api/reports/[id]/    protected 60s signed URL PDF download redirect
    login/               passwordless identification screen
    auth/signout/        POST sign-out route handler
  components/
    admin-unlock-dialog.tsx modal dialog for unlocking admin write mode with passcode
    company-logo.tsx     multi-source CDN company logo with institutional monogram fallback
    daily-movers/        filter bar, table, form dialog, row actions, combobox, report-upload
    ui/                  shadcn primitives (Base UI / Radix)
    theme-provider.tsx   next-themes client wrapper
    theme-toggle.tsx     Light / Dark / System theme switcher
    app-shell.tsx        navigation sidebar, header, and role badge
    user-menu.tsx        analyst profile dropdown & sign-out trigger
  db/
    schema.ts            tables, indexes, relations, enums
    seed.ts              catalysts, analysts, companies, sample movers
  lib/
    ai/
      anthropic.ts       Claude 3.5 Sonnet PDF tool extraction client
    movers.ts            types + constants shared with client components
    queries.ts           server-only data access layer
    storage.ts           Supabase storage path builders and byte validation
    validation.ts        Zod schema for form mutations
    session.ts           Web Crypto HMAC-SHA256 session token manager
    auth.ts              RBAC role lookup and permission assertions
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

