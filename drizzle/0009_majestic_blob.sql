CREATE TABLE "screen_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"min_turnover" integer NOT NULL,
	"min_market_cap" integer NOT NULL,
	"min_abs_change_pct" integer NOT NULL,
	"per_side" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "screen_settings" ENABLE ROW LEVEL SECURITY;