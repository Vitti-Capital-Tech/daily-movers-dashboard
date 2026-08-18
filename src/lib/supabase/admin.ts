import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client, used only for Storage (creating signed upload URLs and
 * signed download URLs for the private reports bucket).
 *
 * Bypasses RLS completely: server-side only, never imported by a client
 * component, and the key must never be exposed as NEXT_PUBLIC_*.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Report uploads need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase → Project Settings → API keys → service_role).",
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
