"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  ADMIN_COOKIE,
  SESSION_COOKIE,
  createAdminToken,
  sessionCookieOptions,
  verifyAdminPasscode,
} from "@/lib/session";

export type AdminAuthState = {
  ok: boolean;
  message?: string;
};

export async function unlockAdmin(
  _prev: AdminAuthState | null,
  formData: FormData,
): Promise<AdminAuthState> {
  const passcode = formData.get("passcode");
  if (!passcode || typeof passcode !== "string") {
    return { ok: false, message: "Enter the admin passcode." };
  }

  if (!process.env.ADMIN_PASSCODE) {
    return {
      ok: false,
      message: "ADMIN_PASSCODE is not configured in server environment.",
    };
  }

  const isValid = verifyAdminPasscode(passcode);
  if (!isValid) {
    return { ok: false, message: "Incorrect admin passcode." };
  }

  const token = await createAdminToken();
  const store = await cookies();
  store.set(ADMIN_COOKIE, token, sessionCookieOptions);

  revalidatePath("/daily-movers");
  revalidatePath("/companies");
  revalidatePath("/");

  return { ok: true, message: "Admin mode unlocked successfully." };
}

export async function lockAdmin(): Promise<AdminAuthState> {
  const store = await cookies();
  store.set(ADMIN_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  store.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });

  revalidatePath("/daily-movers");
  revalidatePath("/companies");
  revalidatePath("/");

  return { ok: true, message: "Admin mode locked. Switched to View-Only." };
}
