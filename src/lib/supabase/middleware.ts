import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail, isPublicPath } from "@/lib/auth-config";

/**
 * Refreshes the Supabase session on every request and gates unauthenticated
 * access.
 *
 * This handles *authentication* only (is there a valid session, and is the
 * address inside the firm). *Authorisation* — whether the user may write — is a
 * role lookup in the database, which can't happen here because middleware runs
 * on the edge runtime with no Drizzle access. That check lives in
 * `assertCanWrite()` inside the Server Actions.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase configured there is no session to check; let the page
  // render its own "not configured" state rather than redirect-looping.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates the token with Supabase. getSession() only decodes
  // the cookie, so it must never be used for an access decision.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic = isPublicPath(pathname);

  // A session from outside the firm is terminated, not merely redirected.
  if (user && !isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "?error=domain";
    return NextResponse.redirect(target);
  }

  if (!user && !isPublic) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search =
      pathname && pathname !== "/"
        ? `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`
        : "";
    return NextResponse.redirect(target);
  }

  if (user && pathname === "/login") {
    const target = request.nextUrl.clone();
    target.pathname = "/daily-movers";
    target.search = "";
    return NextResponse.redirect(target);
  }

  // Must be returned as-is so the refreshed auth cookies survive.
  return response;
}
