"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { companies, dailyMovers } from "@/db/schema";
import {
  NotAuthenticatedError,
  NotAuthorisedError,
  requireAdmin,
  type SessionUser,
} from "@/lib/auth";
import {
  MOVER_STATUS_LABELS,
  moverStatusSchema,
  parseMoverForm,
} from "@/lib/validation";

export type MoverFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

/**
 * Single chokepoint for every write. Server-side and role-based — hiding the
 * button in the UI is not a permission check, since a Server Action is a public
 * HTTP endpoint that anyone can call directly.
 */
async function assertCanWrite(): Promise<SessionUser> {
  return requireAdmin();
}

/** Turns an auth failure into a form message instead of a stack trace. */
function authMessage(error: unknown): string | null {
  if (error instanceof NotAuthenticatedError) {
    return "Your session expired. Reload the page and sign in again.";
  }
  if (error instanceof NotAuthorisedError) {
    return "Your account has read-only access, so this wasn't saved.";
  }
  return null;
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
  let actor: SessionUser;
  try {
    actor = await assertCanWrite();
  } catch (error) {
    const message = authMessage(error);
    if (message) return { ok: false, message };
    throw error;
  }

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
      await db
        .insert(dailyMovers)
        .values({ ...parsed.data, createdBy: actor.email });
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

/**
 * Moves one row between New / Reviewed / Follow-Up.
 *
 * Its own action rather than part of `saveMover` because it's a one-click change
 * from the table, and it deliberately touches nothing else -- the edit form
 * doesn't carry `status`, so a concurrent edit can't quietly reset it.
 */
export async function updateMoverStatus(
  _prev: MoverFormState,
  formData: FormData,
): Promise<MoverFormState> {
  try {
    await assertCanWrite();
  } catch (error) {
    const message = authMessage(error);
    if (message) return { ok: false, message };
    throw error;
  }

  const rawId = formData.get("id");
  const id = typeof rawId === "string" ? Number(rawId) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, message: "Invalid record id." };
  }

  const status = moverStatusSchema.safeParse(formData.get("status"));
  if (!status.success) {
    return { ok: false, message: "Unknown status." };
  }

  const db = getDb();
  try {
    const updated = await db
      .update(dailyMovers)
      .set({ status: status.data, updatedAt: new Date() })
      .where(eq(dailyMovers.id, id))
      .returning({ companyId: dailyMovers.companyId });

    if (updated.length === 0) {
      return { ok: false, message: "That Daily Mover no longer exists." };
    }

    await revalidateFor(updated[0].companyId);
    return {
      ok: true,
      message: `Marked ${MOVER_STATUS_LABELS[status.data]}.`,
    };
  } catch (error) {
    console.error("updateMoverStatus failed", error);
    return { ok: false, message: "Could not update the status." };
  }
}

export async function deleteMover(
  _prev: MoverFormState,
  formData: FormData,
): Promise<MoverFormState> {
  try {
    await assertCanWrite();
  } catch (error) {
    const message = authMessage(error);
    if (message) return { ok: false, message };
    throw error;
  }

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
