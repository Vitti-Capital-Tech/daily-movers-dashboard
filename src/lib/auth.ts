import "server-only";

import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/db";
import { adminEmails, appUsers, type UserRole } from "@/db/schema";
import { isAllowedEmail } from "@/lib/auth-config";
import {
  readSessionToken,
  ADMIN_COOKIE,
  SESSION_COOKIE,
} from "@/lib/session";

export type SessionUser = {
  email: string;
  role: UserRole;
  /** True only for `admin`. The single flag the UI should branch on. */
  canWrite: boolean;
};

const DEFAULT_VIEWER: SessionUser = {
  email: "viewer@vitti.capital",
  role: "viewer",
  canWrite: false,
};

/**
 * Checks role from admin_emails table if a specific email is provided.
 */
export async function roleFor(email: string): Promise<UserRole> {
  try {
    const db = getDb();
    const [row] = await db
      .select({ email: adminEmails.email })
      .from(adminEmails)
      .where(eq(adminEmails.email, email.trim().toLowerCase()));
    return row ? "admin" : "viewer";
  } catch (error) {
    console.error(
      "roleFor: could not reach the database, defaulting to viewer",
      error,
    );
    return "viewer";
  }
}

/**
 * Resolves the session user.
 *
 * Defaults to viewer (read-only) mode so the dashboard is publicly viewable without a login barrier.
 * When the admin passcode is unlocked, returns admin mode with write permissions.
 */
export async function getSessionUser(): Promise<SessionUser> {
  const store = await cookies();

  // 1. Check for dedicated admin unlock cookie
  const adminCookie = store.get(ADMIN_COOKIE)?.value;
  if (adminCookie) {
    const adminId = await readSessionToken(adminCookie);
    if (adminId) {
      return {
        email: "admin@vitti.capital",
        role: "admin",
        canWrite: true,
      };
    }
  }

  // 2. Check for legacy/email session cookie if present
  const sessionCookie = store.get(SESSION_COOKIE)?.value;
  if (sessionCookie) {
    const email = await readSessionToken(sessionCookie);
    if (email && isAllowedEmail(email)) {
      const role = await roleFor(email);
      return {
        email,
        role,
        canWrite: role === "admin",
      };
    }
  }

  // 3. Default to public viewer mode
  return DEFAULT_VIEWER;
}

/** Records the sign-in for audit. Never affects authorisation. */
export async function touchUser(email: string): Promise<void> {
  try {
    const db = getDb();
    await db
      .insert(appUsers)
      .values({ email })
      .onConflictDoUpdate({
        target: appUsers.email,
        set: { lastSeenAt: sql`now()` },
      });
  } catch (err) {
    console.warn("touchUser failed", err);
  }
}

export class NotAuthenticatedError extends Error {
  constructor(message = "You need to unlock admin mode.") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

export class NotAuthorisedError extends Error {
  constructor(message = "Admin unlock required to add or edit Daily Movers.") {
    super(message);
    this.name = "NotAuthorisedError";
  }
}

export async function requireSessionUser(): Promise<SessionUser> {
  return getSessionUser();
}

/** Throws unless the caller has admin permissions. Use at the top of every write. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user.canWrite) throw new NotAuthorisedError();
  return user;
}
