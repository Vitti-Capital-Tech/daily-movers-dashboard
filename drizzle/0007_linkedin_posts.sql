-- LinkedIn posts drafted from a published mover's outcome.
--
-- `verdict` is a recorded judgement, not a computed column: whether the note's
-- view was borne out depends on what the takeaway argued, not on the sign of the
-- return. A mover that fell 14% and has since risen 27% is a validated call if
-- the note said the disruption was temporary and a contradicted one if it said
-- the outlook had worsened.
--
-- `snapshot` exists because the figures in the post text are only true as at the
-- moment they were written.
--
-- Apply with:  npm run db:apply drizzle/0007_linkedin_posts.sql
CREATE TYPE "public"."post_status" AS ENUM('draft', 'posted', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."post_verdict" AS ENUM('validated', 'mixed', 'contradicted', 'too_early');--> statement-breakpoint
CREATE TABLE "linkedin_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"mover_id" integer NOT NULL,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"verdict" "post_verdict" NOT NULL,
	"verdict_reason" text,
	"evidence_quote" text,
	"posts" jsonb,
	"snapshot" jsonb,
	"model" text,
	"input_tokens" integer,
	"cache_write_tokens" integer,
	"cache_read_tokens" integer,
	"output_tokens" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "linkedin_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "linkedin_posts" ADD CONSTRAINT "linkedin_posts_mover_id_daily_movers_id_fk" FOREIGN KEY ("mover_id") REFERENCES "public"."daily_movers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "linkedin_posts_status_created_idx" ON "linkedin_posts" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "linkedin_posts_mover_idx" ON "linkedin_posts" USING btree ("mover_id");