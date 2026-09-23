# Daily Movers Dashboard

Searchable archive of Vitti Capital Daily Mover research, so that when a company
comes up again you can immediately see what we said last time — plus **Mover
Studio**, which drafts each weekday's Daily Mover for an analyst to approve, and
**Post Studio**, which turns the archive's own track record into LinkedIn copy.

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
| AI Extraction | Claude Sonnet 4.6 — reads an uploaded report and fills the form |
| AI Drafting | Claude Sonnet 5 — screens the board, reads ~25 filings, writes the report, then checks its own figures |
| AI Post Copy | Claude Sonnet 5 — judges whether a published call was borne out, then drafts LinkedIn copy |
| PDF Generation | `@react-pdf/renderer` — a single 16:9 sheet, no Chromium |
| Market Data | Yahoo Finance (`yahoo-finance2`) — quotes and session moves |
| ASX Data | ASX company directory + company announcements (see caveat below) |
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
| `npm run storage:setup` | Create Supabase private storage bucket |
| `npm run db:cron -- <url>` | Point pg_cron at the deployed Daily Mover route (06:00 IST). URL remembered after the first run |
| `npm run reports:download` | Batch download all attached PDF reports to a local folder |
| `npm run report:preview` | Render the report template to a PDF locally — the fixture, or `-- <draftId>` from the database. No API call |
| `npm run logo:build` | Regenerate `lib/report/logo.ts` from `public/logo.jpeg` after the asset changes |
| `npm run draft:regenerate -- <id>` | Re-run a stored draft through the current prompt (add `--run` to spend; dry run prints the cost) |

## Mover Studio

Each weekday **at 06:00 IST — 10:30 in Sydney, half an hour into the session**
— Claude drafts that day's Daily Mover and leaves it in a review queue at
`/mover-studio` for an analyst to approve or reject. Approving files it in the
archive exactly as a manual upload would.

**The pipeline**

1. **Screen the board.** Every ASX listing is quoted; the ones that moved at
   least 5% on at least $5m of market cap are ranked into top-25 gainers and
   top-25 losers. There is no turnover floor — see below.
2. **Shortlist the explainable ones.** Each survivor's announcements for the day
   are checked, and anything without a *price-sensitive* filing is dropped — a
   move the public record doesn't explain is not a report.
3. **Pick one.** Claude chooses from the shortlist and says why, with the
   runners-up recorded so a reviewer can see what was passed over.
4. **Read the filings.** The last ~15 price-sensitive announcements plus the most
   recent annual, half-year or quarterly report are downloaded and extracted to
   text (a results pack runs to 36 pages and 2.6 MB). The prompt also gets the
   session's volume against a 30-session average, and a date-and-headline index
   of every filing in the window.
5. **Write it.** One call returns both the report's typed page blocks *and* the
   `daily_movers` columns, so the archive row and the PDF cannot disagree.
6. **Check every figure.** A second call verifies the report against the same
   filings and triggers one rewrite when it finds a wrong fact.
7. **Render and file.** `@react-pdf/renderer` produces a one-page 16:9 sheet
   into a `drafts/` prefix, and the row goes to `pending`.

Two to three minutes and roughly **US$0.55** per draft at list price
(~$12/month over 22 trading days). `ANTHROPIC_DRAFT_MODEL=claude-opus-5` moves
it to about $1.40 and $30, which is the lever to pull if wrong figures start
reaching review.

**How it got there.** The first working version cost $1.50. Three measured
changes took 73% out of it; the Accuracy Gate and the accounts then bought some
of it back, deliberately:

| Change | Cost/draft |
| --- | --- |
| First version: 25 filings, flat 90k cap, 1-hour prompt cache | $1.42 |
| **Cache breakpoint removed** — a 1h cache *write* bills at 2x input and needs three reads to break even; the pipeline read a different company every day, so it never got one | $0.71 |
| **Sequential filings collapsed, legal instruments capped** — 16 of one company's 25 price-sensitive filings were takeover procedure: six offer-period extensions, five Panel receipt notices, an 89-page implementation deed | $0.60 |
| **Reading target 25 → 15** — measured: FRS, 114,429 in / 4,205 out | $0.41 |
| **+ the accounts and the Accuracy Gate** — one background filing, a second call that verifies every figure, and a rewrite when it finds a wrong one | $0.55 |
| *(same, with caching removed)* | *$1.28* |
| *(same, at the first cut of these features: 3 background filings, always rewrite)* | *$0.95* |
| *(Opus 5 for a day, after a review found a fabricated total and a conditional sale written as completed — every component of the bill is exactly 2.5x)* | *~$1.40* |
| **Back to Sonnet 5**, on the desk's call: the prompt's own guard rails — a source line on every page, the conditionality rules, the gate's blocking categories — carry the accuracy instead, at 40% of the price | ~$0.55 |

The two italic rows are what the tuning avoided. Reading the corpus three times
at full price is what the 5-minute cache breakpoint prevents, and it is why
caching is right now when it was wrong before. The other is the first version of
the gate, before three dials were turned:

- **Background filings 3 → 1.** Three reached back two extra reporting periods,
  which a Daily Mover doesn't use — the prior-period figures it needs for a
  comparison are printed in the current report's own comparative columns.
- **Background budget 45k → 25k characters.** Roughly the first 15 pages, which
  is the whole of the operating review, the segment note and the cash flow
  statement. The other 20k was buying remuneration tables.
- **The rewrite is selective** (`warrantsRewrite`). One wrong figure or a
  misdescribed share-price move is rewritten; one over-reaching sentence is
  flagged for the analyst instead. Every finding reaches the review card either
  way — the rule only decides whether the pipeline pays to fix it.

Figures below the measured FRS row are computed from it, not observed —
re-measure once a draft has run through the gate.

The quality signal is in what got cited: the 25-filing version drew facts from
12 of 26 documents, the 15-filing version from **15 of 16**. Fewer filings, read
more completely — and the page structure of the output is unchanged.

Nothing is dropped for *looking* procedural. In the same corpus "TOV: ZNC —
Declaration of Unacceptable Circumstances" reads like paperwork and was
material — the published takeaway turned on it. So a sequential series collapses
to its latest member and long legal instruments lose their annexures, but no
class of filing is excluded outright. See `src/lib/asx/filings.ts`.

**Remaining levers, not taken.** A two-stage read (Claude Haiku 4.5 summarises
each filing, Sonnet 5 writes from the briefs) would cut roughly another half but
loses the specific numbers the reports are built on. The Batch API is 50% off
but asynchronous, which would mean moving the cron earlier and giving up the
same-session timing guarantee. The measured corpus levers — a tighter reading
budget for history filings, de-duplicating investor presentations — would take
20-25% and are a quality trade, so they wait until the current accuracy changes
have a week of drafts behind them. All of them are available if the bill ever
matters more than it does at $12/month.

**When it doesn't run.** The scheduled job declines, without erroring, if it
isn't a weekday in Sydney, if the market didn't trade (detected from the feed's
own timestamps, not a hardcoded holiday table), if **an analyst has already
published a Daily Mover for the day**, or if a scheduled draft for the day
already exists. `?force=1` with the cron secret skips only the time-of-day check,
for re-running a session that was missed.

**The screen controls are a setting, not a per-run override.** Whatever you
submit in the Studio's *Screen settings* panel is saved to the `screen_settings`
row and becomes the screen the 06:00 scheduled run uses, until it is changed
again. The panel always renders the stored values, so the screen in force is
visible rather than implied. `DEFAULT_SCREEN` in `lib/asx/types.ts` is the
fallback when nothing has been saved — and, deliberately, when the settings read
fails, so a settings problem can never be why a draft didn't happen.

**Who calls it: Supabase `pg_cron`, not Vercel.** `vercel.json` has no `crons`
key. The schedule lives in [`drizzle/cron-setup.sql`](drizzle/cron-setup.sql) as
a single pg_cron job at `30 0 * * 1-5` UTC, and `pg_net` makes the HTTP call with
the cron secret. Set it up once with `npm run db:cron -- https://your-app.vercel.app`.

Vercel Cron was dropped because the Hobby plan schedules with ±59 minutes of
precision — the nominal time is the *earliest* a job can run, not when it runs —
and this one landed about 29 minutes late every day. pg_cron fires on the minute.

**Why one schedule, where Vercel needed two.** India has no daylight saving, so
06:00 IST is 00:30 UTC on every day of the year. The old pair existed only so
that an hour of slop would still land inside the Sydney session on both sides of
the AEST/AEDT switch; with minute precision there is nothing to straddle.

**Why the window opens at the bell.** The handler still checks that the firing
lands between 10:00 and 15:00 Sydney time. 00:30 UTC is 10:30 in Sydney under
AEST and 11:30 under AEDT, so the floor has to be at or below 10:30 — the old
11:00 floor would have silently skipped every AEST day, six months of the year.
It does not go lower than 10:00 because there is no continuous trading to screen
before the open. Dedupe is not the window's job: the partial unique index on
`(move_date) WHERE trigger = 'cron'` is what makes a second caller a no-op, which
is why adding a Vercel cron back as a fallback would need no code change.

**What "exactly 06:00" means.** pg_cron starts the job within a second of 00:30
UTC. The request is exact; the draft is not — generation runs in `after()` and
takes two to five minutes. Note that `cron.job_run_details` records success as
soon as the request is *queued*, because pg_net is asynchronous; the HTTP status
is in `net._http_response`. Both queries are in `drizzle/cron-setup.sql`.

**`maxDuration` is 300 seconds**, the Hobby ceiling and every plan's default. A
higher value fails the *build* on Hobby rather than failing at runtime. A run
measured at 120 seconds before the Accuracy Gate and about 200 with it, on
Sonnet 5 writing seven pages; the report is now a single page, which only
moves that down. The deadline guards in `lib/drafts/generate.ts` are what keep
the invocation inside the ceiling either way.

**Reviewing a draft.** The card shows Claude's rationale and confidence, the
report rendered inline, and every announcement it read with the cited ones
marked and linked. The archive fields — move, catalyst, reason, takeaway — are
**editable before approval**: the model drafts, the analyst is still the author.

**Downloading the evidence.** The card has a **Sources (.zip)** button:
every announcement the report was written from, in `today/` and `history/`
folders, plus a `sources.txt` manifest marking the ones the report actually drew
a figure from. The pipeline extracts each PDF to text and throws the bytes away,
so the route re-downloads them from the ASX — which is also why it takes a
moment, and why anything withdrawn since is listed in the manifest rather than
silently missing.

**Regenerating a draft.** The card also has a **Regenerate** button, and there
is `npm run draft:regenerate -- <id>` for the same thing from a terminal. It
re-runs the stored draft through the current prompt, template and model, reusing
the subject, the screen row, the rationale and the exact announcement list — so
the only difference between the two drafts is the code that wrote them. The new
one is a `manual` row for the same `move_date`, which the cron's unique index
permits, so both sit in the queue and can be read against each other. Two clicks
and a stated cost, because it spends a couple of dollars of model time.

**Admin only.** Drafts are machine-written and unreviewed, so they are not Vitti
research until approved. The nav link is hidden from viewers, and the page and
`/api/drafts/[id]/pdf` both re-check server-side.

> ### Terms of access — read before running this in production
>
> The ASX serves company announcements for "investors' private and personal
> use", and states that commercial use requires "the express written authority
> of ASX" — with "the business of accessing or aggregating information" named
> explicitly. Vitti Capital is a commercial user, so that authority, or a
> licensed announcements feed, is a prerequisite. `src/lib/asx/provider.ts` is
> the seam that makes swapping the source a one-module change.

## Post Studio

`/post-studio` (admin only) puts every published Daily Mover against today's
price, and drafts LinkedIn copy about the ones whose view was borne out.

**The judgement is the feature.** The obvious build ranks the archive by
post-event return and claims credit for the top of the list. On this archive
that is wrong in both directions — only 25 of 56 movers continued in the
direction they moved on the day, and among the 31 that reversed are calls the
note got exactly right. So Claude reads the note's own takeaway and decides
whether the price action bears out *what was argued*, returning one of
`validated` / `mixed` / `contradicted` / `too_early`, plus the verbatim clause it
is relying on. Copy is generated only for `validated`, and that is enforced in
code rather than only asked for in the prompt.

Measured on three real movers:

| Mover | The call | Since | Naive logic | Actual verdict |
| --- | --- | --- | --- | --- |
| AVH | up 17.2% | **+101.3%** | biggest win in the archive | **mixed**, no copy — the takeaway's central claim was that the balance sheet risk was *unresolved*, and none of the milestones it named have been reached |
| KCN | down 14.0% | **+27.1%** | reversed, discard | **validated** — the note argued the equipment failure was manageable given a $179m net cash position |
| AR9 | up 23.0% | **−48.2%** | — | **contradicted**, no copy |

**Why this matters beyond tidiness.** A post that states a return is a
past-performance representation published by a Corporate Authorised
Representative under an AFSL. Claiming a call the note never made is a
misleading representation, not just an embarrassment — hence the quoted
evidence, the refusal to write for anything but a validated call, and a
compliance footer that is a constant in `lib/posts/types.ts` rather than
something the model writes.

**What the page gives you.** The whole archive in publication order (not ranked
by winners), searchable by ticker or company and filterable to assessed /
not-assessed, paginated. Clicking a ticker opens that draft at
`/post-studio/[id]` — its own page and its own URL, because reviewing two or
three variants of several hundred words is a reading task and compliance needs a
link to send. Each draft page shows the assessment above the copy and not
collapsible, the verbatim clause it rests on, the LinkedIn fold marked so you
can see what lands above "…see more", a copy button that includes the compliance
footer, and a posted/discarded status so the desk doesn't publish about the same
call twice.

**Numbers go stale, and a verdict is about a moment.** A draft saying "+27.1%
since our note" is only true as at the moment it was written; the prices it was
computed from are stored on the row, and the panel warns when the live return
has drifted more than three percentage points from what the copy claims.

**Assess again** re-runs the judgement against today's price, and it is
available for every verdict. "Too early to say" three weeks after publication is
the right answer then and the wrong one three months later — often the note
named milestones that simply hadn't happened yet — so a mover is never written
off by its first assessment. Rows whose verdict produced no copy carry the
button in the table itself, since that is where the reviewer notices the "Since"
figure has moved on; validated drafts are re-assessed from their own page.

Each run is a **new row, never an overwrite**, and the draft page lists every
assessment of that call with the return each was judged against. That history is
what distinguishes re-examining a call from shopping it until the verdict comes
out favourably.

The app never posts anything. It produces text for a human to review and paste.

## Auth & Access Control

The dashboard implements a **Public View-Only by Default** model with **Passcode-based Admin Elevation**:

1. **Public View-Only (Default)**: Anyone visiting the site lands directly on the **Daily Movers Dashboard** in read-only mode (`role: "viewer"`). All team members and analysts can search, filter, view company timelines, and open PDF reports without logging in.
2. **Admin Elevation (Write Access)**: The authorized research editors can unlock full write/edit permissions by clicking **"Unlock Admin Mode"** in the user menu and entering the `ADMIN_PASSCODE` (stored in `.env.local` / Vercel).
3. **Signed Sessions**: Once unlocked, a stateless HMAC-SHA256 cookie (`vitti_admin`) is minted with `AUTH_SECRET` (valid for 30 days). Multiple editors can be unlocked simultaneously across different devices.
4. **Instant Lock**: Editors can click **"Exit Admin Mode"** from the user menu anytime to return to View-Only mode.
5. **Backend Mutation Chokepoint**: All database writes (`saveMover`, `deleteMover`, `extractReportAction`, `/api/extract`, `/api/reports/download-all`) strictly enforce `requireAdmin()` on the server side.

`app_users` records who has signed in. It's audit only — role is never read from it.

**Where enforcement lives:**

| Layer | Protects against | Mechanism |
| --- | --- | --- |
| `(app)/layout.tsx` | Privilege leakage | Evaluates session and configures UI state |
| `assertCanWrite()` | Non-admins calling a Server Action directly | `requireAdmin()` at the top of every write |
| API Route Handlers | Unauthorized API calls | `user.canWrite` checks on `/api/extract`, `/api/prices/refresh`, and `/api/reports/download-all` |
| RLS | Anyone using the public anon key | RLS on, zero policies — see below |

Hiding the Add/Edit and Download All buttons is a courtesy, not a control: a Server Action and API route are public HTTP endpoints, so the check has to be server-side.

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

**Environment variables** (Vercel → Settings → Environment Variables):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The pooler URI, port 6543, username `postgres.<ref>` |
| `AUTH_SECRET` | A **fresh** 32-byte hex string, not the local one |
| `NEXT_PUBLIC_SUPABASE_URL` | Needed since report upload landed — the browser uploads direct to Storage |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same. Public by design; safe because RLS has no policies |
| `SUPABASE_SERVICE_ROLE_KEY` | Signs upload and download URLs. **Server-side only** — never `NEXT_PUBLIC_*` |
| `ADMIN_PASSCODE` | The secret passcode to unlock Admin mode |
| `ANTHROPIC_API_KEY` | API key for PDF auto-extraction and Mover Studio |
| `ANTHROPIC_MODEL` | Optional. Extraction model; defaults to `claude-sonnet-4-6` |
| `ANTHROPIC_DRAFT_MODEL` | Optional. Drafting model; defaults to `claude-sonnet-5` |
| `CRON_SECRET` | **Required for the scheduled draft.** Without it `/api/cron/daily-mover` refuses every request |

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
queries.

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

## Layout

```
scripts/
  apply-sql.mts          Idempotent statement-by-statement SQL runner
  build-logo.mjs         public/logo.jpeg -> the keyed-out mark, inlined as lib/report/logo.ts
  download-reports.mts   Batch CLI utility to download all research PDFs to a local folder
  preview-report.mts     Render the report deck to PDF locally, with no API call
  regenerate-draft.mts   Re-run a stored draft under the current prompt, dry run by default
  storage-setup.mts      Supabase storage bucket initializer
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
      mover-studio/      AI draft review queue (admin only)
      post-studio/       track record + LinkedIn copy (admin only)
      post-studio/[id]/  one drafted post: assessment, variants, re-assess, history
    api/cron/daily-mover/  scheduled weekday draft, Sydney-time gated
    api/drafts/[id]/pdf/   admin-only signed URL for an unapproved draft PDF
    api/extract/         multipart PDF research extraction route handler
    api/logo/[ticker]/   universal multi-source company logo proxy (cached)
    api/prices/refresh/  market price refresh endpoint
    api/reports/[id]/    protected 60s signed URL PDF download redirect
    api/reports/download-all/ protected admin-only ZIP archive bundle of all PDFs
    login/               passwordless identification screen
  components/
    table-search.tsx     shared debounced, URL-backed table search
    table-pagination.tsx shared pager used by every table
    admin-unlock-dialog.tsx modal dialog for unlocking admin write mode with passcode
    company-logo.tsx     high-contrast adaptive company logo with institutional monogram fallback
    daily-movers/        filter bar, table, form dialog, row actions, combobox, report-upload, download-reports-button
    mover-studio/        review queue, draft review card + approve/reject, inline report preview, evidence list, screen controls (saved, not per-run)
    post-studio/         track-record table, assessment + post variants with copy-to-clipboard
    ui/                  shadcn primitives (Base UI / Radix)
    theme-provider.tsx   next-themes client wrapper
    theme-toggle.tsx     Light / Dark / System theme switcher
    app-shell.tsx        navigation sidebar, header, and role badge
    user-menu.tsx        analyst profile dropdown & admin unlock/lock trigger
  db/
    schema.ts            tables, indexes, relations, enums
    seed.ts              catalysts, analysts, companies, sample movers
  lib/
    ai/
      client.ts          shared Anthropic client, model choices, token accounting
      anthropic.ts       PDF tool extraction client (uploaded reports)
      mover-draft.ts     the three drafting calls: pick a mover, write the
                         report, check every figure against the filings
      linkedin-post.ts   judges whether a call was borne out, then drafts the copy
      announcement-text.ts  announcement PDFs -> text for the prompt
    asx/                 provider interface, company directory, announcements, computed movers board
    catalysts.ts         the closed catalyst vocabulary, in one place
    drafts/              draft pipeline, regeneration, queries, trading-day
                         arithmetic
    posts/               track-record reads, post shapes, compliance footer
    report/              typed report blocks, the length budget, the inlined
                         house mark, and the react-pdf 16:9 sheet template
    market/              Yahoo Finance provider & price refresh logic
    movers.ts            types + constants shared with client components
    table.ts             shared paging/search params and clamping
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

**Universal Company Logo Resolution.** Company logos are resolved server-side through a multi-tier fallback pipeline: Parqet Symbol CDN → live company website via `yahoo-finance2` `assetProfile` → direct HTML `<link rel="icon">` / `<meta property="og:image">` scraping → domain favicons. The `<CompanyLogo />` component wraps logos in a high-contrast container (`bg-slate-900 dark:bg-card`) to ensure transparent logos with white or dark text render with crisp clarity in both Light and Dark modes.

**Batch Research Archive (`.zip`).** Admins can download all attached PDF reports at once via the header **"Download All Reports (.zip)"** button or the `npm run reports:download` CLI script. The backend concurrently fetches all PDFs from Supabase Storage and streams a single compressed ZIP file created with `JSZip`.

**`move_window_label`.** Reports don't all say "Intraday" — the SPZ report says
"Morning Trade". That maps to `intraday` for filtering, with the verbatim
wording kept alongside so nothing is lost.

**`extraction` jsonb.** Reserved for the raw structured output of PDF
extraction, stored next to the saved row so an improved prompt can be re-run
over the archive later and diffed against what was actually saved.

**Filtering happens in SQL.** Client-side filtering looks fine on 20 rows and
quietly dies at a few thousand.

**A validated call is not a positive return.** The sign of the post-event return
says nothing on its own: a stock that fell 14% and has since risen 27% vindicates
a note arguing the problem was temporary, and refutes one arguing the outlook had
worsened. Post Studio's verdict therefore comes from reading the takeaway, and
the model must quote the clause it relies on — so the claim in a post can be
checked against what was actually written.

**Post figures are snapshotted.** `linkedin_posts.snapshot` stores the prices the
copy was computed from. Without it, a draft reading "+27.1%" and a table reading
"+12%" are both correct about different instants, and there is no way to tell
that the copy has gone stale.

**Drafts are a separate table, not a status column.** Every row in
`daily_movers` is approved research — that is what makes "what did we say last
time?" answerable. A `status` column would mean every existing query needs a
`WHERE status = 'approved'`, and one forgotten filter would quote an unreviewed
machine draft back as Vitti's published view.

**Approving is a storage *move*, not a re-upload.** The draft PDF starts under
`drafts/` and moves into the same key scheme a manual upload uses, so
`/api/reports/[id]`, the ZIP export and the download script all keep working
without knowing a report was ever drafted.

**The movers board is computed, not scraped.** Reading a published leaderboard
was built first and abandoned: Market Index's scans pages sit behind Cloudflare
bot protection that fingerprints TLS rather than headers — the identical request
succeeds from `curl` and returns **403 from Node**. Deriving the board from the
ASX company directory plus the market provider's session moves turned out better
anyway: no bot-detection surface, turnover computed exactly in dollars, and the
screen runs over the whole universe instead of someone else's page one.

**The screen runs before Claude sees anything.** On a representative day the
raw top-20 gainers were nearly all nano-caps: +47% on $107k of turnover, +27% on
**$2,451**. No prompt fixes a shortlist made of those. The floors went $500k/$20m
→ $1m/$75m → **no turnover floor and $5m market cap**, and the last move is a
consequence of the schedule rather than a change of mind: turnover is cumulative
from the open, and the board is now screened at 10:30 Sydney instead of 11:15, so
a dollar floor half an hour into the session selects for whatever traded first
and empties the board on a quiet morning. Turnover is still computed and still
printed on every candidate — it is just no longer a gate, which leaves the $5m
market-cap floor as the only structural filter. The selection prompt weighs the
same thing from the other side —
each candidate's turnover is printed as a share of its market capitalisation,
because a 30% move on 8% of the register changing hands is a speculative
blow-off while the same move on 0.4% is a re-rate — and it applies one test:
would this report still be worth reading in a month?

**The corpus is chosen from today's announcement, not from the calendar.** The
pipeline reads today's price-sensitive filings *first*, then decides what history
to read — because the one document guaranteed to say which history matters is
today's. Four things come out of that text before anything else is downloaded
(`lib/asx/references.ts`, `lib/asx/signals.ts`, `lib/drafts/research-signals.ts`):

- **Referenced documents.** "…continues on the terms set out in the Buy-Back
  Booklet dated 12 August" is a pointer, and it is followed: the reference is
  matched back to a real filing by date and headline, and admitted to the corpus
  *above* the reading target rather than competing for a slot. This is the miss
  that motivated the whole change — a report explained a buy-back without the
  booklet holding its mechanics, while the budget went on old dividend notices.
- **The event chain.** The thread today sits on, reconstructed oldest-first, so
  the report can start the story at its beginning: capital-management proposal →
  EGM approval → court challenge → Takeovers Panel → settlement today. The chain
  seeds its vocabulary from the referenced documents as well as today's headline,
  which is what lets it reach back past a headline that shares no words with the
  filing that started everything.
- **Personnel.** Sentences describing anyone arriving, leaving or changing role,
  quoted verbatim and never interpreted. Board change is always material and is
  almost never the headline.
- **Dates.** Every date today's filings state, with the clause around each one,
  plus any two close enough to be mistaken for each other — a buy-back closing on
  the 21st and withdrawals running to the 24th are two deadlines, and merging
  them is an error that reads perfectly fluently.

**Ranking is by relevance, not recency.** `rankHistoricalFilings` scores every
earlier filing: referenced by today's announcement beats everything, then the
event chain, then legal/regulatory documents when today's catalyst is a court, a
regulator or a vote, then the accounts, then headline overlap with today, with
recency as a weak tiebreak. Routine paperwork — dividend timetables, trading
halts, Appendix 3Y interest notices, address changes — is dropped outright
*unless today's announcement points at it*. The draft's audit trail records the
score and reasons for everything kept and the grounds for everything dropped, so
a reviewer can tell a deliberate omission from a bug.

**Volume is the evidence, not the move.** A Daily Mover's central claim is that
an announcement moved the stock, and the session's raw share count cannot support
it — two million shares is a quiet day for one company and five times normal for
another. One history request per draft turns it into the ratio a research note
has always printed: 6.2x the 30-session average is the market transacting on the
news, 1.1x is a thin market re-pricing itself, and those are different reports.

**The disclaimer is never model-generated.** It carries an AFSL number and an FSG
link, and a model asked to write a disclaimer will paraphrase one. It is a
constant in `lib/report/types.ts` that the renderer appends, so there is no path
by which it can vary. The closing sign-off — "That's where the story
stands today." — is appended the same way and for the same reason: a model asked
to end on a set phrase will paraphrase it about one time in five.

**Every figure is checked by a second call before an analyst sees it.** The
Accuracy Gate re-reads the finished report against the same filings and reports
only what is wrong — a number that isn't in the evidence, an intraday move
written as a close, a conditional contract value presented as revenue. The
writing call cannot do this for itself: it would be grading its own work in the
context that produced it, and the failure being looked for is a figure that
*felt* right. A blocking finding triggers one rewrite, with the first draft and
the findings both in the prompt so the call is an edit rather than a fresh
attempt. The findings are kept on the draft either way — "was this checked, and
what did it find" is the first thing a reviewer asks, and a corrected report
cannot answer it.

**The corpus is paid for once, not three times.** Caching the announcement
corpus used to be the wrong call — a one-hour-TTL write bills at 2x and needs
three reads to break even, and the pipeline made exactly one call per corpus. The
Accuracy Gate changed that: the same filings are now read two or three times
within minutes, so the 5-minute TTL applies and the run went from 3.00x the
corpus to 1.45x. Getting the hit meant making the prefix byte-identical across
calls — the cache keys on tools, then system, then messages — so both calls send
both tools and let `tool_choice` pick the job, share one system prompt, and build
their evidence blocks from the same function. Verified with a probe: the second
call read 18,913 tokens from cache and billed 39.

**The optional stages are on a clock.** The platform ceiling is 300 seconds and
there is nothing past it — a killed invocation leaves no report at all. So the
check and the rewrite each have a deadline, and when time is short the rewrite is
dropped first: findings are useful to a human on their own, a rewrite without
them is nothing. Whichever gets skipped says so on the draft.

**Charts carry a conclusion or they don't ship.** A `chart` page is invalid
without the one-line "what to notice" under it, enforced in `validateReportDoc`.
The column chart plots a real zero baseline rather than bare magnitudes, because
the series these pages exist for are growth series — +6.0, +6.5, +4.0, +0.3,
**-0.5** — where the crossing into negative territory *is* the insight, and a
magnitude-only chart shows five similar bars and hides it.

**A cash balance is a waterfall, not a bar.** An $880 million balance plotted as
one column answers none of the questions a reader has: how much arrived with the
deal, how much is already committed to the dividend, the buy-back and capex, and
what is actually free. The `waterfall` chart type takes an opening total, the
signed steps, and a closing total, and answers all three in one shape. A
waterfall whose points are all totals is demoted to a column chart rather than
rendered as bars that do not build.

**The house mark travels with the code.** `public/logo.jpeg` is a square JPEG
of the mark above the wordmark on a flat navy ground — the wrong shape twice
over: the ground is a different navy from the page, so a rectangle would show,
and the stacked wordmark is illegible at corner size. `npm run logo:build` keys
the ground out by distance from the corner colour, crops to the mark and writes
it into `lib/report/logo.ts` as a base64 PNG; the template sets the wordmark as
type beside it. Inlined rather than read from `public/` at render time because
the PDF is built inside a serverless function, which only has the files Next.js
traced into the bundle — a path that works in `next dev` and throws in
production is the worst version of this.

**Every page names its sources.** `sourceNote` is required by the page schema and
prints small under the content — "Source: Simberi Transaction Presentation, ASX
10 Sep 2026, pp. 4-11; exchange feed". It is a reviewer's audit trail, and it is
also a check on the writer: a figure whose source cannot be named is usually a
figure that was not read anywhere. The Accuracy Gate verifies that each line
names a filing that actually carries the page's figures, and a wrong one is a
blocking finding.

**Conditional money is written as conditional.** The failures the desk reports
are not arithmetic — they are sentences that are true of a different transaction
from the one announced: "unconditional" used of a payment that needs regulatory
approval, proceeds written as received when they arrive on completion, and a
company described as having no production while it still owned the mine. The
prompt makes the four states explicit (agreed / binding but conditional /
unconditional / completed), and `conditionality`, `cash-timing` and
`status-timing` are gate categories that each trigger a rewrite on their own.

**A page that does not fit is counted.** `renderReportPdf` reads the page count
back out of the PDF it just produced and warns when it exceeds the content pages
plus the disclaimer. The SBM draft of 10 September 2026 rendered **seven** sheets
from five content pages: a six-row comparison table whose cells wrapped ran about
twenty points long and pushed its source line — and nothing else — onto a sheet
of its own. Nothing anywhere said why, in a document nobody counts the pages of.
The cause is fixed where it belongs (comparison cells now have a character
budget, and rows are tighter), and the counter is there so the next one shows up
in the log rather than in front of a client.

The counter matters more on the one-pager than it ever did on the deck, because
there the overflow is *invisible*: no stray caption on an extra sheet, just a
risk card that is no longer on the page. So `warnOnOverflow` expects
`pages.length` for a snapshot and `pages.length + 1` for a deck — with the
deck'"'"'s figure applied to a one-pager, a sheet that spilled would render 2
against an expected 2 and pass in silence.

**The window comes from the clock, not from the model.** The board is read
while the market is still open, so its percentage is an *intraday* figure with
hours of trading left — and the first SBM draft wrote "Shares Closed Up ~17.8%"
for a midday reading, which was the wrong window and, once the stock kept
moving, the wrong number. `describeMoveWindow` turns the moment the board was
taken into "morning trade", "intraday" or "the close"; the market data block
states it in as many words; and `moveType` and `moveWindowLabel` are set from it
rather than from the model, the same way `move_pct` is set from the feed.

**The deck is green on a rise and red on a fall.** The accent is a property of
the day rather than a house constant: the edges, the eyebrow, the heading rule,
the conclusion band, the timeline marks and the closing quote all read it from
`deckTheme(movePct)`. The cobalt tile beside the move card stays cobalt in both,
because it is the colour for a fact without a verdict and a fact does not change
direction with the share price.

**Emphasis is markup, parsed and not trusted.** The model may mark the one or
two figures a block turns on with `**`, and the renderer sets them in bold white
against the grey body copy — which is what makes a page of prose scannable. An
unbalanced pair, which a length trim at a sentence boundary can leave behind,
makes the whole block render plain instead of bolding everything to the end of
the page. Double asterisks are the only markup the renderer understands.

**Every draft is priced at its own model's rates.** `estimateDraftCostUsd` reads
the row's `model` column rather than a single hardcoded pair, because a
hardcoded pair silently mis-prices the whole table the moment the pipeline moves
tiers — which it has now done twice, and the number on the review card was wrong
for every row in between.

**A dropped page is logged, not swallowed.** The page schema has exactly one
failure mode — a page whose `kind` is right and whose body is empty — and
discarding those silently hid it for a week: the model emitted chart pages
without their conclusion line, `normalisePage` threw them away, and the reports
simply had no charts with nothing anywhere saying why.

**The report is one 16:9 sheet, not an A4 note and no longer a deck.** The
template rendered portrait on white until a generated draft was put next to what
the desk actually publishes — a deep-navy slide on a mint rule, the wordmark in
the corner, content in tiles and dated timelines rather than paragraphs. Next to
it the portrait draft read as a memo someone had typed.

It was then a four-to-five page deck until 16 September 2026, when the desk
published PIA as a **single sheet** (`daily_movers` id 65,
`pia-one-page-snapshot-v7.pdf`) and the Studio was still drafting five pages
against it. `ReportPage` gained a `snapshot` kind carrying the whole report —
company name, headline, four KPI tiles, two numbered columns (*Why It Moved* /
*What Changes Now*), a *How We Got Here* timeline, three *Key Risks Remaining*
cards and a closing pull quote. The deck page kinds all still render, so stored
drafts from before the change open unchanged.

**Colour carries meaning, never decoration.** Mint is the house accent and it
marks the finding — the eyebrow, a highlighted tile, the conclusion band, the
closing pull quote — so a reader who follows only the mint gets the argument.
Coral is reserved for the direction that hurts: a fall, a risk card, a step that
takes cash out. Cobalt is a fact without a verdict. Body copy is one off-white
and one grey and nothing else, because coloured body text on a dark ground makes
a slide look like a warning label.

**The sheet does not grow, which is the whole hazard of the format.** A page in
a deck that runs long wraps onto a second sheet and looks wrong; a one-pager that
runs long pushes its last risk card off the bottom edge, and nothing anywhere
says it happened. So the counts are the layout, not a style preference: four
tiles, three *why* clauses, four *what changes* clauses, five dated steps, three
risks. `fitReportPages` truncates every one of those rather than trusting the
model to count, the tool schema pins `minItems`/`maxItems` to 1 page of kind
`snapshot`, and `validateReportDoc` checks the shape as a whole document. A
render that comes back as one page is the proof it fitted — react-pdf would have
paginated otherwise.

**The type size is set by the worst case, not by a nice-looking draft.** The
first NZK sheet left 59pt — a ninth of the page — empty under the source line,
because that day'"'"'s copy happened to be shorter than the caps allowed. Enlarging
the type to fill it would have overflowed the moment a draft used its full
allowance. So `npm run report:preview -- stress` renders a fixture with every
list at its maximum count and every string at its character cap, and the type
scale is whatever that fixture will carry: currently about 6% above the original
sizes, with the caps cut to match (76 characters a clause, 84 a risk, 36 a
timeline step). Two dials, and only two — the type or the caps.

**The "how we got here" band is a timeline OR a small chart.** They answer the
same question and share one slot, so the sheet stays one page either way. Dated
steps are right when the story is a sequence of events with no common unit
(proposal, approval, challenge, settlement); a chart is right when it is a
progression of figures in one unit — four guidance upgrades climbing through the
year, three capital raises, production by half. The chart is drawn short — no
taller than the timeline it replaces, which is what keeps the sheet to one page —
so the printed values carry the precision and the columns carry the impression.
The model picks; the renderer prefers the chart when both arrive.

The chart has two forms, and the fitter decides between them from the data
rather than trusting the model. **Columns** take two to five points for one
series and four for two, with a figure printed over every bar. A **line** takes six to twelve
points and prints only its two end figures, because twelve figures along a line
collide; past eight periods it labels every other one, counted back from the
latest. A line sent with fewer than six points is drawn as columns, and a series
over its cap loses its *oldest* points, since the series ends on the period that
matters. `npm run report:preview -- stress-line` renders the line at its worst
case. Until this was fixed the parser dropped `form` entirely, so every line the
model asked for was drawn as columns, and the axis could stop one tick short of
the tallest value (40 for a 42) and draw it above the plot.

**Chart colour follows meaning, not position.** Each series carries a `tone`:
`unfavourable` (a loss, a cost, a cash burn) draws coral, `favourable` (revenue,
profit, production) draws mint, and `neutral` draws cobalt, then steel. By
position, the first series took the theme accent, which is coral on a falling
day, so revenue was drawn in the colour reserved for losses. Drafts stored
before the field existed draw neutral. The chart prompt in section 9 also asks
for a takeaway title rather than a topic, one unit across both series, and the
same decimals on every value.

**The headline leads with the move.** An analyst sent back "FY26 Profit Rises
277% as Idle M1 Capital and Spectrum Probe Cloud Outlook" on a day Tuas fell
16%: it read as good news and never said the stock fell. The prompt now asks for
the short name, direction and whole-number move first (rounded from the
share-move tile, not a later price), a "despite" framing when the stock went
against the news, and no shorthand a reader needs the backstory to decode.
The accuracy checker flags a headline that breaks any of these.

**The share-move tile is composed by the renderer, not the model.** Its figure,
the traded price and the time all come from the exchange feed and the clock, the
same rule as `movePct`. A review found the tile printing "~12.5%" on a day the
stock fell — no sign, no price, no timestamp — and a Daily Mover published
mid-session is unreadable without all three. One trap worth knowing: the
typographic minus (U+2212) is **not** in Helvetica's WinAnsi encoding and
react-pdf drops it silently, which reproduced the missing-sign bug exactly. It is
a plain ASCII hyphen for that reason.

**`report:preview` reads the page count out of the rendered PDF.** It used to
print `doc.pages.length` — the document's own page count restated back — so it
reported "1 sheets" for a snapshot that had overflowed onto a second, blank
sheet, and every check run through it was worthless. It now reports
`N sheets (expected M)` from the real PDF and exits non-zero when they differ.
A preview whose only number is a restatement of its input cannot catch the one
failure this format has.

**Leftover height is distributed, not pooled at the bottom.** The bands are
sized by their content and the content never adds up to exactly 540pt, so the
body is `justify-content: space-between`: a short day'"'"'s copy breathes and a long
day'"'"'s is unchanged. Every draft now fills the sheet identically rather than
trailing off into white space.

**The compliance line is transcribed, not abbreviated.** A single sheet cannot
carry the full disclaimer page without becoming two sheets, so the footer sets
the short form in `ONE_PAGE_DISCLAIMER` — copied verbatim from the desk's own
published one-pager rather than shortened from `DISCLAIMER_PARAGRAPHS` in code,
because abbreviating regulated text is a compliance decision and not one this
repo gets to make.

**The layout is checked by looking at the rendered page.** A spacing bug looks
plausible in the style object and wrong on the page: the KPI card once inherited
the page's 1.5 line height and put a label's baseline 8pt below a 21pt number's,
inside its descender depth. `npm run report:preview` renders the template
without an API call. `npm run report:preview -- snapshot out.pdf` renders the
one-pager from a fixture holding the **real published PIA copy**, which is the
only version of the question worth asking: a fixture written to flatter the grid
renders beautifully and proves nothing. `-- fixture` still exercises every deck
page kind, `-- stress` proves the worst case fits (with `-- stress-timeline` and
`-- stress-line` for the other two forms of the history band), and
`-- <draftId>` renders a stored draft.

**Public holidays are detected, not tabulated.** A hardcoded holiday table needs
maintaining every year and fails silently the first year nobody updates it. The
newest quote timestamp across the market is today only if the market opened
today — so the data answers the question itself.

**Every table pages and filters in SQL.** `lib/table.ts` holds the shared
`parseTableParams` / `resolvePaging` pair and `components/table-search.tsx` and
`table-pagination.tsx` the shared controls, used by the Daily Movers archive,
the company directory and Post Studio. Extracted when the third table needed
them: three implementations of "read `?page=` and clamp it" is how two of them
end up disagreeing about what happens when a filter narrows the result set
under you. State lives in the URL, so a filtered view is shareable and the back
button works.

**`lib/queries.ts` is `server-only`.** It imports the Postgres driver, so
anything a client component needs at runtime lives in `lib/movers.ts` instead.

