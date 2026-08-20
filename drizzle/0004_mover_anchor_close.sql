-- Replaces the `company_prices` daily series with one resolved close per mover.
--
-- The series existed to serve the 1W/1M window returns. Those were removed, and
-- the only historical price the app still reads is the anchor for a mover with no
-- report price -- 39 values, where the series held ~2,000 rows.
--
-- Statement order matters and is NOT what drizzle-kit generated: the column has
-- to exist, and be populated from the series, before the series is dropped.
--
-- Apply with:  npm run db:apply drizzle/0004_mover_anchor_close.sql
ALTER TABLE "daily_movers" ADD COLUMN "move_date_close" numeric(12, 4);--> statement-breakpoint

-- Backfill from data we already hold, so no provider calls are needed. Guarded
-- on the table still existing, so re-running this file after the drop is a no-op
-- rather than an error.
DO $$
BEGIN
  IF to_regclass('public.company_prices') IS NOT NULL THEN
    UPDATE "daily_movers" m
    SET "move_date_close" = (
      SELECT p.close
      FROM "company_prices" p
      WHERE p.company_id = m.company_id
        AND p.price_date <= m.move_date
      ORDER BY p.price_date DESC
      LIMIT 1
    )
    WHERE m."report_price" IS NULL
      AND m."move_date_close" IS NULL;
  END IF;
END $$;--> statement-breakpoint

DROP TABLE IF EXISTS "company_prices" CASCADE;
