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
│   └── auth-setup.sql           # RLS, app_users table, admin_emails seed
├── scripts/                     # Operational automation scripts
│   ├── apply-sql.mts            # Idempotent statement-by-statement SQL runner
│   └── storage-setup.mts        # Private Supabase Storage bucket initialization
├── src/
│   ├── actions/                 # Next.js Server Actions (Mutations)
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
│   │   │   └── layout.tsx       # Auth protection barrier & shell wrapper
│   │   ├── api/                 # API route handlers
│   │   │   ├── logo/[ticker]/    # Server-resolved company logo proxy (cached)
│   │   │   │   └── route.ts
│   │   │   ├── prices/refresh/   # POST: stale top-up, or {force:true} for admins
│   │   │   │   └── route.ts
│   │   │   └── reports/[id]/    # Protected 60-second signed PDF redirect handler
│   │   │       └── route.ts
│   │   ├── auth/signout/        # POST sign-out route handler
│   │   │   └── route.ts
│   │   ├── login/               # Passwordless identification UI & actions
│   │   │   ├── actions.ts       # signIn Server Action
│   │   │   ├── login-form.tsx   # Client-side form with useActionState
│   │   │   └── page.tsx
│   │   ├── globals.css          # Tailwind CSS 4 theme, typography & OKLCH color tokens
│   │   ├── layout.tsx           # Root HTML layout with ThemeProvider and fonts
│   │   └── page.tsx             # Root redirect to /daily-movers
│   ├── components/              # UI Component Library
│   │   ├── daily-movers/        # Domain-specific components
│   │   │   ├── company-combobox.tsx
│   │   │   ├── filter-bar.tsx
│   │   │   ├── mover-dialog.tsx # Add/Edit modal with Claude AI Auto-Fill dropzone
│   │   │   ├── mover-row-actions.tsx
│   │   │   ├── movers-table.tsx # Table with directional chips, performance columns & Documents
│   │   │   ├── pagination.tsx
│   │   │   ├── price-refresh-button.tsx # "As of" stamp + admin force-refresh
│   │   │   ├── price-refresher.tsx # Post-paint stale-price top-up trigger
│   │   │   └── report-upload.tsx# Direct browser-to-storage PDF uploader
│   │   ├── ui/                  # shadcn/ui Base UI & Radix primitives
│   │   ├── app-shell.tsx        # Navigation sidebar, branding & mobile header
│   │   ├── db-not-configured.tsx# Fallback diagnostic alerts
│   │   ├── nav-link.tsx         # Active-state navigation anchor with icons
│   │   ├── theme-provider.tsx   # next-themes client wrapper
│   │   ├── theme-toggle.tsx     # Light / Dark / System theme switcher
│   │   └── user-menu.tsx        # User profile, role badge & sign-out trigger
│   ├── db/                      # Database connection & schema definitions
│   │   ├── index.ts             # Connection caching & pooler configuration
│   │   ├── schema.ts            # Drizzle ORM table & relation schemas
│   │   └── seed.ts              # Idempotent database seed script
│   ├── lib/                     # Utilities, helpers & business logic
│   │   ├── ai/                  # AI & LLM extraction modules
│   │   │   └── anthropic.ts     # Claude 3.5 Sonnet document tool extraction client
│   │   ├── auth-config.ts       # Domain & path matching (edge safe)
│   │   ├── auth.ts              # RBAC & session verification (server-only)
│   │   ├── db-error.ts          # Postgres error code parser & credential scrubbing
│   │   ├── format.ts            # Date, percentage & price formatters
│   │   ├── market/              # Market data (ASX prices)
│   │   │   ├── index.ts         # Provider selection — single swap point
│   │   │   ├── provider.ts      # MarketDataProvider contract & shared types
│   │   │   ├── refresh.ts       # Staleness rules, backfill & upserts (server-only)
│   │   │   └── yahoo.ts         # Yahoo Finance chart adapter ({TICKER}.AX)
│   │   ├── movers.ts            # Shared runtime types, return derivation & pagination constants
│   │   ├── queries.ts           # Drizzle SQL query builder (server-only)
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
    COMPANIES ||--o{ COMPANY_PRICES : "closes for"
    COMPANIES ||--o| COMPANY_QUOTES : "latest price of"
    ADMIN_EMAILS ||--o{ APP_USERS : "authorizes"

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
        mover_status status
        text report_url
        text report_storage_path
        text asx_announcement_url
        jsonb extraction
        text created_by
        timestamptz created_at
        timestamptz updated_at
    }

    COMPANY_PRICES {
        integer company_id PK
        date price_date PK
        numeric close
        text source
        timestamptz fetched_at
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
| `report_price` | `numeric(12,4)` | Nullable | Share price recorded at time of report publication. When null, post-event returns fall back to the `company_prices` close on `move_date`. |
| `status` | `mover_status` enum | NOT NULL, Default `new` (`new` \| `reviewed` \| `follow_up`) | **Vestigial.** The Status column was removed from the UI; the column is retained so reversing that needs no destructive migration. Nothing reads or writes it. |
| `report_url` | `text` | Nullable | External link to research PDF/document. |
| `report_storage_path`| `text` | Nullable | Relative object key in private `reports` bucket. |
| `asx_announcement_url`| `text` | Nullable | **Vestigial.** The ASX announcement link was removed from the UI, the Add/Edit form and the PDF extraction; the column is retained so reversing that needs no destructive migration. It was null on every row at removal. |
| `extraction` | `jsonb` | Nullable | Verbatim raw LLM/OCR structured JSON output. |
| `created_by` | `text` | Nullable | Email address of the creator. |
| `created_at` | `timestamptz` | NOT NULL, Default `now()` | Record creation timestamp. |
| `updated_at` | `timestamptz` | NOT NULL, Default `now()` | Last modification timestamp. |

#### 5. `company_prices`
Daily closes, read for the anchor price when a mover has no `report_price`. Raw (unadjusted) closes, so they stay comparable with a hand-entered `report_price` and with the live quote.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `company_id` | `integer` | Composite PK, FK -> `companies(id)` (`ON DELETE CASCADE`) | Company the close belongs to. |
| `price_date` | `date` | Composite PK | ASX-local trading date. Composite key makes a re-fetch idempotent. |
| `close` | `numeric(12,4)` | NOT NULL | Closing price (provisional for the current session). |
| `source` | `text` | NOT NULL | Provider that supplied it (`yahoo`). |
| `fetched_at` | `timestamptz` | NOT NULL, Default `now()` | When this row was last written. |

Index: `company_prices_company_date_idx` on (`company_id`, `price_date` DESC) — window lookups read backwards from a date.

#### 6. `company_quotes`
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
| Provider contract | `src/lib/market/provider.ts` | `MarketDataProvider` (`fetchQuotes` + `fetchCloses`), `DailyClose`, `Quote`, `UnknownSymbolError`. Nothing above this layer sees a provider's response format. Split in two because current prices are wanted for every company on a schedule and batch cheaply, while closes are only needed for the few companies missing history. |
| Yahoo adapter | `src/lib/market/yahoo.ts` | Built on the `yahoo-finance2` package, which owns the cookie/crumb handshake `quote()` requires, response validation and retries. `fetchQuotes` batches up to 40 symbols per request; tickers the quote endpoint skips (suspended listings such as `OPT.AX`) fall back to the price in a chart response's metadata. Bars are dated by shifting the bar's opening instant by the exchange's `gmtoffset` -- a no-op under AEST, but required under daylight saving, where 10:00 local is 23:00 UTC the previous day. |
| Provider selection | `src/lib/market/index.ts` | Single-line swap point for a licensed feed. |
| Refresh service | `src/lib/market/refresh.ts` | Two phases. **Quotes**: every due company in one batched request, then a single multi-row upsert (`excluded.*`) rather than one round trip each -- the database is in Tokyo, and sequential upserts dominated the runtime. **Closes**: only for companies actually missing history, capped at 20 per run with 4 concurrent requests (both lifted when forced). Staleness is a 30 min TTL with a 6 h backoff after a failure; concurrent callers are coalesced by an in-flight promise keyed on mode. |
| Trigger route | `src/app/api/prices/refresh/route.ts` | `POST`. Unauthenticated for the automatic stale-only sweep (self-limiting via TTL + ceiling); `{ force: true }` requires `canWrite`, since one forced click is a request per covered company. Returns `{ due, refreshed, failed }`. |
| Client trigger | `src/components/daily-movers/price-refresher.tsx` | Fires after paint, calls `router.refresh()` only when something changed. |
| Manual control | `src/components/daily-movers/price-refresh-button.tsx` | Shows "Prices as of ..." (from `getPriceFreshness()`) to everyone, plus a force-refresh button for admins. Forced runs ignore the TTL and the per-run ceiling. |
| Derivation | `src/lib/queries.ts`, `src/lib/movers.ts` | SQL returns the anchor and current prices; `pctChange` turns them into the return. |

Semantics:

- **Anchor** = `report_price`, else the last close on or before `move_date`. `<=` rather than `=` because a move date can land on a day with no close of its own. An inferred anchor is marked in the UI with a dotted underline.
- **Post-Event Return** = anchor → current price. Null when either side is unknown, rendered as `—` with the reason on hover rather than as a misleading 0.0%.
- Fixed-window returns (1W / 1M) were removed as unnecessary; `company_prices` is still required, since the anchor fallback reads the close on the move date.

Refresh is pull-based with no cron: a page load asks, and the service decides whether anything is due. A run that hits its ceiling is resumed by the next request, since staleness is re-evaluated each time. Adding an older mover for an already-tracked company automatically triggers a history backfill on the next refresh.

**History is considered complete once a close exists at or before the earliest move date** -- which is exactly what the anchor lookup needs -- not once it reaches the requested `move_date - 10 days`. The lead days widen the *request* so a move date after a long weekend still has a preceding close, but the first trading day Yahoo returns is usually a day or two later, so comparing against the requested date never matched: 16 companies re-fetched and re-upserted their entire history on every refresh (~700 wasted row writes each time, measured at 511 in one sweep). With the correct check a steady-state refresh writes 47 quote rows in one statement and ~0 price rows.

The one remaining exception is a ticker whose history Yahoo cannot cover back to its move date at all (`OPT`, suspended since July): its anchor can never be satisfied, so it re-fetches ~23 bars per refresh. Bounding that properly needs a stored "history requested from" marker; it is left as a known, measured cost rather than hidden.

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
3. Invokes `extractMoverFromPdfBuffer()` using Anthropic Claude 3.5 Sonnet with tool calling (`save_daily_mover_research`).
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
        Logo["CompanyLogo (Proxy-Resolved Logo & Monogram Fallback)"]
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
| `UserMenu` | Client | Renders user avatar circle, role status pill (Admin vs Viewer), and admin lock/exit trigger. |
| `AdminUnlockDialog` | Client | Modal dialog allowing authorized editors to unlock write permissions with the secret admin passcode. |
| `CompanyLogo` | Client | Monogram base layer with a branded logo faded in over it, resolved through the `/api/logo/[ticker]` proxy (ticker-keyed upstream first, name-derived domain favicons as fallback). |
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
