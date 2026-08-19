import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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
 * Where a mover sits in our own review loop -- deliberately three states, not a
 * workflow. `new` is the default on arrival, `reviewed` means someone has since
 * looked at how the price played out, `follow_up` flags one worth returning to.
 */
export const moverStatusEnum = pgEnum("mover_status", [
  "new",
  "reviewed",
  "follow_up",
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
    uniqueIndex("companies_ticker_key").on(t.ticker),
    index("companies_name_idx").on(t.name),
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
     * Not present in the source PDFs -- manual entry, hence nullable. When it
     * is null the post-event returns fall back to the close on `move_date` from
     * `company_prices`, so the performance columns still populate.
     */
    reportPrice: numeric("report_price", {
      precision: 12,
      scale: 4,
      mode: "number",
    }),

    /** Review state. Set by hand; everything price-related updates itself. */
    status: moverStatusEnum("status").notNull().default("new"),

    /** Public/external link to the Daily Mover report, if one exists. */
    reportUrl: text("report_url"),
    /** Path within the storage bucket for an uploaded PDF. */
    reportStoragePath: text("report_storage_path"),
    asxAnnouncementUrl: text("asx_announcement_url"),

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
 * Daily closing prices, one row per company per trading day.
 *
 * Post-event returns are computed from this table on read rather than stored on
 * the mover. A stored return is a number that was true on the day it was
 * written; deriving it means a late or corrected close fixes every window at
 * once, and the same reasoning as `move_pct` applies -- two copies of a figure
 * eventually disagree.
 *
 * Closes are raw, not split/dividend-adjusted, so they stay comparable with a
 * hand-entered `report_price` and with the live quote below. The tradeoff is
 * that a share split needs a re-fetch of that company's history to stay sane.
 */
export const companyPrices = pgTable(
  "company_prices",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    priceDate: date("price_date").notNull(),
    close: numeric("close", { precision: 12, scale: 4, mode: "number" }).notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Natural key: re-fetching a date overwrites it instead of duplicating it.
    primaryKey({ columns: [t.companyId, t.priceDate] }),
    // Window lookups read backwards from a date: ... and price_date <= ? desc
    index("company_prices_company_date_idx").on(t.companyId, t.priceDate.desc()),
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

export const companiesRelations = relations(companies, ({ many, one }) => ({
  dailyMovers: many(dailyMovers),
  prices: many(companyPrices),
  quote: one(companyQuotes, {
    fields: [companies.id],
    references: [companyQuotes.companyId],
  }),
}));

export const companyPricesRelations = relations(companyPrices, ({ one }) => ({
  company: one(companies, {
    fields: [companyPrices.companyId],
    references: [companies.id],
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

export type Company = typeof companies.$inferSelect;
export type Catalyst = typeof catalysts.$inferSelect;
export type Analyst = typeof analysts.$inferSelect;
export type DailyMover = typeof dailyMovers.$inferSelect;
export type NewDailyMover = typeof dailyMovers.$inferInsert;
export type MoveType = (typeof moveTypeEnum.enumValues)[number];
export type AppUser = typeof appUsers.$inferSelect;
export type UserRole = (typeof userRoleEnum.enumValues)[number];
