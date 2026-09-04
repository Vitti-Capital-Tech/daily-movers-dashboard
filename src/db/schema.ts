import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Whether the quoted share-price move is an intra-session figure or the
 * official close. "Morning trade" reports map to `intraday`; the verbatim
 * wording from the PDF is preserved in `daily_movers.move_window_label`.
 */
export const moveTypeEnum = pgEnum("move_type", ["intraday", "closing"]);

export const userRoleEnum = pgEnum("user_role", ["admin", "viewer"]);

/**
 * Lifecycle of an AI-generated Daily Mover draft.
 *
 * `generating` exists because the pipeline reads 20-30 announcement PDFs and
 * makes several Claude calls -- far longer than a request should hold open. The
 * row is inserted first and advanced in place, so a reload during generation
 * shows progress rather than losing the run.
 */
export const draftStatusEnum = pgEnum("draft_status", [
  "generating",
  "pending",
  "approved",
  "rejected",
  "failed",
]);

/**
 * Write-access allowlist, keyed by email. A table rather than a hardcoded list
 * in the trigger so granting write access is one INSERT, with no code change
 * or deploy.
 */
export const adminEmails = pgTable("admin_emails", {
  email: text("email").primaryKey(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

/**
 * One row per person who has signed in. Audit only — role is NOT stored here,
 * it's derived from `admin_emails` membership at request time, so revoking
 * access takes effect on the next request with nothing to keep in sync.
 */
export const appUsers = pgTable("app_users", {
  email: text("email").primaryKey(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

/**
 * One row per listed company. Daily movers reference this by id, never by
 * ticker string -- that FK is what makes research history reliable. If we
 * matched on text, "JBH" and "JBH.AX" would silently split one company's
 * history into two.
 */
export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    ticker: text("ticker").notNull(),
    name: text("name").notNull(),
    sector: text("sector"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // No index on `name`: the only query against it is `ILIKE '%term%'`, which a
    // btree cannot serve, and pg_stat confirmed zero scans. A trigram GIN index
    // would work if the company count ever reaches the thousands.
    uniqueIndex("companies_ticker_key").on(t.ticker),
  ],
).enableRLS();

/**
 * Closed list of catalyst types. A lookup table rather than free text so the
 * catalyst filter has a fixed set of options -- free text would give us
 * "Earnings Result", "Earnings result" and "FY26 Results" as three choices.
 */
export const catalysts = pgTable(
  "catalysts",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("catalysts_slug_key").on(t.slug)],
).enableRLS();

export const analysts = pgTable(
  "analysts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("analysts_name_key").on(t.name)],
).enableRLS();

export const dailyMovers = pgTable(
  "daily_movers",
  {
    id: serial("id").primaryKey(),

    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    catalystId: integer("catalyst_id")
      .notNull()
      .references(() => catalysts.id, { onDelete: "restrict" }),
    analystId: integer("analyst_id").references(() => analysts.id, {
      onDelete: "set null",
    }),

    /** Date of the share-price move (and of the report). */
    moveDate: date("move_date").notNull(),

    /**
     * Signed percentage move: -11.5 for a fall, +20.6 for a rise.
     * Direction and Up/Down are DERIVED from this sign, never stored --
     * storing them separately lets them contradict the number.
     *
     * Note: the source PDFs print the magnitude only ("~11.5%"), with the
     * direction in the prose ("Shares Fall as Much as..."), so the sign has
     * to come from the headline, not the figure.
     */
    movePct: numeric("move_pct", {
      precision: 6,
      scale: 2,
      mode: "number",
    }).notNull(),

    moveType: moveTypeEnum("move_type").notNull(),

    /**
     * Verbatim window wording from the report's hero card, e.g. "Intraday",
     * "Morning Trade". Kept so mapping "morning trade" onto `intraday`
     * doesn't lose what the report actually said.
     */
    moveWindowLabel: text("move_window_label"),

    reasonForMove: text("reason_for_move").notNull(),
    mainTakeaway: text("main_takeaway").notNull(),

    /**
     * Not present in the source PDFs -- manual entry, hence nullable. When it is
     * null the post-event return falls back to `moveDateClose` below.
     */
    reportPrice: numeric("report_price", {
      precision: 12,
      scale: 4,
      mode: "number",
    }),

    /**
     * ASX close on (or last before) `move_date` -- the fallback anchor for the
     * post-event return when no report price was entered.
     *
     * Resolved once, from market data, and then never touched: a past close does
     * not change. Stored on the mover rather than as a price series because this
     * is the only historical price the app reads, and one value per mover is 39
     * numbers where a daily series was ~2,000 rows. It is deliberately NOT the
     * same thing as a cached quote -- `company_quotes` holds the live price, at
     * one row per company; this is per mover *date*, and one company can have
     * several movers needing different closes.
     */
    moveDateClose: numeric("move_date_close", {
      precision: 12,
      scale: 4,
      mode: "number",
    }),


    /** Public/external link to the Daily Mover report, if one exists. */
    reportUrl: text("report_url"),
    /** Path within the storage bucket for an uploaded PDF. */
    reportStoragePath: text("report_storage_path"),


    /**
     * Raw structured output from PDF extraction, kept verbatim alongside the
     * saved row. Lets us re-run an improved extraction prompt over the
     * archive later and diff it against what was actually saved.
     */
    extraction: jsonb("extraction"),

    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Research history: where company_id = ? order by move_date desc
    index("daily_movers_company_date_idx").on(t.companyId, t.moveDate.desc()),
    // Default table view: newest first
    index("daily_movers_date_idx").on(t.moveDate.desc()),
    index("daily_movers_catalyst_idx").on(t.catalystId),
  ],
).enableRLS();

/**
 * Latest known price per company -- one row, overwritten in place, because only
 * the current value is ever displayed.
 *
 * Separate from `companies` so volatile data doesn't churn the reference table,
 * and it carries the refresh bookkeeping: `attempted_at` advances even when a
 * fetch fails, which is what stops a delisted or misspelled ticker from being
 * retried on every single page load.
 */
export const companyQuotes = pgTable("company_quotes", {
  companyId: integer("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),

  price: numeric("price", { precision: 12, scale: 4, mode: "number" }),
  currency: text("currency"),

  /** The provider's timestamp for `price`, not when we asked for it. */
  asOf: timestamp("as_of", { withTimezone: true }),
  source: text("source"),

  /** Last refresh that actually returned a price. */
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  /** Last attempt, successful or not. Staleness is measured from this. */
  attemptedAt: timestamp("attempted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Why the last attempt failed; null after a success. */
  error: text("error"),
}).enableRLS();

/**
 * An AI-generated Daily Mover awaiting an analyst's approval.
 *
 * Deliberately a separate table rather than a `status` column on
 * `daily_movers`: every row in that table is approved research, which is what
 * makes "what did we say last time?" answerable. A status column would put an
 * unreviewed draft one forgotten `WHERE` clause away from being quoted back as
 * Vitti's published view.
 *
 * On approval the row is projected into `daily_movers` and the PDF is moved from
 * the `drafts/` prefix to the same storage key scheme a manual upload uses, so
 * nothing downstream needs to know a report was drafted rather than written.
 */
export const moverDrafts = pgTable(
  "mover_drafts",
  {
    id: serial("id").primaryKey(),

    status: draftStatusEnum("status").notNull().default("generating"),

    /**
     * Trading day the draft covers, in the exchange's timezone. Not
     * `created_at::date` -- a run started at 02:30 UTC is the same ASX session
     * as one started at 23:00 UTC the day before.
     */
    moveDate: date("move_date").notNull(),

    /** "cron" or "manual" -- which is worth knowing when a draft looks odd. */
    trigger: text("trigger").notNull().default("manual"),

    /**
     * The ticker Claude picked. Text rather than an FK because the pick happens
     * before any company row is resolved, and a draft for a company we have
     * never covered must not create a `companies` row until it is approved --
     * otherwise every rejected draft leaves a stub behind in the directory.
     */
    ticker: text("ticker"),
    companyName: text("company_name"),
    sector: text("sector"),

    /** Resolved on approval only; null for pending and rejected drafts. */
    companyId: integer("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),

    /** Signed, like `daily_movers.move_pct`. Direction is derived from it. */
    movePct: numeric("move_pct", {
      precision: 6,
      scale: 2,
      mode: "number",
    }),
    moveType: moveTypeEnum("move_type"),
    moveWindowLabel: text("move_window_label"),

    /** Slug, not an id -- resolved against `catalysts` when approved. */
    catalystSlug: text("catalyst_slug"),
    reasonForMove: text("reason_for_move"),
    mainTakeaway: text("main_takeaway"),
    reportPrice: numeric("report_price", {
      precision: 12,
      scale: 4,
      mode: "number",
    }),
    analystId: integer("analyst_id").references(() => analysts.id, {
      onDelete: "set null",
    }),

    /**
     * The screen that produced the shortlist: both boards as fetched and the
     * liquidity filters applied. Kept because "why did it pick this?" is
     * unanswerable a week later without the list it chose from.
     */
    screen: jsonb("screen"),

    /** Claude's pick, its reasoning, and the runners-up it passed over. */
    selection: jsonb("selection"),

    /**
     * Every announcement read, with its ASX `idsId` and source URL. This is the
     * audit trail: an analyst reviewing a claim in the draft needs to reach the
     * announcement it came from.
     */
    sources: jsonb("sources"),

    /** The typed page blocks the PDF was rendered from. See `lib/report/types`. */
    report: jsonb("report"),

    /** Key under the `drafts/` prefix, until approval moves it. */
    draftStoragePath: text("draft_storage_path"),

    /**
     * Cost and provenance audit -- which model wrote this, and what it cost.
     *
     * Input is split three ways because the three are billed at different
     * rates, and this pipeline puts most of its input through the prompt cache:
     * the announcement corpus is the large, stable part of the prompt, so a
     * re-draft reads it back at a tenth of the price. Storing only
     * `input_tokens` reported a 153k-token corpus as 3k tokens.
     */
    model: text("model"),
    inputTokens: integer("input_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    outputTokens: integer("output_tokens"),

    /** Current pipeline stage, for the polling UI. Null once terminal. */
    progress: text("progress"),
    /** Why generation failed; null unless status is `failed`. */
    error: text("error"),

    /** Set when approved -- the `daily_movers` row this became. */
    approvedMoverId: integer("approved_mover_id").references(
      () => dailyMovers.id,
      { onDelete: "set null" },
    ),

    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Why an analyst rejected it -- the feedback loop for the prompt. */
    reviewNote: text("review_note"),
  },
  (t) => [
    // The review queue: newest first, usually filtered to `pending`.
    index("mover_drafts_status_created_idx").on(t.status, t.createdAt.desc()),
    /**
     * One scheduled draft per trading day. This is the cron's idempotency
     * guard: a retried or double-fired invocation hits this constraint instead
     * of spending a second run's worth of Claude calls. Manual drafts are
     * excluded so an analyst can re-draft a day as often as they like.
     */
    uniqueIndex("mover_drafts_cron_day_key")
      .on(t.moveDate)
      .where(sql`${t.trigger} = 'cron'`),
  ],
).enableRLS();

export const companiesRelations = relations(companies, ({ many, one }) => ({
  dailyMovers: many(dailyMovers),
  quote: one(companyQuotes, {
    fields: [companies.id],
    references: [companyQuotes.companyId],
  }),
}));

export const companyQuotesRelations = relations(companyQuotes, ({ one }) => ({
  company: one(companies, {
    fields: [companyQuotes.companyId],
    references: [companies.id],
  }),
}));

export const catalystsRelations = relations(catalysts, ({ many }) => ({
  dailyMovers: many(dailyMovers),
}));

export const analystsRelations = relations(analysts, ({ many }) => ({
  dailyMovers: many(dailyMovers),
}));

export const dailyMoversRelations = relations(dailyMovers, ({ one }) => ({
  company: one(companies, {
    fields: [dailyMovers.companyId],
    references: [companies.id],
  }),
  catalyst: one(catalysts, {
    fields: [dailyMovers.catalystId],
    references: [catalysts.id],
  }),
  analyst: one(analysts, {
    fields: [dailyMovers.analystId],
    references: [analysts.id],
  }),
}));

export const moverDraftsRelations = relations(moverDrafts, ({ one }) => ({
  company: one(companies, {
    fields: [moverDrafts.companyId],
    references: [companies.id],
  }),
  analyst: one(analysts, {
    fields: [moverDrafts.analystId],
    references: [analysts.id],
  }),
  approvedMover: one(dailyMovers, {
    fields: [moverDrafts.approvedMoverId],
    references: [dailyMovers.id],
  }),
}));

export type Company = typeof companies.$inferSelect;
export type Catalyst = typeof catalysts.$inferSelect;
export type Analyst = typeof analysts.$inferSelect;
export type DailyMover = typeof dailyMovers.$inferSelect;
export type NewDailyMover = typeof dailyMovers.$inferInsert;
export type MoveType = (typeof moveTypeEnum.enumValues)[number];
export type MoverDraft = typeof moverDrafts.$inferSelect;
export type NewMoverDraft = typeof moverDrafts.$inferInsert;
export type DraftStatus = (typeof draftStatusEnum.enumValues)[number];
export type AppUser = typeof appUsers.$inferSelect;
export type UserRole = (typeof userRoleEnum.enumValues)[number];
