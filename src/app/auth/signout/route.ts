import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

/**
 * POST only — a GET sign-out can be triggered by any image tag or prefetch.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(
    new URL("/login", request.nextUrl.origin),
    // 303 so the browser follows with GET rather than re-POSTing.
    { status: 303 },
  );

  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions,
    maxAge: 0,
  });

  return response;
}
