import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { getSessionUser } from "@/lib/auth";

/**
 * Belt-and-braces: the middleware already redirects unauthenticated requests,
 * but this layout re-checks server-side so a middleware misconfiguration can't
 * silently expose the research.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return <AppShell user={user}>{children}</AppShell>;
}
