import { isDbConfigured } from "@/db";
import { refreshStalePrices } from "@/lib/market/refresh";

/**
 * Brings stored prices up to date, if any are due.
 *
 * Called by the page itself once it has rendered (see `PriceRefresher`), which
 * is why it's a route rather than work done inline in the server component:
 * nobody should wait on an upstream provider to see the table.
 *
 * Unauthenticated on purpose -- the archive is public to read, and this exposes
 * nothing a viewer can't already see. It's also self-limiting: the TTL and the
 * per-run ceiling in `refreshStalePrices` mean repeated calls do nothing, so
 * hammering it costs a single indexed query.
 */
export async function POST() {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, due: 0, refreshed: 0, failed: 0 });
  }

  try {
    const summary = await refreshStalePrices();
    return Response.json({ ok: true, ...summary });
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
