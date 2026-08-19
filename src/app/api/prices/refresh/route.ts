import type { NextRequest } from "next/server";

import { isDbConfigured } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { refreshStalePrices } from "@/lib/market/refresh";

/**
 * Brings stored prices up to date.
 *
 * Two callers, two modes:
 * - `PriceRefresher` fires this with no body once the page has painted. Stale
 *   companies only, so a page load costs nothing when prices are current. This
 *   is a route rather than work inline in the server component because nobody
 *   should wait on an upstream provider to see the table.
 * - The manual button posts `{ force: true }`, which ignores the TTL and the
 *   per-run ceiling.
 *
 * The automatic mode is unauthenticated — the archive is public to read, and it
 * exposes nothing a viewer can't already see, while the TTL and ceiling in
 * `refreshStalePrices` make repeated calls free. Forcing is admin-only: one
 * click fetches every tracked ticker, and that is not something an anonymous
 * visitor should be able to aim at an external provider on repeat.
 */
export async function POST(request: NextRequest) {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, due: 0, refreshed: 0, failed: 0 });
  }

  const body = (await request.json().catch(() => ({}))) as { force?: unknown };
  const wantsForce = body.force === true;

  let force = false;
  if (wantsForce) {
    const user = await getSessionUser();
    if (!user.canWrite) {
      return Response.json(
        { ok: false, forbidden: true, due: 0, refreshed: 0, failed: 0 },
        { status: 403 },
      );
    }
    force = true;
  }

  try {
    const summary = await refreshStalePrices({ force });
    return Response.json({ ok: true, forced: force, ...summary });
  } catch (error) {
    console.error("price refresh failed", error);
    // A failed refresh is not a failed page: the caller carries on showing
    // whatever was last stored.
    return Response.json(
      { ok: false, due: 0, refreshed: 0, failed: 0 },
      { status: 200 },
    );
  }
}
