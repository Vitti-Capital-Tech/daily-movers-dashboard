"use server";

import { cookies } from "next/headers";

import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail, safeNextPath } from "@/lib/auth-config";
import { touchUser } from "@/lib/auth";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";

export type LoginState = {
  ok: boolean;
  message: string;
  /** Set when a session was established and the browser should navigate. */
  redirectTo?: string;
} | null;

/**
 * Sign-in by email address alone.
 *
 * There is no verification step: an allowlisted address is accepted on trust.
 * The domain allowlist is therefore the ONLY access control on who gets in, and
 * `admin_emails` the only control on who can write. Anyone who can reach this
 * page and types a colleague's address receives that person's access.
 */
export async function signIn(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!email) {
    return { ok: false, message: "Enter your work email address." };
  }

  if (!isAllowedEmail(email)) {
    return {
      ok: false,
      message: `Access is limited to @${ALLOWED_EMAIL_DOMAIN} addresses.`,
    };
  }

  try {
    const token = await createSessionToken(email);
    const store = await cookies();
    store.set(SESSION_COOKIE, token, sessionCookieOptions);

    // Audit only — a failure here must not block sign-in.
    try {
      await touchUser(email);
    } catch (error) {
      console.error("touchUser failed (non-fatal)", error);
    }

    const next = safeNextPath(formData.get("next")?.toString(), "http://local");
    return { ok: true, message: "Signed in.", redirectTo: next };
  } catch (error) {
    console.error("signIn failed", error);
    return {
      ok: false,
      message:
        error instanceof Error && error.message.includes("AUTH_SECRET")
          ? error.message
          : "Could not sign in. Check the server logs.",
    };
  }
}
