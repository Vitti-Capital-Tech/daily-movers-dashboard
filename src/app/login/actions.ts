"use server";

import { headers } from "next/headers";

import {
  ALLOWED_EMAIL_DOMAIN,
  isAllowedEmail,
  safeNextPath,
} from "@/lib/auth-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LoginState = {
  ok: boolean;
  message: string;
} | null;

async function origin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function sendMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!email) {
    return { ok: false, message: "Enter your work email address." };
  }

  // Checked here as well as in the database trigger. This gives a clear message
  // instead of a generic failure, and avoids emailing people outside the firm.
  if (!isAllowedEmail(email)) {
    return {
      ok: false,
      message: `Access is limited to @${ALLOWED_EMAIL_DOMAIN} addresses.`,
    };
  }

  const site = await origin();
  const rawNext = formData.get("next");
  const redirectTo = new URL("/auth/confirm", site);
  if (typeof rawNext === "string" && rawNext !== "") {
    const next = safeNextPath(rawNext, site, "");
    if (next) redirectTo.searchParams.set("next", next);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo.toString() },
  });

  if (error) {
    console.error("signInWithOtp failed", error);
    // Don't echo the provider message — it can distinguish existing accounts
    // from unknown ones, which is an account-enumeration leak.
    return {
      ok: false,
      message: "Could not send the sign-in link. Try again in a moment.",
    };
  }

  return {
    ok: true,
    message: `Sign-in link sent to ${email}. It expires in 60 minutes.`,
  };
}
