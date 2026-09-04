-- Split the drafts' input-token audit three ways.
--
-- The drafting pipeline puts most of its input through the prompt cache -- the
-- announcement corpus is the large, stable part of the prompt -- and the three
-- kinds are billed at different rates. Recording only `input_tokens` reported a
-- 153k-token corpus as 3k tokens, which made the cost estimate meaningless.
--
-- Apply with:  npm run db:apply drizzle/0006_draft_cache_tokens.sql
ALTER TABLE "mover_drafts" ADD COLUMN IF NOT EXISTS "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "mover_drafts" ADD COLUMN IF NOT EXISTS "cache_read_tokens" integer;