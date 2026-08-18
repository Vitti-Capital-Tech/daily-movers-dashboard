import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail, safeNextPath } from "@/lib/auth-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Landing point for the emailed magic link. Exchanges the one-time token for a
 * session cookie, then redirects into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Validated against our own origin — see safeNextPath for why a prefix check
  // is not sufficient.
  const next = safeNextPath(searchParams.get("next"), origin);

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=link", origin));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    const key = /expired/i.test(error.message) ? "expired" : "link";
    return NextResponse.redirect(new URL(`/login?error=${key}`, origin));
  }

  // The database trigger already blocks out-of-domain sign-ups; this covers any
  // account that predates it.
  if (!isAllowedEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=domain", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
