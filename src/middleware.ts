import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COOKIE } from "@/lib/session";

/**
 * Public by default: allows all visitors to browse Daily Movers and company research in read-only mode.
 * Admin write permissions are enforced server-side inside Server Actions.
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Root redirects to /daily-movers
  if (pathname === "/") {
    const target = request.nextUrl.clone();
    target.pathname = "/daily-movers";
    return NextResponse.redirect(target);
  }

  // If user visits /login and already has admin cookie, bounce to /daily-movers
  if (pathname === "/login") {
    const adminCookie = request.cookies.get(ADMIN_COOKIE)?.value;
    if (adminCookie) {
      const target = request.nextUrl.clone();
      target.pathname = "/daily-movers";
      return NextResponse.redirect(target);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
