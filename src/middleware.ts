import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail, isPublicPath } from "@/lib/auth-config";
import { readSessionToken, SESSION_COOKIE } from "@/lib/session";

/**
 * Gates unauthenticated page access.
 *
 * Authentication only. Whether a user may *write* is a role lookup in the
 * database, which can't happen here — middleware runs on the edge runtime with
 * no Drizzle access. That check lives in `assertCanWrite()` in the Server
 * Actions, which is the real enforcement point.
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Without AUTH_SECRET there is no way to validate a session; let the page
  // render its own error rather than redirect-looping.
  if (!process.env.AUTH_SECRET) return NextResponse.next();

  const email = await readSessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  const signedIn = Boolean(email) && isAllowedEmail(email);

  // A cookie that no longer satisfies the domain rule is cleared, not merely
  // ignored — so narrowing the allowlist logs those users out.
  if (email && !isAllowedEmail(email)) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "?error=domain";
    const response = NextResponse.redirect(target);
    response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }

  if (!signedIn && !isPublicPath(pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search =
      pathname && pathname !== "/"
        ? `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`
        : "";
    return NextResponse.redirect(target);
  }

  if (signedIn && pathname === "/login") {
    const target = request.nextUrl.clone();
    target.pathname = "/daily-movers";
    target.search = "";
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
