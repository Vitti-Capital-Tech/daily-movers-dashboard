import "server-only";

import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/db";
import { adminEmails, appUsers, type UserRole } from "@/db/schema";
import { isAllowedEmail } from "@/lib/auth-config";
import { readSessionToken, SESSION_COOKIE } from "@/lib/session";

export type SessionUser = {
  email: string;
  role: UserRole;
  /** True only for `admin`. The single flag the UI should branch on. */
  canWrite: boolean;
};

/**
 * Role is looked up from `admin_emails` on every request rather than copied onto
 * a user row, so revoking write access takes effect immediately and there is no
 * second copy to fall out of sync.
 */
export async function roleFor(email: string): Promise<UserRole> {
  const db = getDb();
  const [row] = await db
    .select({ email: adminEmails.email })
    .from(adminEmails)
    .where(eq(adminEmails.email, email.trim().toLowerCase()));
  return row ? "admin" : "viewer";
}

/** The signed-in user, or null. Fails closed on every unexpected input. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const email = await readSessionToken(store.get(SESSION_COOKIE)?.value);

  // A valid signature is not enough — the domain rule is re-checked so that
  // narrowing the allowlist invalidates existing cookies.
  if (!email || !isAllowedEmail(email)) return null;

  const role = await roleFor(email);
  return { email, role, canWrite: role === "admin" };
}

/** Records the sign-in for audit. Never affects authorisation. */
export async function touchUser(email: string): Promise<void> {
  const db = getDb();
  await db
    .insert(appUsers)
    .values({ email })
    .onConflictDoUpdate({
      target: appUsers.email,
      set: { lastSeenAt: sql`now()` },
    });
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
