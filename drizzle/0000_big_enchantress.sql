CREATE TYPE "public"."move_type" AS ENUM('intraday', 'closing');--> statement-breakpoint
CREATE TABLE "analysts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalysts" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"sector" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_movers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"catalyst_id" integer NOT NULL,
	"analyst_id" integer,
	"move_date" date NOT NULL,
	"move_pct" numeric(6, 2) NOT NULL,
	"move_type" "move_type" NOT NULL,
	"move_window_label" text,
	"reason_for_move" text NOT NULL,
	"main_takeaway" text NOT NULL,
	"report_price" numeric(12, 4),
	"report_url" text,
	"report_storage_path" text,
	"asx_announcement_url" text,
	"extraction" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_movers" ADD CONSTRAINT "daily_movers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_movers" ADD CONSTRAINT "daily_movers_catalyst_id_catalysts_id_fk" FOREIGN KEY ("catalyst_id") REFERENCES "public"."catalysts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_movers" ADD CONSTRAINT "daily_movers_analyst_id_analysts_id_fk" FOREIGN KEY ("analyst_id") REFERENCES "public"."analysts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysts_name_key" ON "analysts" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "catalysts_slug_key" ON "catalysts" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_ticker_key" ON "companies" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "daily_movers_company_date_idx" ON "daily_movers" USING btree ("company_id","move_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "daily_movers_date_idx" ON "daily_movers" USING btree ("move_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "daily_movers_catalyst_idx" ON "daily_movers" USING btree ("catalyst_id");