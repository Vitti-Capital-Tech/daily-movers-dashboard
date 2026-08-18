# High-Level Design (HLD) — Daily Movers Dashboard

## 1. Executive Summary & Purpose

The **Daily Movers Dashboard** is an internal research knowledge management platform built for **Vitti Capital**. Its primary objective is to serve as a searchable, structured, and permanent archive of Daily Mover equity research reports on ASX-listed companies.

When investment analysts and portfolio managers review a company that experiences significant price movements, they can immediately retrieve historical research, previous catalyst analyses, and past investment takeaways to understand: *"What did we say last time?"*

---

## 2. Business Context & Problem Statement

### 2.1 The Problem
Historically, equity research reports and daily mover summaries were stored in unstructured formats (PDF files, email threads, chat channels). This caused:
- **Information Fragmentation**: Difficulty searching past commentary across different reporting periods.
- **Entity Disconnect**: Variations in ticker naming (e.g., `JBH` vs `JBH.AX`) splitting research history.
- **Inconsistent Categorisation**: Unstandardized catalyst classification (e.g., "Earnings Result" vs "FY26 Results").
- **Loss of Nuance**: Discrepancies between headline percentage moves, intraday peaks, and final closing figures.
- **File Distribution Risk**: Unrestricted public URLs or large attachments failing serverless payload limits.

### 2.2 The Solution
A unified, web-based intelligence archive featuring:
1. **Normalized Relational Data Model**: Strict entity binding via foreign keys to unique company records.
2. **Standardized Lookups**: Controlled vocabularies for catalysts and analysts.
3. **Derived Metrics**: Deterministic derivation of price movement direction from signed percentage values.
4. **URL-Synchronized Server-Side Filtering**: Performant, deep-linkable search, catalyst filtering, date-range filtering, and pagination handled entirely at the database layer.
5. **Direct-to-Storage PDF Management**: Direct browser-to-storage signed uploads bypassing serverless payload limits, coupled with short-lived (60s) signed download URLs.
6. **Role-Gated Research Operations**: Distinction between research consumers (Viewers) and research authors (Admins).
7. **Institutional Terminal Aesthetics**: Purpose-built financial UI featuring Light / Midnight Navy Dark theme toggle, Plus Jakarta Sans & JetBrains Mono typography, and high-density directional metrics.

---

## 3. High-Level System Architecture

The application adopts a **Modern Server-First Architecture** utilizing Next.js App Router, React Server Components (RSC), Drizzle ORM, Supabase Postgres, and Supabase Private Storage.

```mermaid
graph TD
    subgraph Client["Client Tier (Browser)"]
        UI["Web UI (React 19 / Tailwind 4 / shadcn / next-themes)"]
        Cookie["Session Cookie (vitti_session HMAC-SHA256)"]
        Theme["Theme State (Light / Midnight Dark / System)"]
        Uploader["Direct S3-Compatible Upload Client"]
    end

    subgraph Edge["Edge Infrastructure"]
        MW["Next.js Edge Middleware (Auth & Domain Gating)"]
    end

    subgraph Server["Application Server Tier (Next.js App Router / Vercel Serverless)"]
        RSC["React Server Components (Layouts, Pages)"]
        SA["Server Actions (saveMover, deleteMover, createReportUploadUrl, signIn)"]
        PDFRoute["Protected PDF Route (/api/reports/[id])"]
        AuthLayer["Auth & Session Verification (Web Crypto)"]
        QueryLayer["Data Access Layer (lib/queries.ts - server-only)"]
    end

    subgraph Database["Data Tier (Supabase / AWS Tokyo)"]
        Pooler["Supabase Transaction Pooler (Port 6543)"]
        Postgres["PostgreSQL Database (RLS Enforced, Zero Public Policies)"]
        Storage["Private Storage Bucket ('reports' - 25MB limit)"]
    end

    UI -->|HTTP Requests| MW
    MW -->|Authorized Session| RSC
    MW -->|Redirect / Login| UI
    RSC --> QueryLayer
    SA --> AuthLayer
    SA --> QueryLayer
    QueryLayer -->|postgres.js driver| Pooler
    Pooler --> Postgres

    %% Upload and Download flows
    UI -->|1. Request Upload Ticket| SA
    SA -->|Generate Signed Upload URL| Storage
    Uploader -->|2. Direct PUT PDF| Storage
    UI -->|3. Request Document| PDFRoute
    PDFRoute -->|Verify Session & Mint Signed URL| Storage
```

---

## 4. Technology Stack & Component Justifications

| Tier / Function | Technology | Justification & Architectural Role |
| :--- | :--- | :--- |
| **Application Framework** | **Next.js 16 (App Router)** | Hybrid SSR/RSC rendering model, zero-client-bundle data fetching, native streaming, Server Actions for mutations. |
| **Language** | **TypeScript 5** | Strict end-to-end type safety spanning database schemas, Zod validation schemas, and UI components. |
| **Styling & Design System** | **Tailwind CSS 4 + shadcn/ui** | Design-token-driven styling, accessible Base UI/Radix primitives, Lucide React icons. |
| **Theming System** | **next-themes** | Client-side Light / Midnight Navy Dark / System theme switching with hydration safety and local storage persistence. |
| **Typography** | **Plus Jakarta Sans + JetBrains Mono** | High-legibility geometric UI typography paired with developer/financial-grade monospace figures for tickers and percentage metrics. |
| **AI Extraction Engine** | **Anthropic Claude 3.5 Sonnet** | Native multimodal document parser extracting structured equity research metadata from raw PDF bytes. |
| **Database** | **PostgreSQL (Supabase)** | Relational integrity (FK constraints), JSONB support for raw extractions, performant B-Tree indexes, transaction pooling. |
| **Object-Relational Mapping (ORM)** | **Drizzle ORM + postgres.js** | Type-safe SQL builder with minimal runtime overhead, explicit query composition, seamless migration tooling. |
| **Object Storage** | **Supabase Private Storage (`reports`)** | Encrypted, private bucket storage for Daily Mover PDF reports with server-signed upload and download tokens. |
| **Data Validation** | **Zod** | Runtime contract enforcement for form submissions, Server Action payloads, and query parameter parsing. |
| **Session Security** | **Web Crypto API (HMAC-SHA256)** | Runtime-agnostic cryptographic signing compatible with both Edge Middleware and Node.js Serverless runtimes. |
| **Hosting & Compute** | **Vercel Serverless (Tokyo - `hnd1`)** | Co-located with Supabase Tokyo DB (`ap-northeast-1`) to minimize database query latency. |

---

## 5. Core Architectural Decisions & Principles

### 5.1 Relational Integrity via `company_id` Foreign Keys
- **Decision**: Daily mover records link strictly to the `companies.id` primary key rather than raw ticker strings.
- **Rationale**: ASX tickers can have exchange extensions (`.AX`), class shares, or rebranding. An immutable integer foreign key guarantees that all research history for a company aggregates into a single timeline.

### 5.2 Deterministic Direction Derivation
- **Decision**: Direction (`up` / `down`, `↑` / `↓`, "Up" / "Down") is never stored as an independent column in the database; it is computed deterministically from `move_pct`.
- **Rationale**: Prevents data corruption where an explicit string field could contradict the numeric move percentage. Validation strictly forbids `0%` moves (as non-movers).

### 5.3 Automated PDF Extraction & Entity Auto-Resolution
- **Decision**: Analysts can drop a Daily Mover PDF to trigger `extractReportAction()`. Claude 3.5 Sonnet parses the document and extracts structured attributes. The server action automatically resolves or creates missing company entities and links catalyst/analyst foreign keys before pre-populating the UI form.
- **Rationale**: Eliminates manual data entry while preserving human oversight, guaranteeing that research notes, catalysts, and signed percentage moves are captured accurately in seconds.

### 5.4 Direct-to-Storage PDF Upload Pipeline
- **Decision**: PDF files upload directly from the browser to Supabase Storage via signed upload tickets minted by `createReportUploadUrl()`, rather than streaming through Next.js Server Actions.
- **Rationale**: Vercel caps request bodies at 4.5 MB and Next.js caps Server Action bodies at 1 MB by default. Routine 5–20 MB research reports would fail in serverless production. Direct upload avoids serverless execution limits and prevents memory exhaustion.

### 5.5 Time-Limited Private PDF Delivery (`/api/reports/[id]`)
- **Decision**: The `reports` storage bucket is strictly private (zero public access). All downloads route through `/api/reports/[id]`, which authenticates the user session and issues a **60-second signed download URL**.
- **Rationale**: Ensures report storage keys cannot be accessed anonymously and links shared outside authorized sessions expire immediately.

### 5.5 Server-Side SQL Filtering & URL State
- **Decision**: Full-text search, catalyst filtering, direction filtering, date ranges, and sorting execute directly in PostgreSQL queries. Filter state resides entirely in the URL query string (`?q=&catalyst=&from=&to=&sort=&dir=`).
- **Rationale**: Guarantees sub-millisecond query execution and deep-linkable shareability.

### 5.6 Standardized Institutional Theme Architecture
- **Decision**: Implementation of a dual theme system:
  - **Dark Mode**: Rich **Midnight Navy Blue** (`oklch(0.13 0.032 255)`) palette with subtle luminous borders and glowing green/red directional indicators.
  - **Light Mode**: Crisp slate-tinted canvas (`oklch(0.985 0.008 245)`) with high-contrast surfaces.
- **Rationale**: Enhances readability during extended research sessions and caters to diverse analyst workspace environments.

---

## 6. Authentication & Security Architecture

### 6.1 Authentication Mechanism (Domain Allowlist Identification)
- **Model**: Frictionless corporate email identification restricted to `@vitti.capital`.
- **Session Tokens**: Stateless, tamper-proof cookie (`vitti_session`) containing `{ email, expiry }` signed with an HMAC-SHA256 secret (`AUTH_SECRET`).
- **Cryptographic Standard**: Web Crypto API standard primitives (`crypto.subtle`) ensuring cross-runtime compatibility between Edge Middleware and Node Serverless.

### 6.2 Multi-Layered Authorization & Enforcement (Defense-in-Depth)

```mermaid
sequenceDiagram
    autonumber
    actor User as User Browser
    participant MW as Edge Middleware
    participant Layout as (app)/layout.tsx
    participant Action as Server Action (saveMover)
    participant Storage as Supabase Storage
    participant DB as Postgres (Drizzle)

    User->>MW: HTTP GET /daily-movers (Cookie: vitti_session)
    MW->>MW: Verify HMAC signature & domain (@vitti.capital)
    alt Invalid or Missing Cookie
        MW-->>User: 302 Redirect to /login
    else Valid Cookie
        MW->>Layout: Forward Request
        Layout->>DB: Query admin_emails to resolve Role (admin/viewer)
        Layout-->>User: Render Shell & Table (Hide admin buttons if viewer)
    end

    User->>Action: POST /actions/movers (saveMover)
    Action->>Action: assertCanWrite() -> requireAdmin()
    Action->>DB: Check admin_emails table
    alt Role is viewer
        Action-->>User: Reject with NotAuthorisedError
    else Role is admin
        Action->>DB: Execute INSERT / UPDATE
        Action-->>User: Return Success & Revalidate Cache
    end
```

| Layer | Enforcement Mechanism | Purpose |
| :--- | :--- | :--- |
| **Layer 1: Edge Middleware** | HMAC token verification + `@vitti.capital` domain check | Blocks unauthorized traffic at edge; redirects to `/login`. |
| **Layer 2: Server Layout** | Server-side `getSessionUser()` verification | Redundant fail-safe preventing data leaks if middleware is misconfigured. |
| **Layer 3: Mutation Chokepoint** | `assertCanWrite()` / `requireAdmin()` in Server Actions | Cryptographic and database-backed verification that caller is in `admin_emails`. |
| **Layer 4: Storage Security** | Private Supabase bucket + 60s signed URLs | Prevents unauthenticated access to uploaded research PDFs. |
| **Layer 5: Database Layer (RLS)** | Row-Level Security enabled on all tables with **zero public policies** | Complete lockdown against public Supabase anon key requests. Drizzle connects as table owner to bypass RLS safely. |

---

## 7. Deployment & Infrastructure Architecture

```mermaid
graph LR
    subgraph Vercel["Vercel Cloud Platform (Tokyo - hnd1)"]
        NextEdge["Edge Middleware"]
        NextServerless["Serverless Function Runtime (max connections = 1)"]
    end

    subgraph Supabase["Supabase Cloud (AWS ap-northeast-1)"]
        SupabasePooler["PgBouncer / Supavisor Transaction Pooler (Port 6543)"]
        PostgresInstance["PostgreSQL 15+ Engine"]
        StorageEngine["Supabase Storage Service ('reports' bucket)"]
    end

    NextEdge --> NextServerless
    NextServerless -->|Transaction Mode| SupabasePooler
    SupabasePooler --> PostgresInstance
    NextServerless -->|Admin Service Role Signing| StorageEngine
```

### 7.1 Serverless Connection Management & Environment Variables
- **Local Dev vs Serverless**: `src/db/index.ts` dynamically configures connection pooling:
  - **Local Development**: Connection pool size of `10` to facilitate rapid parallel queries.
  - **Production Serverless (`process.env.VERCEL`)**: Connection pool pinned to `1` per lambda to prevent connection exhaustion against Supabase pooler.
- **Environment Variables**:
  - `DATABASE_URL`: Pooler URI (port 6543, username `postgres.<ref>`).
  - `AUTH_SECRET`: 32-byte cryptographic hex string.
  - `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL for direct client storage PUT.
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key for client upload authentication.
  - `SUPABASE_SERVICE_ROLE_KEY`: Server-only key used exclusively to mint signed upload/download tokens.

---

## 8. Current Feature Set & Capabilities

1. **Daily Movers Table View (`/daily-movers`)**:
   - Paginated, sortable, and multi-filter table displaying research dates, tickers, company names, catalysts, price movements, move types, and covering analysts.
   - Financial directional move chips (`ArrowUpRight` / `ArrowDownRight`) with emerald gain and rose decline tints.
   - **Documents Column**: Clickable `Report` and `ASX` action buttons per row, with greyed-out visual states when unattached.
   - Summary KPI cards showing total published research, covered companies, and filtered counts with micro-gradients and icons.
   - Interactive dialog for creating and editing research entries (admins only).
2. **Report PDF Upload & Direct Delivery**:
   - Drag & drop PDF uploader with progress tracking and direct browser-to-storage upload.
   - Protected download endpoint (`/api/reports/[id]`) with 60-second signed URLs.
3. **Company Research Directory (`/companies`)**:
   - Comprehensive directory of all covered listed entities with sector tags, mover counts, and latest coverage timestamps.
4. **Company Historical Deep-Dive (`/companies/[ticker]`)**:
   - "Most Recent Investment Takeaway" hero card with highlight banner and quote icon.
   - Vertical research history timeline connecting chronological notes with directional status nodes.
   - Action links to Daily Mover source reports and official ASX announcements.
5. **Theme Customization (`ThemeToggle`)**:
   - Seamless switching between Light mode, Midnight Navy Dark mode, and System preference.
6. **Authentication & Session Management (`/login`, `/auth/signout`)**:
   - Single-step email authentication with secure session cookie distribution and audit trail logging in `app_users`.

---

## 9. Future Roadmap & Extensibility

- **Automated LLM Extraction Pipeline**: Background workers parsing uploaded PDFs from Supabase Storage, running structured prompts, and populating `extraction` JSONB for automated diffing.
- **UI Company Management**: Interface for adding and updating company ticker and sector metadata without database seeding.
- **Admin Management Portal**: UI for granting/revoking write permissions in `admin_emails`.
- **Magic Link / MFA Verification**: Transition from domain allowlist identification to cryptographic email verification for public internet exposure.
