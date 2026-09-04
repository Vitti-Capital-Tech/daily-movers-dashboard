-- AI-drafted Daily Movers awaiting analyst approval.
--
-- Separate from `daily_movers` rather than a status column on it, so that every
-- row in that table stays approved research -- see the table comment in
-- `src/db/schema.ts` for why that matters.
--
-- Apply with:  npm run db:apply drizzle/0005_mover_drafts.sql
CREATE TYPE "public"."draft_status" AS ENUM('generating', 'pending', 'approved', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "mover_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" "draft_status" DEFAULT 'generating' NOT NULL,
	"move_date" date NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"ticker" text,
	"company_name" text,
	"sector" text,
	"company_id" integer,
	"move_pct" numeric(6, 2),
	"move_type" "move_type",
	"move_window_label" text,
	"catalyst_slug" text,
	"reason_for_move" text,
	"main_takeaway" text,
	"report_price" numeric(12, 4),
	"analyst_id" integer,
	"screen" jsonb,
	"selection" jsonb,
	"sources" jsonb,
	"report" jsonb,
	"draft_storage_path" text,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"progress" text,
	"error" text,
	"approved_mover_id" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text
);
--> statement-breakpoint
ALTER TABLE "mover_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mover_drafts" ADD CONSTRAINT "mover_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mover_drafts" ADD CONSTRAINT "mover_drafts_analyst_id_analysts_id_fk" FOREIGN KEY ("analyst_id") REFERENCES "public"."analysts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mover_drafts" ADD CONSTRAINT "mover_drafts_approved_mover_id_daily_movers_id_fk" FOREIGN KEY ("approved_mover_id") REFERENCES "public"."daily_movers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mover_drafts_status_created_idx" ON "mover_drafts" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "mover_drafts_cron_day_key" ON "mover_drafts" USING btree ("move_date") WHERE "mover_drafts"."trigger" = 'cron';