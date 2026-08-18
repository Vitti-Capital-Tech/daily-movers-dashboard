import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { isAllowedEmail } from "@/lib/auth-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@/db/schema";

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  /** True only for `admin`. The single flag the UI should branch on. */
  canWrite: boolean;
};

/**
 * The signed-in user plus their role, or null if unauthenticated.
 *
 * Uses `getUser()` (which revalidates the token against Supabase) rather than
 * `getSession()` (which only decodes the cookie and is therefore forgeable).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isAllowedEmail(user.email)) return null;

  const db = getDb();
  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id));

  // Fail closed: a missing profile row means viewer, never admin.
  const role: UserRole = profile?.role ?? "viewer";

  return {
    id: user.id,
    email: user.email.toLowerCase(),
    role,
    canWrite: role === "admin",
  };
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("You need to sign in.");
    this.name = "NotAuthenticatedError";
  }
}

export class NotAuthorisedError extends Error {
  constructor() {
    super("Your account has read-only access.");
    this.name = "NotAuthorisedError";
  }
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new NotAuthenticatedError();
  return user;
}

/** Throws unless the caller is an admin. Use at the top of every write. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireSessionUser();
  if (!user.canWrite) throw new NotAuthorisedError();
  return user;
}
