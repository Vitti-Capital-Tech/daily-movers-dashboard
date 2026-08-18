/**
 * Auth constants shared by the edge middleware, server components and the
 * login UI. Deliberately dependency-free: middleware runs on the edge runtime
 * and cannot import Drizzle or anything marked `server-only`.
 */

export const ALLOWED_EMAIL_DOMAIN = "vitti.capital";

/** Paths reachable without a session. Everything else requires sign-in. */
export const PUBLIC_PATHS = ["/login", "/auth"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Suffix match on `@domain` — checking for `endsWith(domain)` alone would let
 * `attacker@notvitti.capital` through.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

export const DEFAULT_LANDING_PATH = "/daily-movers";

/**
 * Sanitises a post-login `?next=` redirect target.
 *
 * Resolves the candidate against our own origin and keeps it only if the result
 * is still on that origin — string prefix checks are not enough. `/\evil.com`
 * passes a `startsWith("/") && !startsWith("//")` test, but both the URL parser
 * and browsers normalise the backslash, so it resolves to `http://evil.com/`.
 * Returns a path (never an absolute URL) so callers can't be tricked twice.
 */
export function safeNextPath(
  next: string | null | undefined,
  origin: string,
  fallback: string = DEFAULT_LANDING_PATH,
): string {
  if (!next) return fallback;
  try {
    const base = new URL(origin);
    const resolved = new URL(next, base);
    if (resolved.origin !== base.origin) return fallback;
    const path = `${resolved.pathname}${resolved.search}`;
    return path.startsWith("/") ? path : fallback;
  } catch {
    return fallback;
  }
}
