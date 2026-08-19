-- Post-event return tracking: a review status on each mover, plus the price
-- tables the Current Price / Post-Event / 1W / 1M columns are derived from.
--
-- Apply with:  npm run db:apply drizzle/0002_post_event_returns.sql
CREATE TYPE "public"."mover_status" AS ENUM('new', 'reviewed', 'follow_up');--> statement-breakpoint
ALTER TABLE "daily_movers" ADD COLUMN "status" "mover_status" DEFAULT 'new' NOT NULL;--> statement-breakpoint
CREATE TABLE "company_prices" (
	"company_id" integer NOT NULL,
	"price_date" date NOT NULL,
	"close" numeric(12, 4) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_prices_company_id_price_date_pk" PRIMARY KEY("company_id","price_date")
);
--> statement-breakpoint
ALTER TABLE "company_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_quotes" (
	"company_id" integer PRIMARY KEY NOT NULL,
	"price" numeric(12, 4),
	"currency" text,
	"as_of" timestamp with time zone,
	"source" text,
	"refreshed_at" timestamp with time zone,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "company_quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_prices" ADD CONSTRAINT "company_prices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_quotes" ADD CONSTRAINT "company_quotes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_prices_company_date_idx" ON "company_prices" USING btree ("company_id","price_date" DESC NULLS LAST);
