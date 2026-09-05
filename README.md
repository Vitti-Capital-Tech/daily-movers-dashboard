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
| AI Drafting | Claude Sonnet 5 — screens the board, reads ~25 filings, writes the report |
| AI Post Copy | Claude Sonnet 5 — judges whether a published call was borne out, then drafts LinkedIn copy |
| PDF Generation | `@react-pdf/renderer` (no Chromium) |
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
| `npm run reports:download` | Batch download all attached PDF reports to a local folder |

## Mover Studio

Each weekday **around midday Sydney time**, Claude drafts that day's Daily Mover
and leaves it in a review queue at `/mover-studio` for an analyst to approve or
reject. Approving files it in the archive exactly as a manual upload would.

**The pipeline**

1. **Screen the board.** Every ASX listing is quoted; the ones that moved at
   least 5% on at least $500k of turnover and $20m of market cap are ranked into
   top-20 gainers and top-20 losers.
2. **Shortlist the explainable ones.** Each survivor's announcements for the day
   are checked, and anything without a *price-sensitive* filing is dropped — a
   move the public record doesn't explain is not a report.
3. **Pick one.** Claude chooses from the shortlist and says why, with the
   runners-up recorded so a reviewer can see what was passed over.
4. **Read the filings.** The last ~25 price-sensitive announcements are
   downloaded and extracted to text (a results pack runs to 36 pages and 2.6 MB;
   ~235k tokens of input is normal).
5. **Write it.** One call returns both the report's typed page blocks *and* the
   `daily_movers` columns, so the archive row and the PDF cannot disagree.
6. **Render and file.** `@react-pdf/renderer` produces the PDF into a `drafts/`
   prefix, and the row goes to `pending`.

About a minute and roughly **US$0.40** per draft at list price (~$9/month over
22 trading days).

**How it got there.** The first working version cost $1.50. Three measured
changes took 73% out of it without shortening the report:

| Change | Corpus cost |
| --- | --- |
| First version: 25 filings, flat 90k cap, 1-hour prompt cache | $1.42 |
| **Cache breakpoint removed** — a 1h cache *write* bills at 2x input and needs three reads to break even; this pipeline reads a different company every day, so it never got one | $0.71 |
| **Sequential filings collapsed, legal instruments capped** — 16 of one company's 25 price-sensitive filings were takeover procedure: six offer-period extensions, five Panel receipt notices, an 89-page implementation deed | $0.60 |
| **Reading target 25 → 15** | $0.33 |

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
same-session timing guarantee. Both are available if the bill ever matters more
than it does at $9/month.

**When it doesn't run.** The scheduled job declines, without erroring, if it
isn't a weekday in Sydney, if the market didn't trade (detected from the feed's
own timestamps, not a hardcoded holiday table), if **an analyst has already
published a Daily Mover for the day**, or if a scheduled draft for the day
already exists. `?force=1` with the cron secret skips only the time-of-day check,
for re-running a session that was missed.

**Why the cron fires twice.** Vercel cron expressions are UTC only, and Sydney is
UTC+10 for half the year and UTC+11 for the other half. Both 01:30 and 02:30 UTC
are scheduled, and the handler only acts if the firing lands between 11:00 and
15:00 Sydney time. Both firings pass that window, and the first to arrive does
the work — the second is a no-op against the day's unique index. The window is
wide rather than tight because Hobby-plan cron precision is ±59 minutes, which a
narrow window can miss entirely. Nothing changes when daylight saving does.

**`maxDuration` is 300 seconds**, the Hobby ceiling and every plan's default. A
higher value fails the *build* on Hobby rather than failing at runtime. A
measured run takes about 120 seconds, so 300 is ample.

**Reviewing a draft.** The card shows Claude's rationale and confidence, the
report rendered inline, and every announcement it read with the cited ones
marked and linked. The archive fields — move, catalyst, reason, takeaway — are
**editable before approval**: the model drafts, the analyst is still the author.

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
  download-reports.mts   Batch CLI utility to download all research PDFs to a local folder
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
    mover-studio/        review queue, draft review card + approve/reject, inline report preview, evidence list, screen controls
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
    drafts/              draft pipeline, queries, trading-day arithmetic
    posts/               track-record reads, post shapes, compliance footer
    report/              typed report blocks + the react-pdf template
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

**The liquidity screen runs before Claude sees anything.** On a representative
day the raw top-20 gainers were nearly all nano-caps: +47% on $107k of turnover,
+27% on **$2,451**. No prompt fixes a shortlist made of those.

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

**Charts carry a conclusion or they don't ship.** A `chart` page is invalid
without the one-line "what to notice" under it, enforced in `validateReportDoc`.
The column chart plots a real zero baseline rather than bare magnitudes, because
the series these pages exist for are growth series — +6.0, +6.5, +4.0, +0.3,
**-0.5** — where the crossing into negative territory *is* the insight, and a
magnitude-only chart shows five similar bars and hides it.

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

