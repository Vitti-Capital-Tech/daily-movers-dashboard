-- Auth wiring that Drizzle can't express: a trigger on Supabase's auth.users,
-- the @vitti.capital domain allowlist, and role sync from admin_emails.
--
-- Apply with:  npx tsx scripts/apply-sql.mts drizzle/auth-setup.sql
-- Safe to re-run.

-- Grant write access to these addresses. Everyone else on the domain is
-- read-only. Adding an admin later is one INSERT — no code change, no deploy.
INSERT INTO public.admin_emails (email, note)
VALUES ('doshi.p@vitti.capital', 'Research analyst — authors the Daily Movers')
ON CONFLICT (email) DO NOTHING;
--> statement-breakpoint

-- Creates a profile whenever someone signs in for the first time, and refuses
-- sign-ups from outside the firm.
--
-- SECURITY DEFINER so it can write to public.profiles (which has RLS enabled)
-- while running in the context of Supabase's auth service. search_path is
-- pinned so the function can't be hijacked by a rogue schema on the caller's
-- search_path.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  addr text := lower(NEW.email);
BEGIN
  IF addr IS NULL OR addr NOT LIKE '%@vitti.capital' THEN
    RAISE EXCEPTION 'Access is restricted to @vitti.capital email addresses';
  END IF;

  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    addr,
    CASE
      WHEN EXISTS (SELECT 1 FROM public.admin_emails a WHERE a.email = addr)
        THEN 'admin'::public.user_role
      ELSE 'viewer'::public.user_role
    END
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$fn$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- Keeps profiles.role in step with admin_emails, so granting or revoking write
-- access takes effect for users who have already signed in.
CREATE OR REPLACE FUNCTION public.sync_profile_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.profiles p
  SET role = CASE
    WHEN EXISTS (SELECT 1 FROM public.admin_emails a WHERE a.email = p.email)
      THEN 'admin'::public.user_role
    ELSE 'viewer'::public.user_role
  END;
  RETURN NULL;
END;
$fn$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS admin_emails_sync ON public.admin_emails;
--> statement-breakpoint

CREATE TRIGGER admin_emails_sync
AFTER INSERT OR UPDATE OR DELETE ON public.admin_emails
FOR EACH STATEMENT EXECUTE FUNCTION public.sync_profile_roles();
--> statement-breakpoint

-- Backfill for anyone who signed in before this script ran.
UPDATE public.profiles p
SET role = CASE
  WHEN EXISTS (SELECT 1 FROM public.admin_emails a WHERE a.email = p.email)
    THEN 'admin'::public.user_role
  ELSE 'viewer'::public.user_role
END;
