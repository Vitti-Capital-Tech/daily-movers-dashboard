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
);

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
);

export const analysts = pgTable(
  "analysts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("analysts_name_key").on(t.name)],
);

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

    /** Not present in the source PDFs -- manual entry, hence nullable. */
    reportPrice: numeric("report_price", {
      precision: 12,
      scale: 4,
      mode: "number",
    }),

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
);

export const companiesRelations = relations(companies, ({ many }) => ({
  dailyMovers: many(dailyMovers),
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
