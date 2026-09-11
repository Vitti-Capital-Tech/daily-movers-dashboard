# Low-Level Design (LLD) — Daily Movers Dashboard

## 1. Introduction

This Low-Level Design (LLD) document provides a comprehensive technical specification of the internal code structures, data schemas, API contracts, execution flows, and state management mechanisms implemented in the **Daily Movers Dashboard**.

---

## 2. Directory & Module Structure

```
daily-movers-dashboard/
├── drizzle/                     # Database migrations & SQL setup scripts
│   ├── 0000_big_enchantress.sql
│   ├── 0001_military_senator_kelly.sql
│   ├── 0002_post_event_returns.sql # mover_status, company_prices, company_quotes
│   ├── 0003_drop_unused_columns_indexes.sql # dead columns & redundant indexes
│   ├── 0004_mover_anchor_close.sql # move_date_close; drops company_prices
│   ├── 0005_mover_drafts.sql    # mover_drafts table + draft_status enum
│   ├── 0006_draft_cache_tokens.sql # cache_write_tokens, cache_read_tokens
│   ├── 0007_linkedin_posts.sql  # linkedin_posts + post_verdict/post_status enums
│   ├── 0008_draft_accuracy_gate.sql # mover_drafts.accuracy
│   └── auth-setup.sql           # RLS, app_users table, admin_emails seed
├── scripts/                     # Operational automation scripts
│   ├── apply-sql.mts            # Idempotent statement-by-statement SQL runner
│   ├── build-logo.mjs           # public/logo.jpeg -> keyed-out mark inlined as src/lib/report/logo.ts
│   ├── download-reports.mts     # Batch CLI script to download all attached PDFs to a local folder
│   ├── preview-report.mts       # Render the report deck to PDF locally (fixture or stored draft), no API call
│   └── storage-setup.mts        # Private Supabase Storage bucket initialization
├── src/
│   ├── actions/                 # Next.js Server Actions (Mutations)
│   │   ├── admin-auth.ts        # unlockAdmin, lockAdmin
│   │   ├── drafts.ts            # startDraft, approveDraft, rejectDraft, reapDrafts
│   │   ├── posts.ts             # generatePost, setPostStatus
│   │   ├── extract.ts           # extractReportAction (Claude PDF AI extraction)
│   │   ├── movers.ts            # saveMover, deleteMover
│   │   └── reports.ts           # createReportUploadUrl (signed upload tickets)
│   ├── app/                     # Next.js App Router routes & pages
│   │   ├── (app)/               # Protected application layout group
│   │   │   ├── companies/       # Company directory & research history
│   │   │   │   ├── [ticker]/    # Single company research timeline
│   │   │   │   └── page.tsx
│   │   │   ├── daily-movers/    # Main Daily Movers table & filters
│   │   │   │   └── page.tsx
│   │   │   ├── mover-studio/    # AI draft review queue (admin only)
│   │   │   │   └── page.tsx
│   │   │   ├── post-studio/     # Track record + LinkedIn copy (admin only)
│   │   │   │   └── page.tsx
│   │   │   └── layout.tsx       # Auth protection barrier & shell wrapper
│   │   ├── api/                 # API route handlers
│   │   │   ├── cron/daily-mover/ # Weekday scheduled draft, Sydney-time gated
│   │   │   │   └── route.ts
│   │   │   ├── drafts/[id]/pdf/ # Admin-only signed URL for an unapproved draft
│   │   │   │   └── route.ts
│   │   │   ├── extract/         # Multipart PDF AI extraction route handler
│   │   │   ├── logo/[ticker]/   # Multi-source company logo proxy with HTML scraper
│   │   │   │   └── route.ts
│   │   │   ├── prices/refresh/  # POST: stale top-up, or {force:true} for admins
│   │   │   │   └── route.ts
│   │   │   ├── reports/[id]/    # Protected 60-second signed PDF redirect handler
│   │   │   │   └── route.ts
│   │   │   └── reports/download-all/ # Admin-protected batch ZIP archive stream
│   │   │       └── route.ts
│   │   ├── login/               # Passwordless identification UI & actions
│   │   ├── globals.css          # Tailwind CSS 4 theme, typography & OKLCH color tokens
│   │   ├── layout.tsx           # Root HTML layout with ThemeProvider and fonts
│   │   └── page.tsx             # Root redirect to /daily-movers
│   ├── components/              # UI Component Library
│   │   ├── mover-studio/        # Draft queue, review card, inline report preview, evidence list
│   │   ├── post-studio/         # Track-record table, assessment panel, variants with copy button
│   │   ├── daily-movers/        # Domain-specific components
│   │   │   ├── company-combobox.tsx
│   │   │   ├── download-reports-button.tsx # Admin-gated batch ZIP download trigger
│   │   │   ├── filter-bar.tsx
│   │   │   ├── mover-dialog.tsx # Add/Edit modal with Claude AI Auto-Fill dropzone
│   │   │   ├── mover-row-actions.tsx
│   │   │   ├── movers-table.tsx # Table with directional chips, performance columns & Documents
│   │   │   ├── pagination.tsx
│   │   │   ├── price-refresh-button.tsx # "As of" stamp + admin force-refresh
│   │   │   ├── price-refresher.tsx # Post-paint stale-price top-up trigger
│   │   │   └── report-upload.tsx# Direct browser-to-storage PDF uploader
│   │   ├── ui/                  # shadcn/ui Base UI & Radix primitives
│   │   ├── admin-unlock-dialog.tsx # Passcode entry modal for admin mode
│   │   ├── app-shell.tsx        # Navigation sidebar, branding & mobile header
│   │   ├── company-logo.tsx     # High-contrast adaptive logo tile with monogram fallback
│   │   ├── db-not-configured.tsx# Fallback diagnostic alerts
│   │   ├── nav-link.tsx         # Active-state navigation anchor with icons
│   │   ├── theme-provider.tsx   # next-themes client wrapper
│   │   ├── theme-toggle.tsx     # Light / Dark / System theme switcher
│   │   └── user-menu.tsx        # User profile, role badge & admin unlock/lock trigger
│   ├── db/                      # Database connection & schema definitions
│   │   ├── index.ts             # Connection caching & pooler configuration
│   │   ├── schema.ts            # Drizzle ORM table & relation schemas
│   │   └── seed.ts              # Idempotent database seed script
│   ├── lib/                     # Utilities, helpers & business logic
│   │   ├── ai/                  # AI & LLM modules
│   │   │   ├── announcement-text.ts # Announcement PDFs -> prompt text (unpdf, visual fallback)
│   │   │   ├── anthropic.ts     # Extraction client (uploaded reports)
│   │   │   ├── client.ts        # Shared Anthropic client, model choices, token accounting
│   │   │   ├── linkedin-post.ts # Judges whether a call was borne out, then drafts the copy
│   │   │   └── mover-draft.ts   # Select a mover, write the report, run the Accuracy Gate
│   │   ├── asx/                 # ASX listing universe, announcements & computed movers board
│   │   │   ├── announcements.ts # Legacy statistics servlet parser + PDF access gate
│   │   │   ├── board.ts         # screenBoards(): universe -> quotes -> liquidity screen -> ranked
│   │   │   ├── index.ts         # Server-side entry point
│   │   │   ├── provider.ts      # AsxDataProvider contract & shared types
│   │   │   ├── source.ts        # Provider selection — single swap point
│   │   │   ├── types.ts         # Client-safe types, DEFAULT_SCREEN, SCREEN_LIMITS
│   │   │   └── universe.ts      # ASX company directory CSV
│   │   ├── auth-config.ts       # Domain & path matching (edge safe)
│   │   ├── auth.ts              # RBAC & session verification (server-only)
│   │   ├── catalysts.ts         # The closed catalyst vocabulary, defined once
│   │   ├── db-error.ts          # Postgres error code parser & credential scrubbing
│   │   ├── drafts/              # Mover Studio pipeline & reads
│   │   │   ├── generate.ts      # runDraftPipeline, shouldRunScheduled, reapStaleGenerating
│   │   │   ├── queries.ts       # Draft queue reads (server-only)
│   │   │   ├── trading-day.ts   # Australia/Sydney date & session arithmetic (client-safe)
│   │   │   └── types.ts         # Client-safe draft row shapes & cost estimation
│   │   ├── format.ts            # Date, percentage & price formatters
│   │   ├── market/              # Market data (ASX prices & profile discovery)
│   │   │   ├── index.ts         # Provider selection — single swap point
│   │   │   ├── provider.ts      # MarketDataProvider contract & shared types
│   │   │   ├── refresh.ts       # Staleness rules, backfill & upserts (server-only)
│   │   │   ├── volume.ts        # Session volume vs trailing average, for the draft prompt
│   │   │   └── yahoo.ts         # Yahoo Finance chart adapter & assetProfile scraper
│   │   ├── movers.ts            # Shared runtime types, return derivation & pagination constants
│   │   ├── posts/               # Track record & LinkedIn post copy
│   │   │   ├── queries.ts       # Track-record reads and post reads (server-only)
│   │   │   └── types.ts         # Client-safe shapes, compliance footer, drift check
│   │   ├── queries.ts           # Drizzle SQL query builder (server-only)
│   │   ├── report/              # Daily Mover report document
│   │   │   ├── fit.ts           # Per-page length budget enforcement & page-ceiling trim
│   │   │   ├── logo.ts          # The house mark as an inlined PNG data URI (generated)
│   │   │   ├── render.ts        # renderReportPdf + draft storage keys (server-only)
│   │   │   ├── template.tsx     # The react-pdf document: a 960x540 slide deck
│   │   │   └── types.ts         # Typed page blocks, disclaimer constant, validation
│   │   ├── session.ts           # Web Crypto HMAC-SHA256 token manager
│   │   ├── storage.ts           # Storage path sanitization, upload helper & limits
│   │   ├── supabase/admin.ts    # Service-role Supabase admin client
│   │   ├── use-query-params.ts  # Client hook for URL searchParams synchronization
│   │   ├── utils.ts             # clsx & tailwind-merge helper
│   │   └── validation.ts        # Zod validation schema & form parsers
│   └── middleware.ts            # Edge request interception & session gating
```

---

## 3. Database Schema & Data Models

### 3.1 Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    COMPANIES ||--o{ DAILY_MOVERS : "researched in"
    CATALYSTS ||--o{ DAILY_MOVERS : "categorizes"
    ANALYSTS ||--o{ DAILY_MOVERS : "authored by"
    COMPANIES ||--o| COMPANY_QUOTES : "latest price of"
    ADMIN_EMAILS ||--o{ APP_USERS : "authorizes"
    MOVER_DRAFTS ||--o| DAILY_MOVERS : "published as"
    DAILY_MOVERS ||--o{ LINKEDIN_POSTS : "written about in"
    COMPANIES ||--o{ MOVER_DRAFTS : "resolved on approval"
    ANALYSTS ||--o{ MOVER_DRAFTS : "by-lined by"

    COMPANIES {
        serial id PK
        text ticker UK
        text name
        text sector
        timestamptz created_at
    }

    CATALYSTS {
        serial id PK
        text slug UK
        text label
        integer sort_order
    }

    LINKEDIN_POSTS {
        serial id PK
        integer mover_id FK
        post_status status
        post_verdict verdict
        text verdict_reason
        text evidence_quote
        jsonb posts
        jsonb snapshot
        text model
        integer input_tokens
        integer cache_write_tokens
        integer cache_read_tokens
        integer output_tokens
        text created_by
        timestamptz created_at
        timestamptz posted_at
    }

    MOVER_DRAFTS {
        serial id PK
        draft_status status
        date move_date
        text trigger
        text ticker
        text company_name
        text sector
        integer company_id FK
        numeric move_pct
        move_type move_type
        text move_window_label
        text catalyst_slug
        text reason_for_move
        text main_takeaway
        numeric report_price
        integer analyst_id FK
        jsonb screen
        jsonb selection
        jsonb sources
        jsonb report
        text draft_storage_path
        text model
        integer input_tokens
        integer cache_write_tokens
        integer cache_read_tokens
        integer output_tokens
        text progress
        text error
        integer approved_mover_id FK
        text created_by
        timestamptz created_at
        text reviewed_by
        timestamptz reviewed_at
        text review_note
    }

    ANALYSTS {
        serial id PK
        text name UK
        boolean active
    }

    DAILY_MOVERS {
        serial id PK
        integer company_id FK
        integer catalyst_id FK
        integer analyst_id FK
        date move_date
        numeric move_pct
        move_type move_type
        text move_window_label
        text reason_for_move
        text main_takeaway
        numeric report_price
        numeric move_date_close
        mover_status status
        text report_url
        text report_storage_path
        text asx_announcement_url
        jsonb extraction
        text created_by
        timestamptz created_at
        timestamptz updated_at
    }

    COMPANY_QUOTES {
        integer company_id PK
        numeric price
        text currency
        timestamptz as_of
        text source
        timestamptz refreshed_at
        timestamptz attempted_at
        text error
    }

    ADMIN_EMAILS {
        text email PK
        text note
        timestamptz created_at
    }

    APP_USERS {
        text email PK
        timestamptz first_seen_at
        timestamptz last_seen_at
    }
```

### 3.2 Detailed Table Specifications

#### 1. `companies`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `serial` | Primary Key | Unique internal company ID. |
| `ticker` | `text` | NOT NULL, Unique Index | Primary ticker code (e.g., `JBH`, `SPZ`). |
| `name` | `text` | NOT NULL, B-Tree Index | Full legal/trading name. |
| `sector` | `text` | Nullable | GICS industry sector. |
| `created_at` | `timestamptz` | NOT NULL, Default `now()` | Record creation timestamp. |

#### 2. `catalysts`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `serial` | Primary Key | Unique catalyst ID. |
| `slug` | `text` | NOT NULL, Unique Index | Machine-readable identifier (e.g., `earnings_result`). |
| `label` | `text` | NOT NULL | Human-readable label (e.g., `Earnings Result`). |
| `sort_order` | `integer` | NOT NULL, Default `0` | UI dropdown presentation sort order. |

#### 3. `analysts`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `serial` | Primary Key | Unique analyst ID. |
| `name` | `text` | NOT NULL, Unique Index | Full name of the research analyst. |
| `active` | `boolean` | NOT NULL, Default `true` | Status flag for active research assignment. |

#### 4. `daily_movers`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `serial` | Primary Key | Unique daily mover record ID. |
| `company_id` | `integer` | NOT NULL, FK -> `companies(id)` (`ON DELETE RESTRICT`) | Associated company. |
| `catalyst_id` | `integer` | NOT NULL, FK -> `catalysts(id)` (`ON DELETE RESTRICT`) | Categorized catalyst. |
| `analyst_id` | `integer` | Nullable, FK -> `analysts(id)` (`ON DELETE SET NULL`) | Authoring research analyst. |
| `move_date` | `date` | NOT NULL | Calendar date of report and price move (`YYYY-MM-DD`). |
| `move_pct` | `numeric(6,2)` | NOT NULL | Signed price change percentage (e.g. `-11.50`, `+20.60`). |
| `move_type` | `move_type` enum | NOT NULL (`intraday` \| `closing`) | Pricing timeframe type. |
| `move_window_label`| `text` | Nullable | Verbatim phrasing from PDF (e.g., "Morning Trade"). |
| `reason_for_move` | `text` | NOT NULL (Max 1000 chars) | Detailed catalyst analysis. |
| `main_takeaway` | `text` | NOT NULL (Max 1000 chars) | Core investment conclusion for future reference. |
| `report_price` | `numeric(12,4)` | Nullable | Share price recorded at time of report publication. When null, the post-event return falls back to `move_date_close`. |
| `move_date_close` | `numeric(12,4)` | Nullable | ASX close on (or last before) `move_date` — the fallback anchor. Resolved once from market data and then never touched, since a past close does not change. Null only where the provider has no data for that date. |
| `status` | `mover_status` enum | NOT NULL, Default `new` (`new` \| `reviewed` \| `follow_up`) | **Vestigial.** The Status column was removed from the UI; the column is retained so reversing that needs no destructive migration. Nothing reads or writes it. |
| `report_url` | `text` | Nullable | External link to research PDF/document. |
| `report_storage_path`| `text` | Nullable | Relative object key in private `reports` bucket. |
| `asx_announcement_url`| `text` | Nullable | **Vestigial.** The ASX announcement link was removed from the UI, the Add/Edit form and the PDF extraction; the column is retained so reversing that needs no destructive migration. It was null on every row at removal. |
| `extraction` | `jsonb` | Nullable | Verbatim raw LLM/OCR structured JSON output. |
| `created_by` | `text` | Nullable | Email address of the creator. |
| `created_at` | `timestamptz` | NOT NULL, Default `now()` | Record creation timestamp. |
| `updated_at` | `timestamptz` | NOT NULL, Default `now()` | Last modification timestamp. |

#### 5. `company_quotes`
One row per company holding the latest price, overwritten in place, plus the refresh bookkeeping.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `company_id` | `integer` | Primary Key, FK -> `companies(id)` (`ON DELETE CASCADE`) | Company. |
| `price` | `numeric(12,4)` | Nullable | Latest price, ~20 minutes delayed. |
| `currency` | `text` | Nullable | Provider-reported currency (`AUD`). |
| `as_of` | `timestamptz` | Nullable | Provider's timestamp for `price`, not our fetch time. |
| `source` | `text` | Nullable | Provider that supplied it. |
| `refreshed_at` | `timestamptz` | Nullable | Last refresh that returned a price. |
| `attempted_at` | `timestamptz` | NOT NULL, Default `now()` | Last attempt, successful or not. **Staleness is measured from this**, so a delisted ticker isn't retried on every page load. |
| `error` | `text` | Nullable | Reason the last attempt failed; null after a success. Stale prices are kept rather than blanked. |

---

## 3.3 Post-Event Return Pipeline

Nothing here is entered by hand. The return is **derived on read** from stored prices rather than stored as a number — the same reasoning as `move_pct` driving direction, so a corrected close fixes every window at once.

| Layer | File | Responsibility |
| :--- | :--- | :--- |
| Provider contract | `src/lib/market/provider.ts` | `MarketDataProvider` (`fetchQuotes` + `fetchSessionMoves` + `fetchCloses` + `fetchDailyBars`), `DailyBar`, `DailyClose`, `Quote`, `SessionMove`, `UnknownSymbolError`. Nothing above this layer sees a provider's response format. Split three ways because the work genuinely differs: current prices are wanted for every covered company on a schedule and batch cheaply; session moves are wanted for the whole ~1,200-ticker screening universe once a day and are read, ranked and discarded rather than stored; closes are only needed for the few companies missing history; and `fetchDailyBars` is one ticker at a time by design, since it runs once per draft for a company already chosen and batching would mean a history request for all ~1,200 screened tickers to answer a question about one of them. |
| Volume profile | `src/lib/market/volume.ts` | `fetchVolumeProfile` turns ~60 sessions of bars into the session's volume, a 30-session trailing average with the move date excluded, and the ratio between them. The ratio is the point: two million shares is a quiet day for one company and five times normal for another, and a Daily Mover's central claim — that an announcement moved the stock — is evidenced by volume, not by the move alone. Requires 10 averaged sessions before it will divide, because a stock that trades three days in twenty has an average dominated by zeroes and produces a meaningless 40x. Never throws: a missing profile costs one figure, not the day's draft. |
| Session moves | `src/lib/market/yahoo.ts` | `fetchSessionMoves` batches 50 symbols per request with 4 in flight (~25 requests for the whole universe). A chunk that fails is logged and its tickers are simply absent, so one bad batch out of twenty-five cannot cost the day's board. Turnover is derived as `price × volume` — providers report volume in shares, and a liquidity screen has to be in dollars or a 500-million-share move in a half-cent stock passes it. |
| Yahoo adapter | `src/lib/market/yahoo.ts` | Built on the `yahoo-finance2` package, which owns the cookie/crumb handshake `quote()` requires, response validation and retries. `fetchQuotes` batches up to 40 symbols per request; tickers the quote endpoint skips (suspended listings such as `OPT.AX`) fall back to the price in a chart response's metadata. Bars are dated by shifting the bar's opening instant by the exchange's `gmtoffset` -- a no-op under AEST, but required under daylight saving, where 10:00 local is 23:00 UTC the previous day. |
| Provider selection | `src/lib/market/index.ts` | Single-line swap point for a licensed feed. |
| Refresh service | `src/lib/market/refresh.ts` | **Quotes**: every due company in one batched request, then a single multi-row upsert (`excluded.*`) rather than one round trip each -- the database is in Tokyo, and sequential upserts dominated the runtime. **Anchors**: only for movers whose `move_date_close` is still null (i.e. newly added ones), capped at 20 per run with 4 concurrent requests; normally there are none. Staleness is a 30 min TTL with a 6 h backoff after a failure; concurrent callers are coalesced by an in-flight promise keyed on mode. |
| Trigger route | `src/app/api/prices/refresh/route.ts` | `POST`. Unauthenticated for the automatic stale-only sweep (self-limiting via TTL + ceiling); `{ force: true }` requires `canWrite`, since one forced click is a request per covered company. Returns `{ due, refreshed, failed }`. |
| Client trigger | `src/components/daily-movers/price-refresher.tsx` | Fires after paint, calls `router.refresh()` only when something changed. |
| Manual control | `src/components/daily-movers/price-refresh-button.tsx` | Shows "Prices as of ..." (from `getPriceFreshness()`) to everyone, plus a force-refresh button for admins. Forced runs ignore the TTL and the per-run ceiling. |
| Derivation | `src/lib/queries.ts`, `src/lib/movers.ts` | The anchor is `coalesce(report_price, move_date_close)` -- a plain column read, previously a correlated subquery over the price series. `pctChange` turns it and the current price into the return. |

Semantics:

- **Anchor** = `report_price`, else `move_date_close` (the last close on or before `move_date`; `<=` rather than `=` because a move date can land on a day with no close of its own). Resolved once per mover, on the refresh after it is added. An inferred anchor is marked in the UI with a dotted underline.
- **Post-Event Return** = anchor → current price. Null when either side is unknown, rendered as `—` with the reason on hover rather than as a misleading 0.0%.
- Fixed-window returns (1W / 1M) were removed as unnecessary. The `company_prices` daily series went with them: it existed to find a close anywhere inside a window, and the only historical price still read is the anchor — one value per mover, now stored on the mover itself. That was ~2,000 rows serving 39 numbers.

Refresh is pull-based with no cron: a page load asks, and the service decides whether anything is due. A run that hits its ceiling is resumed by the next request, since staleness is re-evaluated each time. Adding an older mover for an already-tracked company automatically triggers a history backfill on the next refresh.

*(Historical note, now moot: while the daily series existed,)* **history was considered complete once a close existed at or before the earliest move date** -- which is exactly what the anchor lookup needs -- not once it reaches the requested `move_date - 10 days`. The lead days widen the *request* so a move date after a long weekend still has a preceding close, but the first trading day Yahoo returns is usually a day or two later, so comparing against the requested date never matched: 16 companies re-fetched and re-upserted their entire history on every refresh (~700 wasted row writes each time, measured at 511 in one sweep). With the correct check a steady-state refresh writes 47 quote rows in one statement and ~0 price rows.

The one remaining exception is a ticker whose history Yahoo cannot cover back to its move date at all (`OPT`, suspended since July): its anchor can never be satisfied, so it re-fetches ~23 bars per refresh. Bounding that properly needs a stored "history requested from" marker; it is left as a known, measured cost rather than hidden.

---

## 3.4 `mover_drafts` — Why a Separate Table

`mover_drafts` is deliberately **not** a `status` column on `daily_movers`.

Every row in `daily_movers` is approved research, which is precisely what makes
"what did we say last time?" answerable. A status column would require every
existing query — the table view, the company timeline, the summary counts, the
ZIP export — to carry `WHERE status = 'approved'`, and a single omission would
surface an unreviewed machine draft as Vitti's published position.

Consequences of the split, each deliberate:

| Decision | Reason |
| --- | --- |
| `ticker` is text, not a `company_id` FK | The pick happens before any company is resolved. Creating a `companies` row for a draft would leave a stub in the directory for every rejection. The FK is populated only on approval. |
| `catalyst_slug` is text, not a `catalyst_id` FK | Same: resolved against `catalysts` at approval time. |
| Row is inserted **before** the pipeline runs | Reading ~25 filings and generating a report takes minutes — longer than a request should be held open. The row is the state and the client polls it, so a reload rejoins the run rather than losing it, and a crash leaves a `failed` row carrying its reason. |
| `screen`, `selection`, `sources`, `report` as `jsonb` | The audit trail. "Why did it pick this?" is unanswerable a week later without the board it chose from, and a reviewer checking a number needs the announcement it came from. Same reasoning as `daily_movers.extraction`. |
| `accuracy` as `jsonb`, kept after the rewrite | The Accuracy Gate's verdict, summary and every finding. Discarding it once the report is corrected would leave the two questions a reviewer actually asks — "was this checked?" and "what did the check find?" — unanswerable from the row. It is also the honest record when the gate itself failed and the draft reached review unverified. |
| Input tokens split three ways | Cache writes, cache reads and uncached input bill at different rates, and this pipeline puts most of its input through the cache. Recording only `input_tokens` reported a 235k-token corpus as 3k. |
| Partial unique index on `(move_date) WHERE trigger = 'cron'` | The scheduled run's idempotency guard: a retried or double-fired invocation hits the constraint instead of spending a second run's Claude calls. Manual drafts are excluded so an analyst can re-draft freely. |

**Approval is a projection plus a storage move.** The draft's fields (as edited
by the reviewer) are inserted into `daily_movers`, and the PDF is `move`d from
the `drafts/` prefix into the same `<TICKER>/<date>-<slug>-<random>.pdf` scheme
a manual upload produces. `/api/reports/[id]`, `/api/reports/download-all` and
`scripts/download-reports.mts` therefore need no knowledge of drafts at all.

---

## 3.5 `linkedin_posts` - Why `verdict` Is Stored, Not Computed

Whether a published call "worked" cannot be derived from the data. The archive
makes this concrete: 25 of 56 movers continued in the direction they moved on
the day and 31 reversed, and the reversals include some of the most clearly
correct calls - a stock that fell 14% on an equipment failure and has since
risen 27% vindicates a note arguing the failure was manageable, and refutes one
arguing the outlook had worsened. The same numbers support opposite conclusions
depending on what the takeaway said.

So `verdict` is a recorded judgement (`validated` / `mixed` / `contradicted` /
`too_early`) made by reading `daily_movers.main_takeaway`, and `evidence_quote`
holds the verbatim clause it rests on. That quote is the audit trail: it lets a
reviewer check the post's claim against what was actually written rather than
against what it plausibly might have said.

| Column | Reason |
| :--- | :--- |
| `snapshot` (jsonb) | The prices and return the copy was computed from. A post reading "+27.1% since our note" is true only as at the instant it was written; the live quote moves daily. Without the snapshot, the copy and the table are both correct about different moments and nothing can tell you the copy has gone stale. `returnDrift()` compares the two and the panel warns past three percentage points. |
| `posts` (jsonb) | The drafted variants. Empty for any verdict other than `validated` - enforced in `lib/ai/linkedin-post.ts` by filtering the variants on the verdict, not merely requested in the prompt, because a polished post attached to a `contradicted` verdict must never reach a reviewer. |
| `status` | `draft` / `posted` / `discarded`. `posted` is what stops the desk publishing about the same call twice; the track-record query reads the newest post back against each mover. |
| One row per generation, `mover_id` FK | Re-assessing is a new row, not an overwrite. This is what the **Assess again** control writes, and it matters for more than history: a verdict is a judgement about a moment, so `too_early` becomes answerable later once the milestones the note named have happened. Keeping every run — with the return each was judged against, surfaced by `listAssessmentsForMover()` — is what distinguishes re-examining a call from shopping it until the verdict comes out favourably. The track-record join takes only the newest per mover (`newestPostSql`), or a thrice-assessed mover would multiply into three table rows and make the paginated count wrong. |

**The compliance footer is not in this table.** It is a constant in
`lib/posts/types.ts`, appended by `fullPostText()` at copy time - so the Copy
button always puts the footer on the clipboard along with the body. A post
stating a return is a past-performance representation published by a Corporate
Authorised Representative under an AFSL; the required wording is not something a
language model should paraphrase, and keeping it out of the schema means there is
no path by which it varies per row. Same reasoning as the PDF disclaimer.

---

## 4. Report PDF Storage & Delivery Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Client as Browser (ReportUpload Component)
    participant Action as Server Action (createReportUploadUrl)
    participant AdminClient as Supabase Admin Client (lib/supabase/admin.ts)
    participant Storage as Supabase Storage ('reports' bucket)
    participant API as Download Endpoint (/api/reports/[id])

    Note over Client,Storage: Upload Phase
    Client->>Action: createReportUploadUrl({ fileName, fileSize, fileType, ticker, moveDate })
    Action->>Action: Verify Admin Role & File Constraints (PDF <= 25MB)
    Action->>AdminClient: Mint signed upload token
    AdminClient->>Storage: createSignedUploadUrl(sanitizedPath)
    Storage-->>Action: { path, token }
    Action-->>Client: Return Upload Ticket { ok: true, path, token }
    Client->>Storage: Direct PUT file using token (bypasses Serverless limit)

    Note over Client,API: Download Phase
    Client->>API: GET /api/reports/:id
    API->>API: Verify Session (redirect to /login if unauthenticated)
    API->>AdminClient: Mint 60s signed download URL
    AdminClient->>Storage: createSignedUrl(reportStoragePath, 60s)
    Storage-->>API: signedUrl
    API-->>Client: 307 Redirect to signedUrl
```

### 4.1 Storage Path Sanitization (`src/lib/storage.ts`)
- Storage key format: `reports/<ticker>/<moveDate>-<slug>-<random>.pdf`
- Path sanitization converts directory traversal markers (`..`) and non-alphanumeric characters into safe dashes to prevent escape attacks.
- File size limit: `MAX_REPORT_BYTES = 25 * 1024 * 1024` (25 MB).

### 4.2 Protected PDF Route (`/api/reports/[id]/route.ts`)
- Intercepts requests for report documents.
- Verifies session token via `getSessionUser()`. If unauthenticated, redirects to `/login?error=expired`.
- If `reportStoragePath` exists, mints a 60-second signed download URL via `createSupabaseAdminClient()`.
- Falls back to `reportUrl` if only an external link is present.

### 4.3 The Report Document Model (`src/lib/report/types.ts`, `template.tsx`)

A drafted report is a typed **discriminated union of page blocks**, not a string of markdown. That is deliberate three times over: it is the model's output schema, so asking for `ReportPage[]` through a tool definition produces a document with the same rhythm every day where asking for prose produces a wall of text to re-typeset by hand; the renderer is a lookup from `kind` to a component, so adding a page style is additive; and it stores compactly in `mover_drafts.report` and can be diffed against a later prompt's output.

| Kind | What it answers | Notes |
| --- | --- | --- |
| `cover` | What happened, and how far did it move | First page only. The company name set large, the share-move headline, exactly two hero tiles, and one line under them carrying the main qualification on the headline figure — "completion is conditional on PNG regulatory approvals". The move tile is coral for a fall and mint for a rise, from `ReportDoc.movePct`; the second is cobalt, so it reads as a fact rather than a second verdict. |
| `narrative` | What does this business do / what changed | At most 3 short paragraphs, optional callouts. Deliberately the fallback rather than the default — if the content is figures, a sequence or a contrast, another kind carries it better. |
| `kpis` | What the numbers were | 3-6 big-number tiles in rows of three, the first filled in the accent. This is the page that carries deal and project economics — NPV with its discount rate, production, AISC, capex, cash on completion, what is deferred — and the per-tile note is where the condition on a figure goes. |
| `entities` | Where does the money come from | Segments, geographies, projects or acquisitions, each with a dense stat line: `NPV $340M - 95koz a year - AISC $1,750/oz - capex $140M`. |
| `chart` | What direction is this heading | One series plus a **required** conclusion line. Three forms: `columns`, `bars`, `waterfall`. See below. |
| `timeline` | How did the story get here | Two to eight dated steps as marks along a rule, oldest first. It does a job no paragraph does: it separates what has happened from what is only agreed, so a step dated "Pending" cannot be read as done. |
| `market-vs-reality` | Why did a record result sell off | Fixed three-block layout: what was announced / what the market reacted to / what decides it from here. Its own kind rather than three callouts, because the gap between the announcement and the reaction is the whole point on those days and a fixed layout stops it being written as another narrative page. The middle block is required by the prompt to be worded as a reading ("likely reflects"), because no filing states why a stock moved. |
| `comparison` | What changed since last time / consensus vs actual / what is received against what is given up | A label and two figures with a verdict column, rendered as cards — the "before" muted, the "now" outlined in the accent. One layout serves all three because they are the same shape; `columns` names which. The third use exists because a divestment note that prints only the proceeds cannot be assessed. |
| `management` | Who runs it, and what changed at the top | Everything but name and role is optional — a directors' report gives tenure and holdings, an appointment announcement gives a start date, a results pack gives a name under a signature. A page that renders what is known beats one needing a full dossier. |
| `risks` | What could make this worse | **Structurally required** by `validateReportDoc`. A missing risks page turns explanatory research into promotional material, which is a reputational problem rather than a thin note. |
| `vitti-view` | What is the setup | Scorecard, key debate, next catalyst. Not a recommendation. |
| `outlook` | What would improve or worsen the story | Two company-specific lists. |
| `closing` | Where does this stand | Last page only. Three or four standalone statements, then one pull quote set large in the accent. The house sign-off is appended by the renderer, never model-written — a model asked to end on a set phrase paraphrases it about one time in five, as with the disclaimer. |

Every kind also carries an optional `sourceNote`, which the page schema marks **required**: the filing and its ASX date, printed small under the content. It is a reviewer's audit trail and a check on the writer — a figure whose source cannot be named is usually a figure that was not read anywhere — and the Accuracy Gate verifies that the named filing actually carries the page's figures.

**The document is four or five pages, enforced three times.** `REPORT_PAGE_TARGET` (`min: 4`, `max: REPORT_MAX_SHEETS - 1`) bounds `minItems`/`maxItems` on the tool schema, `fitReportPages` drops droppable pages from the back of an over-long document, and `validateReportDoc` refuses to render one. Three layers because a model told "at most five pages" in prose will still sometimes send six, and because the failure is invisible until a reader opens an eleven-sheet PDF — which is what the desk reviewed on 10 September 2026, with the dividend, the buy-back, deal completion and project execution each restated on three or four pages. The cover, the closing and the risks page are structural, so the trim walks backwards over everything else.

**Charts carry a conclusion or they do not ship.** `validateReportDoc` rejects a `chart` page without its one-line "what to notice", and `normalisePage` drops one that arrives without a plottable series. Three forms exist and no more: `columns` for a series over time, `bars` for named categories whose labels will not fit under a column, and `waterfall` for a build-up. Deliberately not a general charting layer — a second axis or a scatter would be new ways to produce a chart nobody can read.

**A cash balance is a waterfall.** An $880 million pro-forma balance plotted as a single column answers none of the questions a reader has: how much arrived with the deal, how much is already committed to the declared dividend, the announced buy-back and committed capex, and what is actually free. A `waterfall` takes an opening total (`isTotal`), the signed steps, and a closing total; the renderer folds the steps into running spans in `waterfallSpans` and floats each bar between the running totals either side of it. Two guards: `normalisePage` demotes a waterfall whose points are all totals to a column chart, because as a waterfall it renders as full-height bars that do not build, and `validateReportDoc` reports the same shape as a problem if it reaches the renderer another way.

The column chart plots a **real zero baseline**, splitting the plot area by how far the series runs each way. The series these pages exist for are growth series — `+6.0, +6.5, +4.0, +0.3, -0.5` — where the crossing into negative territory *is* the insight; a chart plotting magnitude alone shows five bars of similar height and hides the one fact worth showing.

**Dropped pages are logged.** `normalisePage` returning null used to be silent, which hid the one failure this schema produces: a page whose `kind` is right and whose body is empty. Chart pages went missing that way — the model emitted them without a conclusion line, they were discarded, and the reports simply had no charts with nothing anywhere saying why.

**The sheet is 960x540, not A4.** The template rendered A4 portrait on white until a generated draft was compared with what the desk actually publishes — the Focus Minerals note of 11 September 2026, a 16:9 deck on deep navy with a mint rule top and bottom, the house mark in the corner, a serif display line, and content in tiles, icon cards, dated timelines and before/now card tables. Next to it the portrait draft read as a typed memo. 16:9 rather than A4 landscape because the deck is read on a screen far more often than it is printed, and the extra width is what lets three tiles sit in a row with air around them.

**Colour carries meaning, never decoration** (`PALETTE`, `pageAccent`). Navy is the ground, with tiles a lighter navy so they read as raised rather than outlined and the footer band darker so the page has a floor. **Mint** is the house accent and it marks the finding — the eyebrow, the highlighted tile, the conclusion band, the closing pull quote — so a reader who follows only the mint gets the argument. **Coral** is reserved for the direction that hurts: a fall, a risk card, a waterfall step that takes cash out. **Cobalt** is a fact without a verdict. Body copy is one off-white and one grey and nothing else, because coloured body text on a dark ground makes a slide read as a warning label.

**Icons are drawn, not set** (`IconGlyph`, `REPORT_ICONS`). Sixteen marks — cash, regulation, timing, contract, mine, trial and so on — each two or three `Svg` primitives, chosen by the model from an enum shared with the tool schema. Drawn rather than taken from an icon font because a font has to be fetched at render time and a missing glyph on a client document is a blank square where a meaning was; an enum rather than free text because the renderer can only draw what it has a path for.

**The house mark is inlined, not read from `public/`** (`logo.ts`, `scripts/build-logo.mjs`). The source asset is a square JPEG of the mark above the wordmark on a flat navy ground, which is the wrong shape twice: the ground is a different navy from the page, so a rectangle would show, and the stacked wordmark is illegible at corner size. The build script keys the ground out by distance from the corner colour — with a soft alpha ramp, so the diagonal strokes keep their anti-aliasing — crops to the mark, scales to 240px and writes it out as a base64 PNG module; the template sets the wordmark as type beside it, which stays crisp at any scale. A data URI rather than `fs.readFile("public/logo.jpeg")` because the PDF is rendered inside a serverless function, whose filesystem holds only what Next.js traced into the bundle: a path that works in `next dev` and throws in production is the worst version of this.

**Layout is verified by looking at the rendered page.** A spacing bug looks plausible in the style object and wrong on the page: the KPI card once inherited the page's 1.5 line height and put a label's baseline **8pt** below a 21pt number's — inside its descender depth, so any value containing a descender collided outright. `npm run report:preview` renders the template with no API call, from a fixture that exercises every page kind or from a stored draft by id, which is what makes a layout change cheap to check. It bundles with esbuild first because `@react-pdf/hyphenate` declares only an `import` condition for its language subpaths, so a direct `tsx` run raises `ERR_PACKAGE_PATH_NOT_EXPORTED` on `./en-us`; Next.js never hits it because it bundles the renderer itself.

---

## 5. Authentication, Session & Access Control Layer

```mermaid
graph TD
    subgraph Request["Inbound HTTP Request"]
        C["Cookie: vitti_admin or vitti_session"]
    end

    subgraph TokenParsing["lib/session.ts (Web Crypto)"]
        Split["Split into Body & Signature"]
        Verify["crypto.subtle.verify(HMAC-SHA256, AUTH_SECRET)"]
        Expiry["Check payload.x >= currentTime"]
    end

    subgraph AuthLogic["lib/auth.ts"]
        CheckAdmin["Is valid vitti_admin token?"]
        DefaultViewer["Default: { role: 'viewer', canWrite: false }"]
        AdminRole["Admin: { role: 'admin', canWrite: true }"]
    end

    C --> Split
    Split --> Verify
    Verify -->|Valid Admin Cookie| Expiry
    Expiry -->|Not Expired| AdminRole
    Split -->|No / Invalid Cookie| DefaultViewer
```

### 5.1 Public Viewer Access & Admin Token Format (`src/lib/session.ts`)
- **Default Public Session**: Visitors without an admin token automatically receive a guest session: `{ email: "viewer@vitti.capital", role: "viewer", canWrite: false }`.
- **Admin Token (`vitti_admin`)**: Generated upon passcode verification via `unlockAdmin()`.
- **Structure**: `<base64url(payload)>.<base64url(signature)>`
- **Payload Schema**:
  ```typescript
  type SessionPayload = {
    e: string; // Identifier: "admin@vitti.capital"
    x: number; // Expiration epoch in seconds (TTL: 30 days)
  };
  ```
- **Signing Algorithm**: HMAC using SHA-256 (`crypto.subtle`) with `AUTH_SECRET` (minimum 32-character requirement).
- **Constant-Time Passcode Check**: `verifyAdminPasscode()` uses `timingSafeEqual()` bitwise loop to validate against `ADMIN_PASSCODE`.
- **Cookie Security Attributes**: `HttpOnly = true`, `SameSite = Lax`, `Secure = true` (in production), `Path = /`, `Max-Age = 2,592,000` (30 days).

---

## 6. Data Access Layer (`src/lib/queries.ts`)

All database queries are marked `server-only` to guarantee zero PostgreSQL driver leakage into client bundles.

```mermaid
classDiagram
    class Queries {
        +listDailyMovers(filters: MoverFilters) Promise~MoverListResult~
        +getMoverById(id: number) Promise~MoverRow | null~
        +getResearchHistory(ticker: string) Promise~ResearchHistoryResult | null~
        +listCompaniesWithCounts() Promise~CompanyCountRow[]~
        +getFormOptions() Promise~FormOptions~
        +getPriceFreshness() Promise~PriceFreshness~
        +getSummary() Promise~SummaryResult~
    }
```

### 6.1 Query Specifications

#### `listDailyMovers(filters: MoverFilters)`
- **Purpose**: Retrieves paginated, sorted, and filtered research rows for the main table.
- **Joins**: `daily_movers` $\bowtie$ `companies` $\bowtie$ `catalysts` $\leftouterjoin$ `analysts`.
- **Selection**: Returns full row metadata including `reportStoragePath` and `reportUrl`, plus the derived performance prices.
- **Filter Clauses (`buildWhere`)**:
  - `q`: Matches `ilike(companies.name, %q%)` $\lor$ `ilike(companies.ticker, %q%)` $\lor$ `ilike(catalysts.label, %q%)`.
  - `from` / `to`: Date bounds against `daily_movers.move_date`.
  - `catalystId`: Direct match on `daily_movers.catalyst_id`.
  - `direction`: Evaluates `daily_movers.move_pct >= 0` (for `up`) or `< 0` (for `down`).

---

## 7. Server Actions & Mutation Lifecycle

### 7.1 `saveMover(_prev: MoverFormState, formData: FormData)`
1. **Authorization Gate**: Executes `assertCanWrite()` $\rightarrow$ `requireAdmin()`.
2. **Schema Validation**: Calls `parseMoverForm(formData)` validating `reportStoragePath` and `reportUrl`.
3. **Execution**: Performs `UPDATE` (if ID present) or `INSERT`.
4. **Cache Invalidation**: Triggers cache revalidation across `/daily-movers`, `/companies`, and `/companies/[ticker]`.

### 7.2 `createReportUploadUrl(input)`
1. Verifies admin permissions via `requireAdmin()`.
2. Validates PDF mime type and file size ($\le 25$ MB).
3. Builds sanitized path via `buildReportPath()`.
4. Mints signed upload token via Supabase Storage admin client.

### 7.3 `POST /api/extract` Route Handler (`src/app/api/extract/route.ts`)
1. Authenticates session caller with `requireAdmin()` (enforces admin privilege).
2. Validates uploaded PDF file bytes ($\le 25$ MB).
3. Invokes `extractMoverFromPdfBuffer()` using Claude Sonnet 4.6 with tool calling (`save_daily_mover_research`).
4. **Auto-Entities Resolution**:
   - Queries `companies` by ticker; if not found, automatically inserts the company into `companies` and returns the newly minted entity ID.
   - Maps extracted catalyst slug with multi-strategy fuzzy matching against `catalysts` table to resolve `catalystId`.
   - Maps or auto-creates authoring analyst in `analysts` table to resolve `analystId`.
5. Returns typed JSON `ExtractionResponse` to immediately populate client state in `MoverDialog`.

### 7.4 `unlockAdmin(_prev, formData: FormData)`
1. Extracts `passcode` from submission.
2. Validates against `process.env.ADMIN_PASSCODE` in constant time via `verifyAdminPasscode()`.
3. Issues HMAC-SHA256 signed `vitti_admin` session token cookie and triggers cache revalidation.

### 7.5 `lockAdmin()`
1. Clears `vitti_admin` and `vitti_session` cookies.
2. Revalidates dashboard cache, instantly returning user to View-Only mode.

### 7.6 `GET /api/reports/download-all` Route Handler (`src/app/api/reports/download-all/route.ts`)
1. **Authentication Gate**: Enforces admin permission by checking `user.canWrite` (`getSessionUser()`), returning HTTP 403 if unauthorized.
2. **Entity Query**: Fetches all `daily_movers` with `report_storage_path` or `report_url` joined with `companies.ticker` and `companies.name`.
3. **Concurrent Download Pool**: Executes downloads with an in-process worker pool (`CONCURRENCY_LIMIT = 8`):
   - Supabase Storage blobs are downloaded via `supabase.storage.from("daily-mover-reports").download(path)`.
   - External report URLs are fetched with timeout protection.
4. **In-Memory ZIP Packaging**: Files are added to a `JSZip` instance named as `YYYY-MM-DD_TICKER_CompanyName.pdf` and compressed with DEFLATE level 6.
5. **Streaming Response**: Returns binary ZIP payload with `Content-Disposition: attachment; filename="daily-movers-reports-YYYY-MM-DD.zip"`.

### 7.7 `startDraftAction(_prev, formData: FormData)` (`src/actions/drafts.ts`)
1. **Authorization Gate**: `requireAdmin()`.
2. **Screen Criteria**: Reads `minTurnover`, `minMarketCap`, `minAbsChangePct`, `perSide` and clamps each into `SCREEN_LIMITS`, falling back to `DEFAULT_SCREEN`.
3. **Row First**: Inserts a `mover_drafts` row with `status = 'generating'` and returns its id immediately — the pipeline takes minutes, so the row is the state the client polls.
4. **Background Continuation**: Hands `runDraftPipeline(draftId, moveDate, criteria)` to `after()` from `next/server`, so the action responds in milliseconds while the invocation stays alive for the work. Requires `maxDuration = 800` on the page, since a Server Action inherits the page's timeout.

### 7.8 `runDraftPipeline(draftId, requestedDate, criteria, options)` (`src/lib/drafts/generate.ts`)
Advances the row in place, writing a human-readable `progress` string at each stage:
1. **`screenBoards()`** — ASX company directory (~1,830 listings) → market-cap pre-filter at 70% of the floor → `marketData.fetchSessionMoves()` in batches of 50 → turnover computed as `price × volume` → both sides ranked.
2. **Session Date** — derived as the exchange-local date of the newest quote timestamp, *not* the server clock. For `trigger = 'cron'` a mismatch is raised as a closed market (the public-holiday check); a manual run adopts the feed's date.
3. **Candidate Shortlist** — one announcements lookup per screened mover (concurrency 6, interleaved across gainers and losers, capped at 40). Movers with no price-sensitive filing that session are dropped as unexplainable. The screen's floors default to **$1m turnover / $75m market cap**, raised from $500k/$20m: the old pair was a pure liquidity filter and let through $30m explorers whose whole move was one drill hole, which the desk then passed over anyway. Each candidate is printed with its turnover as a share of market capitalisation — a large move on 8% of the register changing hands is a speculative blow-off, on 0.4% it is a re-rate, and the ratio is the cheapest way to tell them apart.
4. **`selectMover()`** — one tool call returning `{ ticker, rationale, runnerUps, confidence }`, with the ticker constrained server-side to the candidate list. The prompt's second criterion is *prefer the established business over the speculative one*, with single drill holes, early-phase trial datapoints and unconfirmed bid speculation named as low quality regardless of move size, and one test to apply: would this report still be worth reading in a month?
5. **`prioritiseAnnouncements()` then `loadAnnouncementDocuments()`** — the company's price-sensitive history is first reduced to 15 filings by collapsing each sequential series (offer-period extensions, Panel receipt notices, buy-back notifications) to its latest member, then **the single most recent unflagged background filing** (`isBackgroundFiling()`: annual and half-year reports, Appendix 4C/4D/4E and 5B, quarterlies, investor presentations) is added — the price-sensitive flag answers "did this move the stock", which is the wrong question for the accounts, and on the ASX the annual report that follows a flagged Appendix 4E usually carries no asterisk. The survivors are downloaded (concurrency 4) and text-extracted with `unpdf` against a **per-class** character budget — 90k for a substantive filing, 25k for a background filing read for its front matter, 14k for a legal instrument whose annexures carry nothing. One filing at 25k rather than three at 45k: the extra two reach back reporting periods the report doesn't use, and the extra 20k each buys the back half of an annual report. Unreadable filings are skipped, never fatal. Superseded filings are recorded in `sources.skipped` so the audit trail says what was *not* read. Measured effect: 236k tokens to 114k, and citations from 12-of-26 documents to 15-of-16.
6. **Volume profile and filing index** — one `fetchDailyBars` request for the chosen ticker gives ~60 sessions of daily volume, from which `fetchVolumeProfile` computes the session's turnover against a 30-session trailing average, today excluded. The ratio is the figure that carries information: a 15% move on 6x average volume is the market transacting on the news, the same move on ordinary turnover is a thin market re-pricing itself, and the two deserve different reports. Alongside it the prompt gets a **date-and-headline index** of every announcement already fetched for the shortlist — a few hundred tokens for the two things no single document holds: event sequence, and whether a name at the top has changed.
7. **`writeReport()`** — one streamed tool call returning both `ReportPage[]` and the `daily_movers` columns. The exchange feed overrides `movePct` if the model's figure disagrees by more than a point or flips sign. **The corpus is cached on the 5-minute TTL** (`buildEvidenceContent`), which reverses the earlier decision not to cache at all: that was right when the pipeline made one call per corpus, and wrong once the Accuracy Gate made it two or three within minutes. For a corpus of C tokens the run went from `1.0C + 1.0C + 1.0C = 3.00C` to `1.25C + 0.1C + 0.1C = 1.45C`. The hit requires a **byte-identical prefix**, and the cache keys on tools → system → messages in that order — so both calls send the same `DRAFT_TOOLS` (both tools, with `tool_choice` picking the job), the same `DAILY_MOVER_SYSTEM` (the writer's standard plus a section 14 for checking), and the same evidence blocks, with the breakpoint on a trailing `END OF EVIDENCE.` marker so the prefix boundary cannot drift. Measured on a probe: second call `cache_read_input_tokens = 18,913`, `input_tokens = 39`.
8. **`checkReport()` — the Accuracy Gate** — a second, non-streamed tool call given the finished report and the same corpus, asked only to find what is wrong. Nineteen finding categories, and the ones that matter most came out of a desk review rather than from theory: a total the writer summed from the company's figures and presented as the company's own (`figure`), a source line naming a filing that does not carry the page's figures (`sourcing`), a conditional payment written as unconditional (`conditionality`), proceeds written as received rather than expected on completion (`cash-timing`), and a pro-forma position written in the present tense — "has no current production" while the company still owned the mine (`status-timing`). Alongside them the older checks: an intraday move written as a close, conditional contract value presented as revenue, acquisition growth called organic, our reading written as a filing's fact (`attribution`), an economics figure the filings give and the page omits (`missing-number`), repetition, length and house style. The verdict is **derived from the findings**, not taken from the tool call — a model that has just logged three blocking findings will still sometimes return `pass`. A blocking finding triggers at most one rewrite, and only when `warrantsRewrite` says it is worth paying for — `HARD_FACT_CATEGORIES` is the list of failures a reviewer cannot correct for (the five above plus share-price wording, contract terms and compliance), or two or more blocking findings of any kind. A lone over-reaching sentence is flagged to the reviewer instead. When it does fire: `writeReport()` runs again with the first draft *and* the findings in the prompt, so the call is an edit rather than a fresh attempt. Deliberately **one** gate call, not two — re-checking after the rewrite would pay for the ~150k-token corpus a third time to confirm a fix the writer was told to make. The result is stored on `mover_drafts.accuracy` and rendered by `AccuracyPanel` above the report. A gate that throws is caught: the draft reaches review with a summary saying it was never verified, rather than costing the day's report. **Both stages are also budgeted against the 300s invocation ceiling** — `CHECK_DEADLINE_MS` (200s) and `REWRITE_DEADLINE_MS` (150s). Past the ceiling there is nothing: a killed invocation leaves a `generating` row and no report, which is worse than an unchecked draft. When time runs short the rewrite is dropped before the check, because the findings are useful to a human on their own and a rewrite without them is nothing; either skip is written into the stored summary so a reviewer is never shown a clean bill of health that was not issued.
9. **`renderReportPdf()`** — validates document structure (cover first, closing last, a risks page present, four to five pages, every chart carrying a conclusion, every timeline at least two events), then `@react-pdf/renderer` → `Buffer`, uploaded to `drafts/<TICKER>/<date>-daily-mover-<random>.pdf`.
10. **Terminal Write** — one `UPDATE` sets `status = 'pending'`, the mover columns, the report JSON, the accuracy review, the storage path and the four token counters.

Failures are caught in one place and written as `status = 'failed'` with the message on `error`, so no run ends silently.

### 7.9 `approveDraftAction(_prev, formData: FormData)`
1. **Authorization Gate**: `requireAdmin()`.
2. **State Guard**: Only `pending` or `rejected` drafts may be approved; an already-approved draft is refused.
3. **Reviewer Edits Win**: `movePct`, `catalystSlug`, `moveType`, `moveWindowLabel`, `reasonForMove` and `mainTakeaway` are taken from the submitted form, not the stored draft — the model drafts, the analyst is still the author.
4. **Entity Resolution**: Company resolved or created (identical logic to `/api/extract`), catalyst resolved by slug with a sort-order fallback.
5. **Storage Move**: `supabase.storage.move(draftPath, buildReportPath(...))` — the archive's own key scheme, so `/api/reports/[id]`, the ZIP export and the CLI script are unchanged.
6. **Projection**: `INSERT` into `daily_movers` with `extraction` carrying `{ source: "mover-studio", draftId, model, selection, sources, report }`.
7. **Draft Closure**: `status = 'approved'`, `approved_mover_id` set, `draft_storage_path` cleared, reviewer and timestamp recorded.
8. **Cache Invalidation**: `/daily-movers`, `/companies`, `/companies/[ticker]`, `/mover-studio`.

### 7.10 `rejectDraftAction(_prev, formData: FormData)`
1. `requireAdmin()`, then `status = 'rejected'` with `review_note`, `reviewed_by` and `reviewed_at`.
2. The PDF is deliberately **left** in the `drafts/` prefix: a rejection plus its reason plus the document that was rejected is the most useful evidence there is for improving the prompt.

### 7.11 `GET /api/cron/daily-mover` Route Handler
1. **Secret Gate**: Requires `Authorization: Bearer $CRON_SECRET`. An unset `CRON_SECRET` disables the route rather than leaving it open — it can spend the Claude budget.
2. **Timezone Gate**: `vercel.json` schedules both `30 1 * * 1-5` and `30 2 * * 1-5` UTC because Vercel cron has no timezone field and Sydney alternates between UTC+10 and UTC+11. The handler proceeds only if Sydney local time falls between 11:00 and 15:00. Both firings pass that window by design: the dedupe lives in the partial unique index, not the clock, so the first firing does the work and the second is a no-op. The window is deliberately wide because Hobby-plan cron precision is ±59 minutes — a ±40-minute window around 12:30 can be missed entirely. `?force=1` skips this check alone, for re-running a missed session.
3. **Reap**: `reapStaleGenerating()` clears `generating` rows older than 30 minutes, so a killed invocation cannot hold the day's unique index and block every later attempt.
4. **Day Guards** (`shouldRunScheduled`): declines if not a Sydney weekday, if a `daily_movers` row already exists for the date, or if a scheduled draft for the date already exists.
5. **Background Run**: `after(() => generateDraft({ trigger: "cron" }))`, with `maxDuration = 300` — the Hobby plan's ceiling and every plan's default, so it deploys on any plan. Anything above 300 fails the build on Hobby. A measured run is ~120s.

### 7.12 `generatePostAction(_prev, formData: FormData)` (`src/actions/posts.ts`)
1. **Authorization Gate**: `requireAdmin()`.
2. **Performance Guard**: Loads the mover with its anchor and current price via `getMoverForPost()`. A mover with no publication price or no live quote is refused with a message pointing at the price refresh, rather than generating copy around a null.
3. **Snapshot**: Freezes `{ anchorPrice, currentPrice, postEventReturn, priceAsOf, daysSince }` before the call, so the figures the model is given are exactly the figures stored beside its output.
4. **Assess then draft**: One `assessAndDraftPost()` call returns the verdict, the reason, the verbatim clause from the takeaway, and the variants. Variants are filtered against the verdict in the AI module, so only a `validated` call can produce copy.
5. **Persist**: One row in `linkedin_posts` with the judgement, the variants, the snapshot and the four token counters.
6. Runs **inline**, not via `after()` - unlike the drafting pipeline this is one small prompt taking seconds, so there is no progress worth polling and no state worth surviving a reload.

### 7.13 `setPostStatusAction(_prev, formData: FormData)`
1. `requireAdmin()`, then sets `status` to `draft` / `posted` / `discarded`.
2. `posted_at` is stamped on `posted` and **cleared** otherwise, so the timestamp can never outlive the claim that the post was published.

---

## 8. Frontend Component Architecture, Theming & State Management

```mermaid
graph TD
    subgraph Layout["(app)/layout.tsx"]
        Shell["AppShell (Responsive Sidebar / Header / Mobile Navigation)"]
        UserMenu["UserMenu (Role Badge, Admin Lock / Exit)"]
        Unlock["AdminUnlockDialog (Passcode Input Modal)"]
        Toggle["ThemeToggle (Light / Dark / System Dropdown)"]
    end

    subgraph DailyMoversPage["/daily-movers (Page Component)"]
        Summary["Summary Cards (Total Movers, Companies, Showing)"]
        Filter["FilterBar (Search, Date Bounds, Catalyst, Direction, Active Count)"]
        Table["MoversTable (Sortable Headers, Directional Move Chips, Documents Column)"]
        Dialog["MoverDialog (Add/Edit Modal with ReportUpload)"]
        DownloadZip["DownloadReportsButton (Admin-Only ZIP Exporter)"]
        Logo["CompanyLogo (High-Contrast Logo Tile & Monogram Fallback)"]
        Refresher["PriceRefresher (Post-Paint Price Top-Up)"]
        RefreshBtn["PriceRefreshButton (As-Of Stamp & Admin Force Refresh)"]
        RowActions["MoverRowActions (Edit / Delete / Download Triggers)"]
        Pager["Pagination (Previous, Next, Per-Page Selector)"]
    end

    Shell --> UserMenu
    Shell --> Unlock
    Shell --> Toggle
    Shell --> DailyMoversPage
    DailyMoversPage --> Summary
    DailyMoversPage --> Filter
    DailyMoversPage --> Table
    DailyMoversPage --> Dialog
    DailyMoversPage --> DownloadZip
    DailyMoversPage --> Pager
    Table --> Logo
    Table --> RowActions
    DailyMoversPage --> Refresher
    DailyMoversPage --> RefreshBtn
```

### 8.1 Component Specifications

| Component | Type | Responsibility |
| :--- | :--- | :--- |
| `ThemeProvider` | Client | Wraps application with `next-themes` provider supporting `attribute="class"`, `defaultTheme="dark"`, `enableSystem`. |
| `ThemeToggle` | Client | Interactive mode selector (Light / Midnight Dark / System) using `useSyncExternalStore` for hydration-safe rendering. |
| `AppShell` | Server | Renders institutional navigation sidebar, branding with live pulse indicator, mobile header, and main container. |
| `UserMenu` | Client | Renders user avatar circle, role status pill (Admin vs Viewer), and admin unlock/lock trigger (`lockAdmin()`). |
| `AdminUnlockDialog` | Client | Modal dialog allowing authorized editors to unlock write permissions with the secret admin passcode. |
| `CompanyLogo` | Client | High-contrast adaptive logo tile (`bg-slate-900 dark:bg-card`) with an image overlay faded in over a monogram base layer. Upstream resolution walks: Parqet Symbol → Yahoo Finance Profile URL → HTML `<link rel="icon">` scrape → Favicon CDNs. |
| `DownloadReportsButton` | Client | Admin-gated button that triggers `/api/reports/download-all`, displays loading spinner and progress toast notifications, and downloads the ZIP file directly. |
| `FilterBar` | Client | Binds search inputs, date pickers, catalyst dropdowns, and direction selectors to URL query parameters with active filter counts and reset. |
| `MoversTable` | Client | Renders tabular daily mover records with company logos, directional move chips, monospace ticker badges, the **performance block** (Report Price, Current Price, Post-Event Return), and the **Documents column**. |
| `PriceRefresher` | Client | Renders nothing; asks `/api/prices/refresh` for a top-up after paint and calls `router.refresh()` only if prices changed. |
| `PriceRefreshButton` | Client | "Prices as of ..." stamp for all viewers, with a force-refresh button and failing-ticker count for admins. |
| `ReportUpload` | Client | Direct browser-to-storage PDF upload component with drag & drop, file progress, and client validation. |
| `MoverDialog` | Client | Modal dialog handling research record creation and editing, integrating Claude AI Auto-Fill and `ReportUpload`. |
| `CompanyCombobox` | Client | Accessible searchable combobox with company logos for selecting companies by ticker and company name. |
| `MoverRowActions` | Client | Contextual dropdown menu for editing, deleting, and downloading research records. |
| `Pagination` | Client | Controls current page offset, page size selector (10, 25, 50, 100), and result count display. |

### 8.2 Design System, Typography & Color Tokens

- **Primary Font (`--font-sans`)**: **Plus Jakarta Sans** (weights 300 to 800) for clean geometric hierarchy.
- **Monospace Font (`--font-mono`)**: **JetBrains Mono** (weights 400 to 700) for stock tickers, dates, and percentage figures.
- **Dark Theme (Midnight Navy)**:
  - Background: `oklch(0.13 0.032 255)` (`#090e18`)
  - Card Surface: `oklch(0.17 0.035 255)` (`#101726`)
  - Luminous Border: `oklch(0.30 0.035 255 / 55%)`
  - Gains: `bg-emerald-500/10 text-emerald-400 border-emerald-500/25`
  - Declines: `bg-rose-500/10 text-rose-400 border-rose-500/25`
- **Light Theme (Crisp Institutional Slate)**:
  - Background: `oklch(0.985 0.008 245)` (`#f8fafc`)
  - Card Surface: `oklch(1 0 0)` (`#ffffff`)
  - Foreground: `oklch(0.145 0.035 260)` (`#0f172a`)

---

## 9. Error Handling & Diagnostics

### 9.1 Database Error Categorization (`src/lib/db-error.ts`)
Maps PostgreSQL driver error codes to actionable diagnostic messages (`28P01`, `ENOTFOUND`, `ETIMEDOUT`, `ECONNREFUSED`, `3D000`, `42P01`).

### 9.2 Credential Redaction Pattern
```typescript
export function redactCredentials(text: string): string {
  return text
    .replace(/(\b[a-z+]*:\/\/[^\s:/@]+:)[^\s@]*(@)/gi, "$1***$2")
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgres://***");
}
```
Ensures that no database passwords or connection secrets ever surface in client UI alerts, browser consoles, or Vercel serverless runtime logs.
