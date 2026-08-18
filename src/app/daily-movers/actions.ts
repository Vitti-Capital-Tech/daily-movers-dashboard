"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { companies, dailyMovers } from "@/db/schema";
import { parseMoverForm } from "@/lib/validation";

export type MoverFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

/**
 * Single chokepoint for every write.
 *
 * TODO(auth): currently a no-op — the app has no auth yet, so anyone who can
 * reach it can write. Supabase Auth lands next; the check goes HERE (and in an
 * RLS policy as a second layer), not in the UI. Hiding the button is not a
 * permission check.
 */
async function assertCanWrite(): Promise<void> {
  return;
}

async function revalidateFor(companyId: number) {
  revalidatePath("/daily-movers");
  revalidatePath("/companies");

  const db = getDb();
  const [company] = await db
    .select({ ticker: companies.ticker })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (company) {
    revalidatePath(`/companies/${company.ticker}`);
  }
}

/** Handles both create and update — an `id` field in the form means update. */
export async function saveMover(
  _prev: MoverFormState,
  formData: FormData,
): Promise<MoverFormState> {
  await assertCanWrite();

  const parsed = parseMoverForm(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const rawId = formData.get("id");
  const id =
    typeof rawId === "string" && rawId.trim() !== "" ? Number(rawId) : null;

  const db = getDb();

  try {
    if (id !== null) {
      if (!Number.isInteger(id) || id <= 0) {
        return { ok: false, message: "Invalid record id." };
      }
      const updated = await db
        .update(dailyMovers)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(dailyMovers.id, id))
        .returning({ id: dailyMovers.id });

      if (updated.length === 0) {
        return { ok: false, message: "That Daily Mover no longer exists." };
      }
    } else {
      await db.insert(dailyMovers).values(parsed.data);
    }

    await revalidateFor(parsed.data.companyId);
    return {
      ok: true,
      message: id !== null ? "Daily Mover updated." : "Daily Mover saved.",
    };
  } catch (error) {
    console.error("saveMover failed", error);
    return {
      ok: false,
      message:
        error instanceof Error && error.message.includes("DATABASE_URL")
          ? error.message
          : "Could not save. Check the server logs.",
    };
  }
}

export async function deleteMover(
  _prev: MoverFormState,
  formData: FormData,
): Promise<MoverFormState> {
  await assertCanWrite();

  const rawId = formData.get("id");
  const id = typeof rawId === "string" ? Number(rawId) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, message: "Invalid record id." };
  }

  const db = getDb();
  try {
    const deleted = await db
      .delete(dailyMovers)
      .where(eq(dailyMovers.id, id))
      .returning({ companyId: dailyMovers.companyId });

    if (deleted.length === 0) {
      return { ok: false, message: "That Daily Mover no longer exists." };
    }
    await revalidateFor(deleted[0].companyId);
    return { ok: true, message: "Daily Mover deleted." };
  } catch (error) {
    console.error("deleteMover failed", error);
    return { ok: false, message: "Could not delete. Check the server logs." };
  }
}
