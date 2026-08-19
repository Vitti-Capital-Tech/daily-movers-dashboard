-- Auth setup. Sign-in is a signed session cookie issued by the app, so there is
-- no Supabase Auth involvement and nothing to trigger on auth.users.
--
-- Apply with:  npm run db:auth
-- Safe to re-run.
--
-- CAUTION: this file changes the schema outside the numbered migrations, so
-- `drizzle/meta` cannot see it. Dropping `profiles` and creating `app_users`
-- here once left the snapshot describing a database that no longer existed, and
-- `drizzle-kit generate` then crashed trying to diff a table it thought had been
-- renamed. The 0001 snapshot has since been corrected by hand to match.
-- If you add DDL below, mirror it in src/db/schema.ts and keep the newest
-- snapshot in step, or generate breaks again.

-- Write-access allowlist. Everyone else on the domain is read-only.
-- Granting access is one INSERT; revoking is one DELETE. Role is read from this
-- table on every request, so either takes effect immediately.
INSERT INTO public.admin_emails (email, note)
VALUES ('doshi.p@vitti.capital', 'Research analyst — authors the Daily Movers')
ON CONFLICT (email) DO NOTHING;
--> statement-breakpoint

-- Remove the Supabase Auth wiring from the earlier magic-link approach.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint

DROP TRIGGER IF EXISTS admin_emails_sync ON public.admin_emails;
--> statement-breakpoint

DROP FUNCTION IF EXISTS public.handle_new_user();
--> statement-breakpoint

DROP FUNCTION IF EXISTS public.sync_profile_roles();
--> statement-breakpoint

DROP TABLE IF EXISTS public.profiles;
--> statement-breakpoint

-- Records who has signed in. Audit only — role is never stored here.
CREATE TABLE IF NOT EXISTS public.app_users (
  email text PRIMARY KEY,
  first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Deny-all through PostgREST: the anon key is public, so every table has RLS on
-- with no policies. The app is unaffected because Drizzle connects as the table
-- owner. See README -> "Why RLS has no policies".
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
