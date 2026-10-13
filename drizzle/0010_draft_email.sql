ALTER TABLE "mover_drafts" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mover_drafts" ADD COLUMN "email_error" text;