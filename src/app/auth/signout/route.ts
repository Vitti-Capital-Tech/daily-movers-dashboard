import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST only — a GET sign-out can be triggered by any image tag or prefetch.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), {
    // 303 so the browser follows with GET rather than re-POSTing.
    status: 303,
  });
}
