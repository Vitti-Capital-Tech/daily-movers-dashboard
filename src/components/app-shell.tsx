import Link from "next/link";
import type { ReactNode } from "react";

import { NavLink } from "@/components/nav-link";

const NAV = [
  { href: "/daily-movers", label: "Daily Movers" },
  { href: "/companies", label: "Companies" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
        <div className="px-6 py-6">
          <Link href="/daily-movers" className="block">
            <div className="text-base font-semibold tracking-tight">
              Vitti Capital
            </div>
            <div className="text-xs text-muted-foreground">
              Daily Movers Dashboard
            </div>
          </Link>
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto px-6 py-6 text-xs text-muted-foreground">
          V1 — research archive
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {/* Mobile nav */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 md:hidden">
          <span className="mr-2 text-sm font-semibold">Vitti Capital</span>
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} compact>
              {item.label}
            </NavLink>
          ))}
        </div>

        <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
