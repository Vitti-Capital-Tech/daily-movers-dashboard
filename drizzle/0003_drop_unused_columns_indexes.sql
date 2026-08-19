DROP INDEX "companies_name_idx";--> statement-breakpoint
DROP INDEX "company_prices_company_date_idx";--> statement-breakpoint
ALTER TABLE "daily_movers" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "daily_movers" DROP COLUMN "asx_announcement_url";--> statement-breakpoint
DROP TYPE "public"."mover_status";